/**
 * Shared briefing-publish logic for YouTube + TikTok.
 *
 * Two callers use these functions:
 *   1. The MCP tools `publish_briefing_to_youtube` / `publish_briefing_to_tiktok`
 *      (the scheduled cron path) — pass `requireApproved: true` so automated
 *      runs only publish rows the admin explicitly approved.
 *   2. The admin "Publish Now" route — passes `requireApproved: false`; the
 *      admin's button click IS the authorization, so the approved-gate is
 *      skipped (idempotency on already-posted still applies).
 *
 * Keeping this in one place means the cron path and the manual path can never
 * drift apart.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefings } from "@/lib/db/schema";

export interface BriefingPublishResult {
  ok: boolean;
  /** posted = success; already_posted = idempotent no-op; failed = upload threw;
   *  blocked = precondition not met (no row, not approved, no video). */
  status: "posted" | "already_posted" | "failed" | "blocked";
  tradingDay: string;
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

/** Drain a Web ReadableStream of bytes into a single Buffer. */
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
  /** When true (cron path), the row's status must be 'approved'. When false
   *  (admin Publish Now), the gate is skipped. Default true. */
  requireApproved?: boolean;
}

export interface YouTubePublishOpts extends PublishOpts {
  privacy?: "public" | "unlisted" | "private";
  isShort?: boolean;
}

/**
 * Publish an approved briefing video to YouTube. Idempotent on a row that's
 * already `posted`. On any upload failure, writes `yt_status='failed'` +
 * `yt_error` so the admin UI surfaces what broke.
 */
export async function publishBriefingToYouTube(
  tradingDay: string,
  opts: YouTubePublishOpts = {},
): Promise<BriefingPublishResult> {
  const requireApproved = opts.requireApproved ?? true;

  const [row] = await db
    .select()
    .from(briefings)
    .where(eq(briefings.tradingDay, tradingDay))
    .limit(1);

  if (!row) {
    return { ok: false, status: "blocked", tradingDay, error: `no briefing row for ${tradingDay}` };
  }
  if (row.ytStatus === "posted" && row.youtubeVideoId) {
    return {
      ok: true,
      status: "already_posted",
      tradingDay,
      youtubeVideoId: row.youtubeVideoId,
      watchUrl: `https://www.youtube.com/watch?v=${row.youtubeVideoId}`,
    };
  }
  if (requireApproved && row.ytStatus !== "approved") {
    return {
      ok: false,
      status: "blocked",
      tradingDay,
      error: `yt_status is "${row.ytStatus ?? "null"}" — must be "approved" to publish. Open /admin/briefings to approve.`,
    };
  }
  if (!row.videoS3Key) {
    return {
      ok: false,
      status: "blocked",
      tradingDay,
      error: `no video available for ${tradingDay} — video_s3_key is null`,
    };
  }

  await db
    .update(briefings)
    .set({ ytStatus: "posting", ytError: null, updatedAt: sql`now()` })
    .where(eq(briefings.tradingDay, tradingDay));

  const { getObjectStream } = await import("@/lib/s3");
  const { buildBriefingVideoKey } = await import("@/lib/video-mux");
  const videoKey = buildBriefingVideoKey(tradingDay);
  const obj = await getObjectStream(videoKey);
  if (!obj) {
    const error = `video not found in bucket at ${videoKey}`;
    await db
      .update(briefings)
      .set({ ytStatus: "failed", ytError: error, updatedAt: sql`now()` })
      .where(eq(briefings.tradingDay, tradingDay));
    return { ok: false, status: "failed", tradingDay, error };
  }
  const videoBuffer = await streamToBuffer(obj.body);

  // Admin-edited title/caption win; defaults fill gaps. Disclaimer is
  // defensively re-appended in case the admin edited it out.
  const title = row.ytTitle?.trim() || `0DTE Morning Brief — ${tradingDay}`;
  const rawDescription =
    row.ytCaption?.trim() ||
    `${row.script ?? ""}\n\nFull brief: https://www.oliviatrades.com/morning-brief/${tradingDay}\n\n#0DTE #Options #DayTrading`;
  const { ensureDisclaimer, YT_DISCLAIMER } = await import("@/lib/briefings-copy");
  const description = ensureDisclaimer(rawDescription, YT_DISCLAIMER);

  // Generate a branded thumbnail with today's signature stat. We pull
  // SPY 0DTE max pain from the max_pain_posts table for the
  // attention-grabbing big number. Falls back gracefully — if the
  // thumbnail generation or data query fails, we publish without one
  // and YouTube auto-picks a frame.
  let thumbnailBuffer: Buffer | undefined;
  try {
    const { maxPainPosts } = await import("@/lib/db/schema");
    const [latestMaxPain] = await db
      .select()
      .from(maxPainPosts)
      .where(eq(maxPainPosts.scanDay, tradingDay))
      .limit(1);
    const spy = latestMaxPain?.tickers?.find((t) => t.ticker === "SPY");
    const spyZeroDte = spy?.expirations?.find(
      (e) => e.exp === tradingDay || e.dte === 0,
    );
    const bigNumber = spyZeroDte?.maxPain ?? spy?.expirations?.[0]?.maxPain;

    if (bigNumber != null) {
      const { generateBriefingThumbnail } = await import(
        "@/lib/thumbnail-generator"
      );
      const buf = await generateBriefingThumbnail({
        videoBuffer,
        tradingDay,
        bigNumber: Math.round(bigNumber),
        bigLabel: "MAX PAIN",
        bigSubLabel: "SPY",
      });
      thumbnailBuffer = buf ?? undefined;
    }
  } catch (err) {
    console.warn(
      `[briefing-publish] thumbnail prep failed for ${tradingDay}, continuing without: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const { uploadBriefingToYouTube } = await import("@/lib/youtube");
    const result = await uploadBriefingToYouTube({
      videoBuffer,
      title,
      description,
      privacyStatus: opts.privacy ?? "public",
      isShort: opts.isShort ?? true,
      thumbnailBuffer,
    });
    await db
      .update(briefings)
      .set({
        ytStatus: "posted",
        ytPostedAt: new Date(),
        youtubeVideoId: result.videoId,
        ytError: null,
        postedAt: row.postedAt ?? new Date(),
        status: "posted",
        updatedAt: sql`now()`,
      })
      .where(eq(briefings.tradingDay, tradingDay));
    return {
      ok: true,
      status: "posted",
      tradingDay,
      youtubeVideoId: result.videoId,
      watchUrl: result.watchUrl,
      privacyStatus: result.privacyStatus,
      elapsedMs: result.elapsedMs,
      bytesUploaded: videoBuffer.length,
    };
  } catch (uploadErr) {
    const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
    await db
      .update(briefings)
      .set({ ytStatus: "failed", ytError: msg.slice(0, 1000), updatedAt: sql`now()` })
      .where(eq(briefings.tradingDay, tradingDay));
    return { ok: false, status: "failed", tradingDay, error: `youtube upload failed: ${msg}` };
  }
}

/**
 * Push an approved briefing video to TikTok's inbox/drafts (Upload to Inbox
 * mode — never auto-publishes). Idempotent on a row that's already `posted`.
 */
export async function publishBriefingToTikTok(
  tradingDay: string,
  opts: PublishOpts = {},
): Promise<BriefingPublishResult> {
  const requireApproved = opts.requireApproved ?? true;

  const [row] = await db
    .select()
    .from(briefings)
    .where(eq(briefings.tradingDay, tradingDay))
    .limit(1);

  if (!row) {
    return { ok: false, status: "blocked", tradingDay, error: `no briefing row for ${tradingDay}` };
  }
  if (row.ttStatus === "posted" && row.ttPublishId) {
    return {
      ok: true,
      status: "already_posted",
      tradingDay,
      ttPublishId: row.ttPublishId,
      note: "Already pushed to TikTok inbox. Open the TikTok app to finalize.",
    };
  }
  if (requireApproved && row.ttStatus !== "approved") {
    return {
      ok: false,
      status: "blocked",
      tradingDay,
      error: `tt_status is "${row.ttStatus ?? "null"}" — must be "approved" to publish. Open /admin/briefings to approve.`,
    };
  }
  if (!row.videoS3Key) {
    return {
      ok: false,
      status: "blocked",
      tradingDay,
      error: `no video available for ${tradingDay} — video_s3_key is null`,
    };
  }

  await db
    .update(briefings)
    .set({ ttStatus: "posting", ttError: null, updatedAt: sql`now()` })
    .where(eq(briefings.tradingDay, tradingDay));

  const { getObjectStream } = await import("@/lib/s3");
  const { buildBriefingVideoKey } = await import("@/lib/video-mux");
  const videoKey = buildBriefingVideoKey(tradingDay);
  const obj = await getObjectStream(videoKey);
  if (!obj) {
    const error = `video not found in bucket at ${videoKey}`;
    await db
      .update(briefings)
      .set({ ttStatus: "failed", ttError: error, updatedAt: sql`now()` })
      .where(eq(briefings.tradingDay, tradingDay));
    return { ok: false, status: "failed", tradingDay, error };
  }
  const videoBuffer = await streamToBuffer(obj.body);

  const { ensureDisclaimer, TT_DISCLAIMER } = await import("@/lib/briefings-copy");
  const captionRaw = row.ttCaption?.trim() || row.script || "";
  const caption = ensureDisclaimer(captionRaw, TT_DISCLAIMER);

  try {
    const { uploadBriefingToTikTok } = await import("@/lib/tiktok");
    const result = await uploadBriefingToTikTok({ videoBuffer, caption });
    await db
      .update(briefings)
      .set({
        ttStatus: "posted",
        ttPostedAt: new Date(),
        ttPublishId: result.publishId,
        ttError: null,
        postedAt: row.postedAt ?? new Date(),
        updatedAt: sql`now()`,
      })
      .where(eq(briefings.tradingDay, tradingDay));
    return {
      ok: true,
      status: "posted",
      tradingDay,
      ttPublishId: result.publishId,
      elapsedMs: result.uploadElapsedMs,
      bytesUploaded: result.bytes,
      note: "Video pushed to TikTok inbox/drafts. Open the TikTok mobile app to finalize and publish.",
    };
  } catch (uploadErr) {
    const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
    await db
      .update(briefings)
      .set({ ttStatus: "failed", ttError: msg.slice(0, 1000), updatedAt: sql`now()` })
      .where(eq(briefings.tradingDay, tradingDay));
    return { ok: false, status: "failed", tradingDay, error: `tiktok upload failed: ${msg}` };
  }
}
