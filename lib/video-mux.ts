/**
 * Server-side video audio-swap using ffmpeg-static.
 *
 * Why this exists: Higgsfield's video models (wan2_7, seedance_2_0) accept
 * our ElevenLabs MP3 as an `audio` media reference, but they extract the
 * words + timing and re-synthesize the output audio with their own voice.
 * To get our actual ElevenLabs voice in the final video, we download the
 * Higgsfield-rendered MP4, strip its audio track, and overlay our MP3.
 * The lip-sync mouth movements stay (they were driven by our audio's
 * timing); only the audio track is replaced.
 *
 * Pipeline (per call):
 *   1. Download Higgsfield MP4 to /tmp
 *   2. Stream our ElevenLabs MP3 from the bucket to /tmp
 *   3. ffmpeg -i video -i audio -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest output
 *      (copy video stream, encode audio as AAC, take audio from input 1, stop at shortest)
 *   4. Upload muxed MP4 back to the bucket
 *   5. Return the bucket key + public URL
 *
 * ffmpeg is resolved at call time via getFfmpegPath() — prefers the system
 * binary (installed on Railway via railpack.json's deploy.aptPackages, or
 * Homebrew locally), falls back to ffmpeg-static's vendored binary if present.
 * The vendored binary is unreliable under Railway's RAILPACK builder because
 * `npm ci` skips its postinstall download step.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { getObjectStream, putObject } from "@/lib/s3";
import { buildBriefingAudioKey } from "@/lib/elevenlabs";

/**
 * Resolve a usable `ffmpeg` binary.
 *
 * `ffmpeg-static`'s vendored Linux binary is downloaded by its postinstall
 * script — and Railway's RAILPACK builder uses `npm ci`, which skips
 * postinstall scripts. The package directory exists in `node_modules` but the
 * binary is missing, so `spawn(ffmpegPath, ...)` throws `ENOENT` at runtime.
 *
 * Prefer system `ffmpeg` (installed via `railpack.json`'s `deploy.aptPackages`
 * on Railway, or Homebrew locally), then fall back to the vendored binary if
 * it actually exists on disk. Cached after first resolution.
 */
let resolvedFfmpeg: string | undefined;
function getFfmpegPath(): string {
  if (resolvedFfmpeg) return resolvedFfmpeg;
  const candidates = [
    process.env.FFMPEG_PATH,
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
    ffmpegPath ?? undefined,
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) {
    if (existsSync(p)) {
      resolvedFfmpeg = p;
      return p;
    }
  }
  throw new Error(
    `no ffmpeg binary found (checked: ${candidates.join(", ") || "<none>"})`,
  );
}

/** Static branded end-card overlaid once the narration finishes. */
const OUTRO_CARD_PATH = path.join(
  process.cwd(),
  "public/assets/briefing-outro.png",
);

/** Bucket key for the briefing-video background music asset. Uploaded
 *  once via `scripts/upload-briefing-bgm.mjs`. To swap to a different
 *  track, upload to a new versioned key (`bgm/olivia_pulse_v2.mp3`)
 *  and bump this constant.
 *
 *  The asset is a seamless 83-second loop (no internal fades) that
 *  ffmpeg loops infinitely and trims to voice length via `-shortest`. */
const BRIEFING_BGM_KEY = "bgm/olivia_pulse_v2.mp3";

/** Volume reduction applied to BGM in the mix. 0.20 ≈ -14 dB —
 *  clearly audible bed under the voice, gives the video real
 *  momentum. Sidechain compression dips it another ~6 dB while she
 *  speaks so intelligibility stays intact.
 *
 *  Tuning history:
 *    0.08 (-22 dB) — too subdued, barely audible
 *    0.12 (-18 dB) — still hard to hear
 *    0.20 (-14 dB) — current — meaningful presence */
const BGM_VOLUME = 0.20;

/** Voice level applied before mixing. 0.80 ≈ -2 dB — slight headroom
 *  reduction to "make space" for the BGM. Without this, the voice
 *  feels louder than the original briefing (which was voice-only at
 *  unity); plus the sum of voice + BGM can clip above 1.0. This brings
 *  the perceived voice level back to what the original briefing had. */
const VOICE_VOLUME = 0.80;

/** Sidechain compression: when the voice signal exceeds threshold, the
 *  BGM gets gently ducked. The numbers are tuned to feel transparent —
 *  music keeps playing even when she's emphatic, just sits a touch
 *  lower so her words aren't fighting the bed.
 *
 *  Tuning history:
 *    ratio 6, no makeup — music DROPPED OUT on emphatic words
 *    ratio 3 + makeup 1.5 — gentle dip, music stays present
 *
 *  threshold 0.07 (≈-23 dB): less sensitive than before so quiet
 *    delivery doesn't trigger ducking at all
 *  ratio 3: gentle compression (was 6 = aggressive)
 *  attack 5ms: fast enough to be transparent
 *  release 250ms: smooth recovery between phrases
 *  makeup 1.5: lifts the ducked BGM back up so it never feels gone */
const SIDECHAIN_PARAMS =
  "threshold=0.07:ratio=3:attack=5:release=250:makeup=1.5";

/** Fade-in at video start (gentle ramp so music doesn't start cold)
 *  and fade-out at end (avoids hard cut on the loop). */
const BGM_FADE_IN_SEC = 1.5;
const BGM_FADE_OUT_SEC = 2.5;

export function buildBriefingVideoKey(tradingDay: string): string {
  return `briefings/${tradingDay}/video.mp4`;
}

/** Bucket key for a weekly earnings brief's MP4.
 *  Keyed on `weekAnchor` (Sunday-of-the-week date). */
export function buildWeeklyEarningsVideoKey(weekAnchor: string): string {
  return `weekly-earnings-briefings/${weekAnchor}/video.mp4`;
}

export interface MuxResult {
  tradingDay: string;
  videoKey: string;
  videoUrl: string;
  bytes: number;
  durationLog: string;
}

/**
 * Fetch a URL into a Buffer with a sane timeout. Used to pull the
 * Higgsfield-rendered MP4 down before we hand it to ffmpeg.
 */
async function fetchToBuffer(url: string, timeoutMs = 60_000): Promise<Buffer> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText}`);
    }
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  } finally {
    clearTimeout(t);
  }
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/**
 * Replace the audio track of a remote MP4 with the briefing's local MP3
 * (from the Railway bucket). Returns the bucket key + public URL of the
 * muxed result.
 */
export async function swapBriefingAudio(
  tradingDay: string,
  higgsfieldVideoUrl: string,
): Promise<MuxResult> {
  const ffmpegBin = getFfmpegPath();
  const t0 = Date.now();
  const work = await mkdtemp(path.join(tmpdir(), "briefing-mux-"));
  try {
    // 1. Download Higgsfield MP4 + read our MP3 from the bucket in parallel.
    const audioKey = buildBriefingAudioKey(tradingDay);
    const audioObj = await getObjectStream(audioKey);
    if (!audioObj) {
      throw new Error(
        `no audio in bucket for ${tradingDay} — run generate_voiceover_for_briefing first`,
      );
    }
    // Also fetch the BGM asset from the bucket. If it's missing the
    // pipeline falls back to voice-only — we don't want a missing BGM
    // to break the publish flow. Soft-fail logged.
    let bgmBytes: Buffer | null = null;
    try {
      const bgmObj = await getObjectStream(BRIEFING_BGM_KEY);
      if (bgmObj) bgmBytes = await streamToBuffer(bgmObj.body);
    } catch (err) {
      console.warn(
        `[video-mux] BGM fetch failed, continuing voice-only: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const [videoBytes, audioBytes] = await Promise.all([
      fetchToBuffer(higgsfieldVideoUrl),
      streamToBuffer(audioObj.body),
    ]);

    const videoIn = path.join(work, "in.mp4");
    const audioIn = path.join(work, "in.mp3");
    const bgmIn = path.join(work, "bgm.mp3");
    const videoOut = path.join(work, "out.mp4");
    await writeFile(videoIn, new Uint8Array(videoBytes));
    await writeFile(audioIn, new Uint8Array(audioBytes));
    if (bgmBytes) await writeFile(bgmIn, new Uint8Array(bgmBytes));

    // 2. ffmpeg mux. Copy video stream (no re-encode), encode audio as AAC.
    //    Two paths:
    //      - With BGM: voice + sidechain-ducked, looped BGM mixed together.
    //      - Without BGM: voice-only (original behavior).
    //    `-shortest` caps to voice duration. BGM loops infinitely via
    //    `-stream_loop -1` so we don't need to plan that ahead.
    const args: string[] = ["-y", "-i", videoIn, "-i", audioIn];
    if (bgmBytes) {
      // Probe voice duration so the fade-out lands at the END of the
      // clip, not the start. afade with st=0 fades from 0→silence over
      // d seconds and then STAYS silent — that destroys the bulk of
      // the audio if applied without a real start time.
      const voiceDuration = await probeMediaDuration(ffmpegBin, audioIn);
      // If the probe fails (very rare), skip the fade-out and let the
      // -shortest hard-cut handle the tail. Better than silencing the
      // whole clip with an at-0 fade-out, which was the V1 bug.
      const fadeOutStart = Number.isFinite(voiceDuration)
        ? Math.max(0, voiceDuration - BGM_FADE_OUT_SEC)
        : null;

      args.push("-stream_loop", "-1", "-i", bgmIn);
      // Filter graph:
      //   [2:a] = looped BGM → volume down → fade in at start
      //   [bgm][1:a] = sidechaincompress ducks bgm when voice speaks
      //   [1:a][ducked] = mix voice (unity) + ducked BGM
      //   BGM-only fade-out applied below (voice plays through clean)
      // amix `normalize=0` keeps voice at its true (pre-amix) level.
      // Default normalize=1 would divide the sum by 2, but then any
      // BGM_VOLUME bump would also push voice. normalize=0 sums
      // cleanly — each input's level is what we set it to. Voice is
      // pre-attenuated by VOICE_VOLUME to leave headroom for the BGM
      // and match the original voice-only briefing's perceived level.
      //
      // Fade-out is applied ONLY to the BGM track, not the mixed
      // stream — that way her voice plays through naturally to her
      // final word (no fade) while music tails out underneath.
      const bgmFadeOut =
        fadeOutStart != null
          ? `,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${BGM_FADE_OUT_SEC}:curve=tri`
          : "";
      const filter =
        `[1:a]volume=${VOICE_VOLUME}[voiceA];` +
        `[2:a]volume=${BGM_VOLUME},afade=t=in:st=0:d=${BGM_FADE_IN_SEC}` +
        `${bgmFadeOut}[bgmA];` +
        `[bgmA][voiceA]sidechaincompress=${SIDECHAIN_PARAMS}[bgmD];` +
        `[voiceA][bgmD]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]`;
      args.push(
        "-filter_complex",
        filter,
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        // Force stereo output. The voice MP3 is mono; producing a
        // mono AAC stream triggers QuickTime's "incompatible media"
        // warning even though the file is fine. Stereo is universally
        // safe and the BGM is already stereo.
        "-ac", "2",
        "-map", "0:v:0",
        "-map", "[mixed]",
        "-shortest",
        "-movflags", "+faststart",
        videoOut,
      );
    } else {
      args.push(
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-shortest",
        "-movflags", "+faststart",
        videoOut,
      );
    }

    await runFfmpeg(ffmpegBin, args);

    const muxedBytes = await readFile(videoOut);

    // 3. Upload muxed MP4 to bucket.
    const videoKey = buildBriefingVideoKey(tradingDay);
    const upload = await putObject(
      videoKey,
      new Uint8Array(muxedBytes),
      "video/mp4",
    );

    const appUrl = process.env.APP_URL || "https://www.oliviatrades.com";
    return {
      tradingDay,
      videoKey: upload.key,
      // Use the public /api/briefings/video/[date] route, not /api/images/...
      // (which is auth-gated). This URL is what YouTube + embed surfaces use.
      videoUrl: `${appUrl}/api/briefings/video/${tradingDay}`,
      bytes: upload.size,
      durationLog: `${Date.now() - t0}ms`,
    };
  } finally {
    // Best-effort cleanup. tmpfs disposal isn't strictly required but keeps
    // long-running processes tidy.
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

interface MediaInfo {
  durationSec: number;
  width?: number;
  height?: number;
}

/**
 * Probe a media file for duration + (if present) the first video stream's
 * dimensions. Uses `ffmpeg -i` and parses its stderr instead of a dedicated
 * ffprobe binary — Railway's RAILPACK install doesn't reliably ship the
 * `ffprobe-static` vendored binaries (we saw `ENOENT` on linux/x64 in prod),
 * but `ffmpeg-static` always works because the audio mux path already depends
 * on it.
 *
 * ffmpeg exits non-zero when no output is specified, which is what we want —
 * we just need the parseable stderr.
 */
function runFfprobe(file: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    let ffmpegBin: string;
    try {
      ffmpegBin = getFfmpegPath();
    } catch (e) {
      reject(e as Error);
      return;
    }
    const proc = spawn(
      ffmpegBin,
      ["-hide_banner", "-i", file],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    proc.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    proc.on("error", reject);
    proc.on("close", () => {
      // Parse: "Duration: HH:MM:SS.xx, start: …, bitrate: …"
      const dm = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const durationSec = dm
        ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3])
        : 0;
      // Parse: "...: Video: <codec>, <pix_fmt>, WIDTHxHEIGHT [extras]"
      // Anchor on "Video:" then find the first WxH on the same line — keeps
      // working as ffmpeg-static evolves its stream-prefix formatting.
      const vm = stderr.match(/Video:[^\n]*?(\d{2,5})x(\d{2,5})/);
      resolve({
        durationSec,
        width: vm ? Number(vm[1]) : undefined,
        height: vm ? Number(vm[2]) : undefined,
      });
    });
  });
}

/** Seconds of solid OliviaTrades.com card held after the crossfade. */
const CARD_HOLD_SEC = 2.5;
/** Crossfade duration from Olivia → card. */
const CARD_XFADE_SEC = 0.25;

/**
 * Cut a briefing clip at the exact moment narration ends and append a
 * branded end card.
 *
 * Hedra renders to a fixed 20s but the narration length varies (~13-20s).
 * This guarantees a consistent, idle-free outro on *every* video:
 *   1. Probe the ElevenLabs MP3 → exact moment Olivia stops talking.
 *   2. Cut the Hedra clip there. The only footage kept past that point is
 *      the 0.25s the crossfade needs to dissolve from — there is no idle
 *      tail of her sitting silent.
 *   3. Crossfade (0.25s, starting the instant narration ends) into the
 *      static `OliviaTrades.com` card and hold it for 2.5s.
 *   4. Audio is trimmed to narration end and the card tail padded with
 *      silence.
 *
 * Output duration = `narration end + ~2.75s` — varies day to day with
 * narration length, which is fine for a Short.
 *
 * Returns a new MP4 Buffer. Original buffer is not mutated.
 */
export async function applyOutroCard(
  input: Buffer,
  audioKey: string,
): Promise<Buffer> {
  const ffmpegBin = getFfmpegPath();
  const work = await mkdtemp(path.join(tmpdir(), "briefing-outro-"));
  try {
    const inFile = path.join(work, "in.mp4");
    const audioFile = path.join(work, "narration.mp3");
    const outFile = path.join(work, "out.mp4");
    await writeFile(inFile, new Uint8Array(input));

    // Probe the rendered video for dimensions + duration.
    const video = await runFfprobe(inFile);
    const vidW = video.width ?? 720;
    const vidH = video.height ?? 1280;
    const vidDur = video.durationSec || 20;

    // Narration length = the ElevenLabs MP3 duration. Pull it from the bucket
    // and probe it — this is the exact moment Olivia stops speaking.
    const audioObj = await getObjectStream(audioKey);
    if (!audioObj) {
      throw new Error(
        `no audio in bucket at ${audioKey} — cannot time the outro card`,
      );
    }
    await writeFile(
      audioFile,
      new Uint8Array(await streamToBuffer(audioObj.body)),
    );
    const audio = await runFfprobe(audioFile);

    // The crossfade to the card begins the EXACT instant narration ends.
    const narrationEnd =
      Number.isFinite(audio.durationSec) && audio.durationSec > 1
        ? audio.durationSec
        : vidDur - CARD_XFADE_SEC;
    // Cut the Hedra clip just CARD_XFADE_SEC past narration end — only the
    // footage the crossfade dissolves from is kept, never an idle tail.
    const trimPoint = Math.min(narrationEnd + CARD_XFADE_SEC, vidDur);
    // xfade offset = where the transition starts = exactly narration end.
    const xfadeOffset = Math.max(0, trimPoint - CARD_XFADE_SEC);
    // Card input runs hold + xfade so 2.5s of solid card survives the fade.
    const cardInputDur = CARD_HOLD_SEC + CARD_XFADE_SEC;
    const totalDur = trimPoint + CARD_HOLD_SEC;

    const t = trimPoint.toFixed(3);
    const off = xfadeOffset.toFixed(3);
    const total = totalDur.toFixed(3);

    // OPTIONAL — BGM that continues during the outro card hold so the
    // 2.5s after narration ends doesn't drop into silence. We
    // download the same BGM the mux step used and concat a fresh
    // segment onto the trimmed narration audio. If BGM fetch fails,
    // fall back to silent padding (the original behavior).
    let outroBgmFile: string | null = null;
    try {
      const bgmObj = await getObjectStream(BRIEFING_BGM_KEY);
      if (bgmObj) {
        outroBgmFile = path.join(work, "outro-bgm.mp3");
        await writeFile(
          outroBgmFile,
          new Uint8Array(await streamToBuffer(bgmObj.body)),
        );
      }
    } catch {
      // Silent fallback.
    }

    // Audio filter: two paths depending on whether BGM is available.
    let audioFilter: string;
    let audioInputs: string[] = [];
    if (outroBgmFile) {
      // Trim narration audio to the xfade-out point, then concat a
      // CARD_HOLD_SEC segment of BGM (faded in/out) so music carries
      // through the card. Total audio length matches `totalDur`.
      audioInputs = ["-stream_loop", "-1", "-i", outroBgmFile];
      audioFilter =
        `[0:a]atrim=0:${t},asetpts=PTS-STARTPTS,` +
        `afade=t=out:st=${off}:d=${CARD_XFADE_SEC}[narrA];` +
        `[2:a]volume=${BGM_VOLUME},` +
        `atrim=0:${CARD_HOLD_SEC.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `afade=t=in:st=0:d=${CARD_XFADE_SEC},` +
        `afade=t=out:st=${(CARD_HOLD_SEC - 1.0).toFixed(3)}:d=1.0[bgmTail];` +
        `[narrA][bgmTail]concat=n=2:v=0:a=1[a]`;
    } else {
      // Original silent-pad behavior — no BGM available.
      audioFilter =
        `[0:a]atrim=0:${t},asetpts=PTS-STARTPTS,` +
        `afade=t=out:st=${off}:d=${CARD_XFADE_SEC},` +
        `apad=whole_dur=${total}[a]`;
    }

    const args = [
      "-y",
      "-i", inFile,
      "-loop", "1", "-t", cardInputDur.toFixed(3), "-i", OUTRO_CARD_PATH,
      ...audioInputs,
      "-filter_complex",
      // Stream A: Hedra clip trimmed to narration end, normalized.
      `[0:v]trim=0:${t},setpts=PTS-STARTPTS,scale=${vidW}:${vidH},fps=30,format=yuv420p[va];` +
        // Stream B: the card, normalized to match A for xfade.
        `[1:v]scale=${vidW}:${vidH},fps=30,format=yuv420p[vb];` +
        // Crossfade A → card.
        `[va][vb]xfade=transition=fade:duration=${CARD_XFADE_SEC}:offset=${off}[v];` +
        audioFilter,
      "-map", "[v]",
      "-map", "[a]",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-c:a", "aac",
      "-b:a", "192k",
      "-ac", "2",
      "-movflags", "+faststart",
      outFile,
    ];
    await runFfmpeg(ffmpegBin, args);
    return await readFile(outFile);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Probe a media file's duration in seconds. We use ffmpeg's stderr
 * (parsing "Duration: hh:mm:ss.ms") rather than ffprobe so we don't
 * need a second binary at runtime — `ffmpeg-static` ships ffmpeg only.
 *
 * Returns NaN on any parse failure; callers should guard.
 */
async function probeMediaDuration(
  bin: string,
  inputPath: string,
): Promise<number> {
  const stderr = await new Promise<string>((resolve, reject) => {
    const proc = spawn(bin, ["-hide_banner", "-i", inputPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let buf = "";
    proc.stderr.on("data", (c) => {
      buf += c.toString();
    });
    proc.on("error", (err) => reject(err));
    // ffmpeg exits non-zero on `-i <file>` with no output spec —
    // that's expected. We just want the stderr metadata.
    proc.on("close", () => resolve(buf));
  });
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = Number(m[3]);
  return h * 3600 + mi * 60 + s;
}

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `ffmpeg exited ${code}: ${stderr.split("\n").slice(-6).join("\n")}`,
          ),
        );
    });
  });
}
