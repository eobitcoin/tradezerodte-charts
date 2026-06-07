/**
 * YouTube thumbnail generator for Olivia Trades briefings.
 *
 * Produces a branded 1280×720 PNG with:
 *   - Big signature number (e.g. "615") + label ("MAX PAIN SPY")
 *   - Day-of-week + date strip
 *   - "0DTE BRIEF" brand mark
 *   - Optional Olivia headshot extracted from the briefing video
 *   - Red + black + yellow color palette matching the ODTE logo
 *
 * Design intent: high CTR in YouTube's recommendation grid. Bold,
 * readable at 320×180 thumbnail size, with one immediately-grabbing
 * data point that reads like trader signal.
 *
 * Returns a Buffer ready for `videos.thumbnails.set` upload.
 */

import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Brand colors — match the ODTE logo we use elsewhere. */
const COLORS = {
  bgDark: "#0a0a0a",
  bgRedTop: "#dc2626",
  bgRedBot: "#7f1d1d",
  accentYellow: "#facc15",
  accentWhite: "#ffffff",
  textMuted: "#a1a1aa",
  panelBlack: "#000000",
} as const;

/** Standard YouTube thumbnail dimensions. */
const WIDTH = 1280;
const HEIGHT = 720;

export interface ThumbnailOpts {
  /** The big number that hooks viewers. e.g. 615, 4823, 0.85. */
  bigNumber: string | number;
  /** Label under/above the number. e.g. "MAX PAIN", "FOMC". */
  bigLabel: string;
  /** Sub-label, usually a ticker. e.g. "SPY", "QQQ". */
  bigSubLabel?: string;
  /** Date string like "MON · JUN 7" for the date strip. */
  dateLabel: string;
  /** Optional path to a headshot PNG/JPEG. If omitted, the number
   *  panel fills more of the canvas. */
  headshotPath?: string;
  /** Override the brand strip text. Defaults to "⚡ 0DTE BRIEF". */
  brandText?: string;
}

/**
 * Render a thumbnail and return the PNG buffer.
 *
 * The layout:
 *   [headshot zone]     |     [big number panel]
 *                       |
 *   ⚡ 0DTE BRIEF · MON · JUN 7
 */
export async function generateThumbnail(
  opts: ThumbnailOpts,
): Promise<Buffer> {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // --- Background: vertical gradient red → dark red, then a black
  //     panel on the right where the number lives. Diagonal split
  //     for visual energy.
  const bgGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bgGrad.addColorStop(0, COLORS.bgRedTop);
  bgGrad.addColorStop(1, COLORS.bgRedBot);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Diagonal black panel for the right-side number block.
  ctx.fillStyle = COLORS.panelBlack;
  ctx.beginPath();
  ctx.moveTo(WIDTH * 0.42, 0);
  ctx.lineTo(WIDTH, 0);
  ctx.lineTo(WIDTH, HEIGHT);
  ctx.lineTo(WIDTH * 0.52, HEIGHT);
  ctx.closePath();
  ctx.fill();

  // --- Headshot zone (left half). If a headshot is provided, draw
  //     it; otherwise the red panel stays clean.
  if (opts.headshotPath) {
    try {
      const headshot = await loadImage(opts.headshotPath);
      // Fit the headshot to a vertical rectangle on the left side,
      // preserving aspect ratio and centering horizontally.
      const hsZoneW = WIDTH * 0.42;
      const hsZoneH = HEIGHT;
      const hsAspect = headshot.width / headshot.height;
      const zoneAspect = hsZoneW / hsZoneH;
      let drawW: number;
      let drawH: number;
      if (hsAspect > zoneAspect) {
        drawH = hsZoneH;
        drawW = drawH * hsAspect;
      } else {
        drawW = hsZoneW;
        drawH = drawW / hsAspect;
      }
      const dx = (hsZoneW - drawW) / 2;
      const dy = (hsZoneH - drawH) / 2;
      ctx.drawImage(headshot, dx, dy, drawW, drawH);

      // Subtle dark gradient overlay on the bottom of the headshot
      // so the brand strip stays readable over varied frames.
      const overlayGrad = ctx.createLinearGradient(0, HEIGHT * 0.65, 0, HEIGHT);
      overlayGrad.addColorStop(0, "rgba(0,0,0,0)");
      overlayGrad.addColorStop(1, "rgba(0,0,0,0.7)");
      ctx.fillStyle = overlayGrad;
      ctx.fillRect(0, HEIGHT * 0.65, hsZoneW, HEIGHT * 0.35);
    } catch (err) {
      console.warn(
        `[thumbnail] headshot load failed (${opts.headshotPath}): ${err instanceof Error ? err.message : String(err)}. Continuing without.`,
      );
    }
  }

  // --- Big number panel (right side, inside the black diagonal).
  //     The number is the visual centerpiece — heavy, bold, fills the
  //     panel.
  const numCenterX = WIDTH * 0.75;
  const numCenterY = HEIGHT * 0.42;
  const numText = String(opts.bigNumber);
  // Pick a font size that lets the number fill its zone. For 1-3 char
  // numbers like "615" or "4823", 240px renders well; cap at 280 for
  // single digits to avoid looking puny.
  const numFontSize =
    numText.length <= 1 ? 280 : numText.length <= 3 ? 240 : 180;
  ctx.fillStyle = COLORS.accentYellow;
  ctx.font = `900 ${numFontSize}px "Arial Black", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Yellow glow for energy.
  ctx.shadowColor = "rgba(250, 204, 21, 0.4)";
  ctx.shadowBlur = 40;
  ctx.fillText(numText, numCenterX, numCenterY);
  ctx.shadowBlur = 0;

  // --- Big label below the number.
  ctx.fillStyle = COLORS.accentWhite;
  ctx.font = "900 64px Arial, sans-serif";
  ctx.fillText(opts.bigLabel.toUpperCase(), numCenterX, numCenterY + numFontSize / 2 + 50);

  // --- Sub-label (ticker), below the big label.
  if (opts.bigSubLabel) {
    ctx.fillStyle = COLORS.accentYellow;
    ctx.font = "900 80px Arial, sans-serif";
    ctx.fillText(
      opts.bigSubLabel.toUpperCase(),
      numCenterX,
      numCenterY + numFontSize / 2 + 130,
    );
  }

  // --- Brand strip across the bottom: "⚡ 0DTE BRIEF · MON · JUN 7"
  const brandText = opts.brandText ?? "⚡ 0DTE BRIEF";
  const dateText = `${brandText}  ·  ${opts.dateLabel}`;
  // Background bar for legibility.
  ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
  ctx.fillRect(0, HEIGHT - 90, WIDTH, 90);
  // Top edge accent line in yellow.
  ctx.fillStyle = COLORS.accentYellow;
  ctx.fillRect(0, HEIGHT - 90, WIDTH, 4);
  // Brand text.
  ctx.fillStyle = COLORS.accentWhite;
  ctx.font = "800 42px Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(dateText, 40, HEIGHT - 45);

  return canvas.toBuffer("image/png");
}

/**
 * Convenience helper — format a Date or ISO string into the
 * "MON · JUN 7" date label the thumbnail expects.
 */
export function formatDateLabel(input: Date | string): string {
  const d = typeof input === "string" ? new Date(`${input}T12:00:00Z`) : input;
  const dow = d.toLocaleString("en-US", {
    weekday: "short",
    timeZone: "America/New_York",
  });
  const month = d.toLocaleString("en-US", {
    month: "short",
    timeZone: "America/New_York",
  });
  const day = d.toLocaleString("en-US", {
    day: "numeric",
    timeZone: "America/New_York",
  });
  return `${dow.toUpperCase()} · ${month.toUpperCase()} ${day}`;
}

/** Force-load any custom fonts. Currently unused — we rely on
 *  system Arial — but keep for future overrides. */
export function registerCustomFonts(): void {
  // Intentional no-op for now. If we ever ship a custom font
  // (e.g. Bebas Neue for the big number), call GlobalFonts.registerFromPath
  // here.
  void GlobalFonts;
}

/**
 * Extract a still frame from a video buffer via ffmpeg.
 *
 * We pull the frame at `secondsIn` (default 3s) so Olivia is past the
 * opening greeting and visibly mid-sentence — usually a more
 * expressive shot than t=0. Returns a PNG-encoded Buffer ready to
 * pass to `generateThumbnail` as `headshotPath` (after the caller
 * writes it to disk) — or use `extractHeadshotToFile` to write it
 * to a tmp file directly.
 */
export async function extractHeadshotToFile(
  videoBuffer: Buffer,
  secondsIn = 3,
): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const work = await mkdtemp(path.join(tmpdir(), "thumb-headshot-"));
  const videoIn = path.join(work, "in.mp4");
  const frameOut = path.join(work, "frame.png");
  await writeFile(videoIn, new Uint8Array(videoBuffer));

  const ffmpegBin = resolveFfmpeg();
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      ffmpegBin,
      [
        "-y",
        "-ss", String(secondsIn),
        "-i", videoIn,
        "-frames:v", "1",
        "-q:v", "2",
        frameOut,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    proc.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `ffmpeg frame extract failed ${code}: ${stderr.split("\n").slice(-4).join("\n")}`,
          ),
        );
    });
  });

  return {
    filePath: frameOut,
    cleanup: async () => {
      await rm(work, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/** Resolve a usable ffmpeg binary. Mirrors lib/video-mux.ts's
 *  getFfmpegPath() — looks at the common system locations. */
function resolveFfmpeg(): string {
  const candidates = [
    process.env.FFMPEG_PATH,
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
  ].filter(Boolean) as string[];
  // Just return the first one — runtime errors will surface if it's
  // not actually executable. Same pragmatic approach as video-mux.ts.
  return candidates[0] ?? "ffmpeg";
}

/**
 * Higher-level helper — given the briefing video buffer, signature
 * data, and a trading day, render the final thumbnail buffer ready
 * to upload to YouTube.
 *
 * Use this from `briefing-publish.ts` — handles headshot extraction,
 * temp file cleanup, and date formatting in one call.
 *
 * Returns null on any failure (e.g. ffmpeg missing) so the caller
 * can fall back to YouTube's auto-generated thumbnail without
 * breaking the publish.
 */
export async function generateBriefingThumbnail(opts: {
  videoBuffer: Buffer;
  tradingDay: string;
  bigNumber: string | number;
  bigLabel: string;
  bigSubLabel?: string;
}): Promise<Buffer | null> {
  let headshotPath: string | undefined;
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const extracted = await extractHeadshotToFile(opts.videoBuffer, 3);
    headshotPath = extracted.filePath;
    cleanup = extracted.cleanup;
  } catch (err) {
    console.warn(
      `[thumbnail] headshot extraction failed: ${err instanceof Error ? err.message : String(err)}. Generating thumbnail without headshot.`,
    );
  }
  try {
    const buf = await generateThumbnail({
      bigNumber: opts.bigNumber,
      bigLabel: opts.bigLabel,
      bigSubLabel: opts.bigSubLabel,
      dateLabel: formatDateLabel(opts.tradingDay),
      headshotPath,
    });
    return buf;
  } catch (err) {
    console.warn(
      `[thumbnail] generation failed: ${err instanceof Error ? err.message : String(err)}. YouTube will auto-generate.`,
    );
    return null;
  } finally {
    if (cleanup) await cleanup();
  }
}
