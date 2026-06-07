#!/usr/bin/env node
/**
 * Local preview of the YouTube thumbnail generator.
 *
 * Usage:
 *   node scripts/test-thumbnail.mjs
 *
 * Optionally pass overrides:
 *   node scripts/test-thumbnail.mjs --number=4823 --label="ATH" --ticker=SPY
 *
 * Saves to ~/Desktop/thumbnail-preview.png and auto-opens.
 *
 * Optionally generates a headshot from an existing briefing video:
 *   node scripts/test-thumbnail.mjs --video=~/Desktop/test-bgm-outro-2026-05-29.mp4
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";

const execFileP = promisify(execFile);

async function main() {
  // Parse simple --key=value args
  const args = process.argv.slice(2);
  const opts = Object.fromEntries(
    args
      .filter((a) => a.startsWith("--"))
      .map((a) => {
        const [k, ...v] = a.slice(2).split("=");
        return [k, v.join("=")];
      }),
  );

  const bigNumber = opts.number ?? "615";
  const bigLabel = opts.label ?? "MAX PAIN";
  const bigSubLabel = opts.ticker ?? "SPY";
  const dateLabel = opts.date ?? "MON · JUN 7";
  // Expand ~ in video path manually — Node doesn't do shell expansion.
  const videoPath = opts.video
    ? opts.video.replace(/^~(?=$|\/|\\)/, homedir())
    : undefined;

  let headshotPath: string | undefined;
  let work: string | undefined;
  if (videoPath) {
    work = await mkdtemp(path.join(tmpdir(), "thumb-test-"));
    headshotPath = path.join(work, "headshot.png");
    console.log(`Extracting headshot from ${videoPath}...`);
    await execFileP("/opt/homebrew/bin/ffmpeg", [
      "-y",
      "-ss", "3",
      "-i", videoPath,
      "-frames:v", "1",
      "-q:v", "2",
      headshotPath,
    ]);
    console.log(`  saved ${headshotPath}`);
  }

  console.log("Generating thumbnail...");
  const { generateThumbnail } = await import("../lib/thumbnail-generator");

  const buf = await generateThumbnail({
    bigNumber,
    bigLabel,
    bigSubLabel,
    dateLabel,
    headshotPath,
  });

  const outPath = path.join(homedir(), "Desktop", "thumbnail-preview.png");
  await writeFile(outPath, buf);

  console.log(`✓ Thumbnail written: ${outPath} (${buf.length} bytes)`);

  if (work) {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }

  if (process.platform === "darwin") {
    try {
      await execFileP("open", [outPath]);
    } catch {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
