#!/usr/bin/env node
/**
 * One-shot: download the dashboard hero Olivia PNG from Higgsfield CDN and
 * upload it to the Tigris bucket under a stable key. The route at
 * /api/dashboard/hero-poster serves it back so the dashboard isn't
 * dependent on Higgsfield's CloudFront URLs (which may rotate).
 *
 * Re-run any time you want to swap the hero image — pass the new URL via
 * the SOURCE_URL env var, otherwise the script uses the current default.
 *
 * Env:
 *   BUCKET_ENDPOINT            required
 *   BUCKET_NAME                required
 *   BUCKET_ACCESS_KEY_ID       required
 *   BUCKET_SECRET_ACCESS_KEY   required
 *   SOURCE_URL                 optional; defaults to the current hero
 *
 * Usage:
 *   BUCKET_ENDPOINT=... BUCKET_NAME=... BUCKET_ACCESS_KEY_ID=... BUCKET_SECRET_ACCESS_KEY=... \
 *     node scripts/mirror-hero-poster.mjs
 *
 * Or override the source:
 *   SOURCE_URL="https://..." node scripts/mirror-hero-poster.mjs
 */
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const DEFAULT_SOURCE =
  "https://d8j0ntlcm91z4.cloudfront.net/user_3Dr7a4UQeVdIhvZqwokhbnlVyPs/hf_20260621_170829_d06186ba-d120-4600-8107-6c3e2f756807.png";
const SOURCE_URL = process.env.SOURCE_URL || DEFAULT_SOURCE;
const KEY = "dashboard/hero-poster.png";

const endpoint = process.env.BUCKET_ENDPOINT;
const bucket = process.env.BUCKET_NAME;
const accessKeyId = process.env.BUCKET_ACCESS_KEY_ID;
const secretAccessKey = process.env.BUCKET_SECRET_ACCESS_KEY;

if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  console.error("Missing bucket env vars (BUCKET_ENDPOINT / BUCKET_NAME / BUCKET_ACCESS_KEY_ID / BUCKET_SECRET_ACCESS_KEY).");
  process.exit(1);
}

console.log(`Fetching:  ${SOURCE_URL}`);
const res = await fetch(SOURCE_URL);
if (!res.ok) {
  console.error(`Source fetch failed: HTTP ${res.status}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
const contentType = res.headers.get("content-type") || "image/png";
console.log(`Downloaded ${buf.length.toLocaleString()} bytes (${contentType})`);

const s3 = new S3Client({
  endpoint,
  region: process.env.BUCKET_REGION || "auto",
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

console.log(`Uploading to s3://${bucket}/${KEY}`);
await s3.send(
  new PutObjectCommand({
    Bucket: bucket,
    Key: KEY,
    Body: buf,
    ContentType: contentType,
    CacheControl: "public, max-age=604800, immutable",
  }),
);
console.log(`Done. Serve via /api/dashboard/hero-poster`);
