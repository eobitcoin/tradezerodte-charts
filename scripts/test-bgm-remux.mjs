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

const filter =
  `[2:a]volume=0.08,afade=t=in:st=0:d=1.5[bgmA];` +
  `[bgmA][1:a]sidechaincompress=threshold=0.05:ratio=6:attack=5:release=350[bgmD];` +
  `[1:a][bgmD]amix=inputs=2:duration=first:dropout_transition=0,` +
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
console.log(`Done in ${Date.now() - t0}ms.`);
console.log(`✓ Output: ${outPath}`);

await rm(work, { recursive: true, force: true }).catch(() => {});

// Auto-open on macOS
if (process.platform === "darwin") {
  try {
    await execFileP("open", [outPath]);
  } catch {}
}
