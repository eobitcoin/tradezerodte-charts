#!/usr/bin/env node
/**
 * One-off uploader for the briefing-video background music asset.
 *
 * The mux pipeline (lib/video-mux.ts) downloads this file alongside the
 * voiceover MP3 on every render and ducks it under the voice. Upload
 * once, then bump the version key when you swap to a new track.
 *
 * Env (must match `lib/s3.ts`):
 *   BUCKET_ENDPOINT, BUCKET_REGION, BUCKET_NAME
 *   BUCKET_ACCESS_KEY_ID, BUCKET_SECRET_ACCESS_KEY
 *   BUCKET_FORCE_PATH_STYLE  optional, "true" to force path-style
 *
 * Usage:
 *   node scripts/upload-briefing-bgm.mjs <path-to-mp3> [bucket-key]
 *
 * Default key: bgm/olivia_pulse_v1.mp3
 */

import { readFile } from "node:fs/promises";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const [, , filePath, keyArg] = process.argv;
if (!filePath) {
  console.error("Usage: node scripts/upload-briefing-bgm.mjs <path> [key]");
  process.exit(1);
}
const key = keyArg ?? "bgm/olivia_pulse_v1.mp3";

const required = [
  "BUCKET_ENDPOINT",
  "BUCKET_NAME",
  "BUCKET_ACCESS_KEY_ID",
  "BUCKET_SECRET_ACCESS_KEY",
];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`${k} is required.`);
    process.exit(1);
  }
}

const client = new S3Client({
  region: process.env.BUCKET_REGION || "auto",
  endpoint: process.env.BUCKET_ENDPOINT,
  credentials: {
    accessKeyId: process.env.BUCKET_ACCESS_KEY_ID,
    secretAccessKey: process.env.BUCKET_SECRET_ACCESS_KEY,
  },
  forcePathStyle: process.env.BUCKET_FORCE_PATH_STYLE === "true",
});

const body = await readFile(filePath);
console.log(`Uploading ${filePath} (${body.length} bytes) → ${key}`);

await client.send(
  new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: "audio/mpeg",
    CacheControl: "public, max-age=31536000, immutable",
  }),
);

console.log(`✓ Uploaded to s3://${process.env.BUCKET_NAME}/${key}`);
