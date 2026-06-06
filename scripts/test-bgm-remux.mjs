#!/usr/bin/env node
/**
 * Local BGM-mix test script.
 *
 * Takes an existing briefing video by tradingDay, downloads the voice
 * MP3 from the bucket, runs the same ffmpeg filter graph that
 * production uses, and saves the result to disk so you can preview
 * the mix before shipping. Does NOT overwrite anything in production.
 *
 * Usage:
 *   node scripts/test-bgm-remux.mjs <tradingDay> <path-to-bgm.mp3>
 *
 * Example:
 *   node scripts/test-bgm-remux.mjs 2026-05-29 ./olivia_pulse2_bgm_raw.mp3
 *
 * Output: ~/Desktop/test-bgm-<tradingDay>.mp4
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const execFileP = promisify(execFile);

const [, , tradingDay, bgmPath] = process.argv;
if (!tradingDay || !bgmPath) {
  console.error(
    "Usage: node scripts/test-bgm-remux.mjs <tradingDay> <path-to-bgm.mp3>",
  );
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay)) {
  console.error("tradingDay must be YYYY-MM-DD");
  process.exit(1);
}

for (const k of [
  "BUCKET_ENDPOINT",
  "BUCKET_NAME",
  "BUCKET_ACCESS_KEY_ID",
  "BUCKET_SECRET_ACCESS_KEY",
]) {
  if (!process.env[k]) {
    console.error(`${k} is required.`);
    process.exit(1);
  }
}

const s3 = new S3Client({
  region: process.env.BUCKET_REGION || "auto",
  endpoint: process.env.BUCKET_ENDPOINT,
  credentials: {
    accessKeyId: process.env.BUCKET_ACCESS_KEY_ID,
    secretAccessKey: process.env.BUCKET_SECRET_ACCESS_KEY,
  },
  forcePathStyle: process.env.BUCKET_FORCE_PATH_STYLE === "true",
});

async function bucketGet(key) {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: process.env.BUCKET_NAME, Key: key }),
  );
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

console.log(`Fetching production assets for ${tradingDay}...`);

// Fetch the existing muxed briefing video via the public route. Its
// video stream has the lip-sync; we'll discard its audio and replace.
const videoUrl = `${APP_URL}/api/briefings/video/${tradingDay}`;
const videoRes = await fetch(videoUrl);
if (!videoRes.ok) {
  console.error(
    `Briefing video for ${tradingDay} not found at ${videoUrl} (HTTP ${videoRes.status})`,
  );
  process.exit(1);
}
const videoBytes = Buffer.from(await videoRes.arrayBuffer());
console.log(`  video:  ${videoBytes.length} bytes`);

// Voice from the briefingAudio key. Matches the production pattern
// in lib/elevenlabs.ts → buildBriefingAudioKey().
const audioKey = `briefings/${tradingDay}/voiceover.mp3`;
let audioBytes;
try {
  audioBytes = await bucketGet(audioKey);
  console.log(`  voice:  ${audioBytes.length} bytes (key: ${audioKey})`);
} catch (err) {
  console.error(`Voice MP3 not found at ${audioKey}: ${err.message}`);
  process.exit(1);
}

const bgmBytes = await readFile(bgmPath);
console.log(`  bgm:    ${bgmBytes.length} bytes (local: ${bgmPath})`);

const work = await mkdtemp(path.join(tmpdir(), "bgm-test-"));
const videoIn = path.join(work, "in.mp4");
const audioIn = path.join(work, "in.mp3");
const bgmIn = path.join(work, "bgm.mp3");
const outPath = path.join(homedir(), "Desktop", `test-bgm-${tradingDay}.mp4`);

await writeFile(videoIn, videoBytes);
await writeFile(audioIn, audioBytes);
await writeFile(bgmIn, bgmBytes);

// Probe voice duration so we can place the fade-out at the END
// (not the start — that would silence the bulk of the clip).
const probe = await execFileP("ffprobe", [
  "-v", "error",
  "-show_entries", "format=duration",
  "-of", "default=noprint_wrappers=1:nokey=1",
  audioIn,
]);
const voiceDuration = parseFloat(probe.stdout.trim());
if (!Number.isFinite(voiceDuration) || voiceDuration <= 0) {
  console.error("Could not determine voice duration via ffprobe");
  process.exit(1);
}
const fadeOutSec = 2.5;
const fadeOutStart = Math.max(0, voiceDuration - fadeOutSec);
console.log(
  `  voice duration: ${voiceDuration.toFixed(2)}s → fade-out starts at ${fadeOutStart.toFixed(2)}s`,
);

// amix normalize=0 → voice stays at true level; only BGM responds to
// volume tweaks. Default normalize=1 divides by inputs and made the
// voice get louder whenever BGM got louder.
const filter =
  `[2:a]volume=0.20,afade=t=in:st=0:d=1.5[bgmA];` +
  `[bgmA][1:a]sidechaincompress=threshold=0.05:ratio=6:attack=5:release=350[bgmD];` +
  `[1:a][bgmD]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,` +
  `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutSec}:curve=tri[mixed]`;

const args = [
  "-y",
  "-i", videoIn,
  "-i", audioIn,
  "-stream_loop", "-1", "-i", bgmIn,
  "-filter_complex", filter,
  "-c:v", "copy",
  "-c:a", "aac",
  "-b:a", "192k",
  "-ac", "2",
  "-map", "0:v:0",
  "-map", "[mixed]",
  "-shortest",
  "-movflags", "+faststart",
  outPath,
];

console.log("Running ffmpeg...");
const t0 = Date.now();
const ffmpegBin =
  process.env.FFMPEG_PATH ||
  (process.platform === "darwin" ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg");
try {
  await execFileP(ffmpegBin, args, { maxBuffer: 1024 * 1024 * 50 });
} catch (err) {
  console.error("ffmpeg failed:");
  console.error(err.stderr?.toString() || err.message);
  process.exit(1);
}
console.log(`Mux done in ${Date.now() - t0}ms.`);

// =========================================================================
// PART 2 — apply outro card with continued BGM (full pipeline simulation)
// =========================================================================
console.log("\nApplying outro card with continued BGM...");
const t1 = Date.now();

// Look for the outro PNG in the standard project location.
const outroCardPath = path.join(
  process.cwd(),
  "public/assets/briefing-outro.png",
);

// Constants must match lib/video-mux.ts.
const CARD_HOLD_SEC = 2.5;
const CARD_XFADE_SEC = 0.25;

// Probe the muxed video for dimensions + duration. Re-use ffmpeg via -i.
async function probeFile(file) {
  const probe = await execFileP(ffmpegBin, ["-hide_banner", "-i", file], {
    reject: false,
  }).catch((e) => ({ stderr: e.stderr?.toString() || "" }));
  const stderr = probe.stderr || "";
  const durM = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const dur =
    durM && Number(durM[1]) * 3600 + Number(durM[2]) * 60 + Number(durM[3]);
  const dimM = stderr.match(/Video:[^\n]*?(\d{2,5})x(\d{2,5})/);
  return {
    durationSec: Number.isFinite(dur) ? dur : NaN,
    width: dimM ? Number(dimM[1]) : 720,
    height: dimM ? Number(dimM[2]) : 1280,
  };
}

const muxed = await probeFile(outPath);
const audio = await probeFile(audioIn);
const vidDur = muxed.durationSec || 20;
const vidW = muxed.width;
const vidH = muxed.height;

const narrationEnd =
  Number.isFinite(audio.durationSec) && audio.durationSec > 1
    ? audio.durationSec
    : vidDur - CARD_XFADE_SEC;
const trimPoint = Math.min(narrationEnd + CARD_XFADE_SEC, vidDur);
const xfadeOffset = Math.max(0, trimPoint - CARD_XFADE_SEC);
const cardInputDur = CARD_HOLD_SEC + CARD_XFADE_SEC;

const tStr = trimPoint.toFixed(3);
const offStr = xfadeOffset.toFixed(3);
const outroOut = path.join(homedir(), "Desktop", `test-bgm-outro-${tradingDay}.mp4`);

const audioFilter =
  `[0:a]atrim=0:${tStr},asetpts=PTS-STARTPTS,` +
  `afade=t=out:st=${offStr}:d=${CARD_XFADE_SEC}[narrA];` +
  `[2:a]volume=0.20,` +
  `atrim=0:${CARD_HOLD_SEC.toFixed(3)},asetpts=PTS-STARTPTS,` +
  `afade=t=in:st=0:d=${CARD_XFADE_SEC},` +
  `afade=t=out:st=${(CARD_HOLD_SEC - 1.0).toFixed(3)}:d=1.0[bgmTail];` +
  `[narrA][bgmTail]concat=n=2:v=0:a=1[a]`;

const outroArgs = [
  "-y",
  "-i", outPath,
  "-loop", "1", "-t", cardInputDur.toFixed(3), "-i", outroCardPath,
  "-stream_loop", "-1", "-i", bgmIn,
  "-filter_complex",
  `[0:v]trim=0:${tStr},setpts=PTS-STARTPTS,scale=${vidW}:${vidH},fps=30,format=yuv420p[va];` +
    `[1:v]scale=${vidW}:${vidH},fps=30,format=yuv420p[vb];` +
    `[va][vb]xfade=transition=fade:duration=${CARD_XFADE_SEC}:offset=${offStr}[v];` +
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
  outroOut,
];

try {
  await execFileP(ffmpegBin, outroArgs, { maxBuffer: 1024 * 1024 * 50 });
} catch (err) {
  console.error("outro ffmpeg failed:");
  console.error(err.stderr?.toString() || err.message);
  process.exit(1);
}
console.log(`Outro done in ${Date.now() - t1}ms.`);
console.log(`✓ Full pipeline output: ${outroOut}`);
console.log(`  (mux-only intermediate kept at: ${outPath})`);

await rm(work, { recursive: true, force: true }).catch(() => {});

// Auto-open the FINAL output on macOS (with outro card)
if (process.platform === "darwin") {
  try {
    await execFileP("open", [outroOut]);
  } catch {}
}
