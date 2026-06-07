/**
 * One-off TikTok upload test — used for the App Review demo recording.
 *
 * Pushes a sample MP4 to the channel owner's TikTok inbox so the demo
 * video can show the end-to-end flow:
 *   1. OAuth dance (scripts/tiktok-auth.ts captures refresh token)
 *   2. THIS script demonstrates the inbox upload working
 *   3. The video appears in the TikTok mobile app inbox/drafts
 *
 * Usage:
 *   export TT_CLIENT_KEY=...
 *   export TT_CLIENT_SECRET=...
 *   export TT_REFRESH_TOKEN=...
 *   npx tsx scripts/tiktok-test-upload.ts <path-to-mp4>
 *
 * Example:
 *   npx tsx scripts/tiktok-test-upload.ts ~/Desktop/test-bgm-2026-05-29.mp4
 */

import { readFile } from "node:fs/promises";
import { uploadBriefingToTikTok } from "../lib/tiktok";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npx tsx scripts/tiktok-test-upload.ts <path-to-mp4>");
    process.exit(1);
  }

  for (const k of ["TT_CLIENT_KEY", "TT_CLIENT_SECRET", "TT_REFRESH_TOKEN"]) {
    if (!process.env[k]) {
      console.error(`${k} env var is required.`);
      process.exit(1);
    }
  }

  console.log(`Reading: ${path}`);
  const videoBuffer = await readFile(path);
  console.log(`  ${videoBuffer.length.toLocaleString()} bytes`);

  console.log("\nPushing to TikTok inbox via Content Posting API...");
  const t0 = Date.now();
  const result = await uploadBriefingToTikTok({
    videoBuffer,
    caption: "Olivia Trades — TikTok integration test (demo for App Review)",
  });

  console.log("\n✓ Upload complete");
  console.log(`  publish_id:    ${result.publishId}`);
  console.log(`  bytes:         ${result.bytes.toLocaleString()}`);
  console.log(`  elapsed:       ${result.uploadElapsedMs}ms (total ${Date.now() - t0}ms)`);
  console.log("\nOpen the TikTok mobile app → Inbox / drafts.");
  console.log("The video should appear there shortly (1-2 minutes for TikTok to process).");
}

main().catch((err) => {
  console.error("\n✗ Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
