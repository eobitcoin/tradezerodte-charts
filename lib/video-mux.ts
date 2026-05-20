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
 * ffmpeg-static bundles a platform-appropriate ffmpeg binary in node_modules,
 * so this works in Railway's container without a separate install step.
 */

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { getObjectStream, putObject } from "@/lib/s3";
import { buildBriefingAudioKey } from "@/lib/elevenlabs";

export function buildBriefingVideoKey(tradingDay: string): string {
  return `briefings/${tradingDay}/video.mp4`;
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
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static did not resolve a binary path");
  }
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
    const [videoBytes, audioBytes] = await Promise.all([
      fetchToBuffer(higgsfieldVideoUrl),
      streamToBuffer(audioObj.body),
    ]);

    const videoIn = path.join(work, "in.mp4");
    const audioIn = path.join(work, "in.mp3");
    const videoOut = path.join(work, "out.mp4");
    await writeFile(videoIn, new Uint8Array(videoBytes));
    await writeFile(audioIn, new Uint8Array(audioBytes));

    // 2. ffmpeg mux. Copy video stream (no re-encode), encode audio as AAC,
    //    map audio from the MP3 only, cap to shortest stream.
    const args = [
      "-y",
      "-i", videoIn,
      "-i", audioIn,
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-shortest",
      "-movflags", "+faststart",
      videoOut,
    ];

    await runFfmpeg(ffmpegPath, args);

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

/**
 * Apply a fade-to-black (video + audio) over the trailing portion of an MP4.
 *
 * Why: Hedra clips render to a fixed duration (20s). If Olivia finishes
 * speaking at ~18s, the remaining seconds show her idling — visually awkward.
 * A fade in the last `fadeDurSec` seconds masks the tail without changing the
 * narrative or duration.
 *
 * The fade filter uses fixed `st`/`d` parameters: any clip shorter than
 * `fadeStartSec + fadeDurSec` ends mid-fade (dim rather than fully black),
 * which still looks clean.
 *
 * Returns a new MP4 Buffer. Original buffer is untouched.
 */
export async function applyFadeToBlack(
  input: Buffer,
  fadeStartSec = 18,
  fadeDurSec = 2,
): Promise<Buffer> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static did not resolve a binary path");
  }
  const work = await mkdtemp(path.join(tmpdir(), "briefing-fade-"));
  try {
    const inFile = path.join(work, "in.mp4");
    const outFile = path.join(work, "out.mp4");
    await writeFile(inFile, new Uint8Array(input));
    const args = [
      "-y",
      "-i", inFile,
      "-vf", `fade=t=out:st=${fadeStartSec}:d=${fadeDurSec}`,
      "-af", `afade=t=out:st=${fadeStartSec}:d=${fadeDurSec}`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      outFile,
    ];
    await runFfmpeg(ffmpegPath, args);
    return await readFile(outFile);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
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
