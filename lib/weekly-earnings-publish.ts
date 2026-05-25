/**
 * Weekly Earnings Brief publish logic for YouTube + TikTok.
 *
 * Parallel to `lib/briefing-publish.ts` (daily) — same shape, same guarantees,
 * different table (`weeklyEarningsBriefings`) and different natural key
 * (`weekAnchor` rather than `tradingDay`). Both callers:
 *
 *   1. MCP tools `publish_weekly_to_youtube` / `publish_weekly_to_tiktok`
 *      (cron path) — `requireApproved: true` so scheduled runs only push rows
 *      the admin explicitly approved.
 *   2. Admin "Publish Now" route — `requireApproved: false`; the click IS
 *      the authorization (idempotency on already-posted still applies).
 *
 * The generic uploaders (`lib/youtube.ts`, `lib/tiktok.ts`) are shared with
 * the daily flow — only the row read/write and the default copy differ.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { weeklyEarningsBriefings } from "@/lib/db/schema";

export interface WeeklyEarningsPublishResult {
  ok: boolean;
  status: "posted" | "already_posted" | "failed" | "blocked";
  weekAnchor: string;
  error?: string;
  // YouTube
  youtubeVideoId?: string;
  watchUrl?: string;
  privacyStatus?: string;
  // TikTok
  ttPublishId?: string;
  // common
  elapsedMs?: number;
  bytesUploaded?: number;
  note?: string;
}

async function streamToBuffer(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

export interface PublishOpts {
  requireApproved?: boolean;
}
export interface YouTubePublishOpts extends PublishOpts {
  privacy?: "public" | "unlisted" | "private";
  isShort?: boolean;
}

/**
 * Render a default YouTube title for a Sunday brief — e.g.
 * "Weekly Earnings Brief — Week of May 25, 2026". Stays under YT's 100-char
 * cap. Same shape across all weeks; admin can override per-row.
 */
function defaultWeeklyTitle(weekAnchor: string): string {
  const sun = new Date(`${weekAnchor}T12:00:00Z`);
  const mon = new Date(sun);
  mon.setUTCDate(sun.getUTCDate() + 1);
  const label = mon.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `Weekly Earnings Brief — Week of ${label}`;
}

/**
 * Render a default YouTube description: script body + tagline + link +
 * hashtags. Disclaimer is appended downstream via `ensureDisclaimer`.
 */
function defaultWeeklyYtDescription(script: string | null): string {
  const body = script?.trim() || "This week's earnings prints to watch.";
  return (
    `${body}\n\n` +
    `Full weekly earnings book: https://www.oliviatrades.com/morning-brief/earnings\n\n` +
    `#EarningsWeek #Options #IV #Earnings #StockMarket #Trading`
  );
}

/**
 * Default TikTok caption — tighter, hashtag-heavy, leads with the first
 * sentence of the script.
 */
function defaultWeeklyTtCaption(script: string | null): string {
  const hook = script?.trim().split(/[.!?]/)[0] || "This week's earnings setups.";
  return `${hook}\n\n#EarningsWeek #Options #IV #StockMarket`;
}

export async function publishWeeklyEarningsToYouTube(
  weekAnchor: string,
  opts: YouTubePublishOpts = {},
): Promise<WeeklyEarningsPublishResult> {
  const requireApproved = opts.requireApproved ?? true;

  const [row] = await db
    .select()
    .from(weeklyEarningsBriefings)
    .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor))
    .limit(1);

  if (!row) {
    return {
      ok: false,
      status: "blocked",
      weekAnchor,
      error: `no weekly briefing row for ${weekAnchor}`,
    };
  }
  if (row.ytStatus === "posted" && row.youtubeVideoId) {
    return {
      ok: true,
      status: "already_posted",
      weekAnchor,
      youtubeVideoId: row.youtubeVideoId,
      watchUrl: `https://www.youtube.com/watch?v=${row.youtubeVideoId}`,
    };
  }
  if (requireApproved && row.ytStatus !== "approved") {
    return {
      ok: false,
      status: "blocked",
      weekAnchor,
      error: `yt_status is "${row.ytStatus ?? "null"}" — must be "approved" to publish. Open /admin/briefings/weekly to approve.`,
    };
  }
  if (!row.videoS3Key) {
    return {
      ok: false,
      status: "blocked",
      weekAnchor,
      error: `no video available for week ${weekAnchor} — video_s3_key is null`,
    };
  }

  await db
    .update(weeklyEarningsBriefings)
    .set({ ytStatus: "posting", ytError: null, updatedAt: sql`now()` })
    .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor));

  const { getObjectStream } = await import("@/lib/s3");
  const { buildWeeklyEarningsVideoKey } = await import("@/lib/video-mux");
  const videoKey = buildWeeklyEarningsVideoKey(weekAnchor);
  const obj = await getObjectStream(videoKey);
  if (!obj) {
    const error = `video not found in bucket at ${videoKey}`;
    await db
      .update(weeklyEarningsBriefings)
      .set({ ytStatus: "failed", ytError: error, updatedAt: sql`now()` })
      .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor));
    return { ok: false, status: "failed", weekAnchor, error };
  }
  const videoBuffer = await streamToBuffer(obj.body);

  const title = row.ytTitle?.trim() || defaultWeeklyTitle(weekAnchor);
  const rawDescription =
    row.ytCaption?.trim() || defaultWeeklyYtDescription(row.script);
  const { ensureDisclaimer, YT_DISCLAIMER } = await import("@/lib/briefings-copy");
  const description = ensureDisclaimer(rawDescription, YT_DISCLAIMER);

  try {
    const { uploadBriefingToYouTube } = await import("@/lib/youtube");
    const result = await uploadBriefingToYouTube({
      videoBuffer,
      title,
      description,
      privacyStatus: opts.privacy ?? "public",
      isShort: opts.isShort ?? true,
    });
    await db
      .update(weeklyEarningsBriefings)
      .set({
        ytStatus: "posted",
        ytPostedAt: new Date(),
        youtubeVideoId: result.videoId,
        ytError: null,
        postedAt: row.postedAt ?? new Date(),
        status: "posted",
        updatedAt: sql`now()`,
      })
      .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor));
    return {
      ok: true,
      status: "posted",
      weekAnchor,
      youtubeVideoId: result.videoId,
      watchUrl: result.watchUrl,
      privacyStatus: result.privacyStatus,
      elapsedMs: result.elapsedMs,
      bytesUploaded: videoBuffer.length,
    };
  } catch (uploadErr) {
    const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
    await db
      .update(weeklyEarningsBriefings)
      .set({ ytStatus: "failed", ytError: msg.slice(0, 1000), updatedAt: sql`now()` })
      .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor));
    return { ok: false, status: "failed", weekAnchor, error: `youtube upload failed: ${msg}` };
  }
}

export async function publishWeeklyEarningsToTikTok(
  weekAnchor: string,
  opts: PublishOpts = {},
): Promise<WeeklyEarningsPublishResult> {
  const requireApproved = opts.requireApproved ?? true;

  const [row] = await db
    .select()
    .from(weeklyEarningsBriefings)
    .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor))
    .limit(1);

  if (!row) {
    return {
      ok: false,
      status: "blocked",
      weekAnchor,
      error: `no weekly briefing row for ${weekAnchor}`,
    };
  }
  if (row.ttStatus === "posted" && row.ttPublishId) {
    return {
      ok: true,
      status: "already_posted",
      weekAnchor,
      ttPublishId: row.ttPublishId,
      note: "Already pushed to TikTok inbox. Open the TikTok app to finalize.",
    };
  }
  if (requireApproved && row.ttStatus !== "approved") {
    return {
      ok: false,
      status: "blocked",
      weekAnchor,
      error: `tt_status is "${row.ttStatus ?? "null"}" — must be "approved" to publish. Open /admin/briefings/weekly to approve.`,
    };
  }
  if (!row.videoS3Key) {
    return {
      ok: false,
      status: "blocked",
      weekAnchor,
      error: `no video available for week ${weekAnchor} — video_s3_key is null`,
    };
  }

  await db
    .update(weeklyEarningsBriefings)
    .set({ ttStatus: "posting", ttError: null, updatedAt: sql`now()` })
    .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor));

  const { getObjectStream } = await import("@/lib/s3");
  const { buildWeeklyEarningsVideoKey } = await import("@/lib/video-mux");
  const videoKey = buildWeeklyEarningsVideoKey(weekAnchor);
  const obj = await getObjectStream(videoKey);
  if (!obj) {
    const error = `video not found in bucket at ${videoKey}`;
    await db
      .update(weeklyEarningsBriefings)
      .set({ ttStatus: "failed", ttError: error, updatedAt: sql`now()` })
      .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor));
    return { ok: false, status: "failed", weekAnchor, error };
  }
  const videoBuffer = await streamToBuffer(obj.body);

  const { ensureDisclaimer, TT_DISCLAIMER } = await import("@/lib/briefings-copy");
  const captionRaw = row.ttCaption?.trim() || defaultWeeklyTtCaption(row.script);
  const caption = ensureDisclaimer(captionRaw, TT_DISCLAIMER);

  try {
    const { uploadBriefingToTikTok } = await import("@/lib/tiktok");
    const result = await uploadBriefingToTikTok({ videoBuffer, caption });
    await db
      .update(weeklyEarningsBriefings)
      .set({
        ttStatus: "posted",
        ttPostedAt: new Date(),
        ttPublishId: result.publishId,
        ttError: null,
        postedAt: row.postedAt ?? new Date(),
        updatedAt: sql`now()`,
      })
      .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor));
    return {
      ok: true,
      status: "posted",
      weekAnchor,
      ttPublishId: result.publishId,
      elapsedMs: result.uploadElapsedMs,
      bytesUploaded: result.bytes,
      note: "Video pushed to TikTok inbox/drafts. Open the TikTok mobile app to finalize and publish.",
    };
  } catch (uploadErr) {
    const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
    await db
      .update(weeklyEarningsBriefings)
      .set({ ttStatus: "failed", ttError: msg.slice(0, 1000), updatedAt: sql`now()` })
      .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor));
    return { ok: false, status: "failed", weekAnchor, error: `tiktok upload failed: ${msg}` };
  }
}

/** Public copy of the default-renderers so the admin UI can pre-fill empty
 *  fields with the exact same strings the publish path will fall back to. */
export const weeklyDefaults = {
  ytTitle: defaultWeeklyTitle,
  ytDescription: defaultWeeklyYtDescription,
  ttCaption: defaultWeeklyTtCaption,
};
