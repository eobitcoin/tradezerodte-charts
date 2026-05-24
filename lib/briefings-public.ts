/**
 * Server-side query helpers for the public /morning-brief pages.
 *
 * SECURITY MODEL
 * Public visitors should see ONLY the bits that are intentionally public:
 *   - tradingDay
 *   - script (the spoken voiceover — same content as the YouTube video)
 *   - videoS3Key (the public video URL, only when status >= pending_upload)
 *   - thumbnailUrl
 *   - postedAt
 *
 * We do NOT expose:
 *   - setting_prompt (internal artistic direction)
 *   - meta (contains higgsfield_generation_id, voice settings, internal traces)
 *   - error_log (operational diagnostics)
 *   - higgsfieldJobId
 *   - status (internal pipeline state)
 *
 * The projection happens at the DB-query layer here, never in the view, so a
 * stray `JSON.stringify(briefing)` in a public component can't leak internals.
 */

import { and, desc, eq, isNotNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefings, posts, weeklyEarningsBriefings } from "@/lib/db/schema";

export interface PublicBriefing {
  tradingDay: string;
  script: string;
  /** Public URL to the muxed MP4 (our bucket). */
  videoUrl: string;
  /** Optional thumbnail. */
  thumbnailUrl: string | null;
  /** When the video first became available. */
  postedAt: Date | null;
}

export interface PublicBriefingWithCalls extends PublicBriefing {
  /** Top 3 ticker calls from the premarket scan — just ticker, direction,
   *  grade. Same info Olivia speaks; lets the per-day page render a static
   *  "calls of the day" list without re-parsing the script. */
  calls: Array<{
    ticker: string;
    direction: string | null;
    grade: string | null;
  }>;
}

/**
 * Visible filter — briefing must have a video URL (i.e. the daily routine
 * produced something members can actually watch). Excludes failed runs,
 * still-in-progress, and rows that never got past `scripted`.
 */
function hasVideoFilter() {
  return and(
    isNotNull(briefings.videoS3Key),
    or(
      eq(briefings.status, "pending_upload"),
      eq(briefings.status, "uploading"),
      eq(briefings.status, "posted"),
    ),
  );
}

export async function loadLatestBriefing(): Promise<PublicBriefing | null> {
  const [row] = await db
    .select({
      tradingDay: briefings.tradingDay,
      script: briefings.script,
      videoS3Key: briefings.videoS3Key,
      thumbnailUrl: briefings.thumbnailUrl,
      postedAt: briefings.postedAt,
      updatedAt: briefings.updatedAt,
    })
    .from(briefings)
    .where(hasVideoFilter())
    .orderBy(desc(briefings.tradingDay))
    .limit(1);
  if (!row || !row.script || !row.videoS3Key) return null;
  return {
    tradingDay: row.tradingDay,
    script: row.script,
    videoUrl: row.videoS3Key,
    thumbnailUrl: row.thumbnailUrl,
    postedAt: row.postedAt ?? row.updatedAt,
  };
}

export async function loadBriefingArchive(limit = 60): Promise<PublicBriefing[]> {
  const rows = await db
    .select({
      tradingDay: briefings.tradingDay,
      script: briefings.script,
      videoS3Key: briefings.videoS3Key,
      thumbnailUrl: briefings.thumbnailUrl,
      postedAt: briefings.postedAt,
      updatedAt: briefings.updatedAt,
    })
    .from(briefings)
    .where(hasVideoFilter())
    .orderBy(desc(briefings.tradingDay))
    .limit(limit);
  return rows
    .filter((r) => r.script && r.videoS3Key)
    .map((r) => ({
      tradingDay: r.tradingDay,
      script: r.script!,
      videoUrl: r.videoS3Key!,
      thumbnailUrl: r.thumbnailUrl,
      postedAt: r.postedAt ?? r.updatedAt,
    }));
}

export async function loadBriefingByDay(
  tradingDay: string,
): Promise<PublicBriefingWithCalls | null> {
  const [row] = await db
    .select({
      tradingDay: briefings.tradingDay,
      script: briefings.script,
      videoS3Key: briefings.videoS3Key,
      thumbnailUrl: briefings.thumbnailUrl,
      postedAt: briefings.postedAt,
      updatedAt: briefings.updatedAt,
    })
    .from(briefings)
    .where(and(eq(briefings.tradingDay, tradingDay), hasVideoFilter()))
    .limit(1);
  if (!row || !row.script || !row.videoS3Key) return null;

  // Pull top 3 ticker calls from the matching premarket post. Same data
  // Olivia spoke from; lets the per-day page render a static "today's
  // calls" panel.
  const [post] = await db
    .select({ trades: posts.trades })
    .from(posts)
    .where(and(eq(posts.tradingDay, tradingDay), eq(posts.scanKind, "premarket")))
    .limit(1);
  const calls: PublicBriefingWithCalls["calls"] = [];
  if (post && Array.isArray(post.trades)) {
    const sorted = [...post.trades]
      .filter((t) => t.direction !== "avoid")
      .sort((a, b) => {
        const ar = typeof a.rank === "number" ? a.rank : 999;
        const br = typeof b.rank === "number" ? b.rank : 999;
        return ar - br;
      })
      .slice(0, 3);
    for (const t of sorted) {
      calls.push({
        ticker: t.ticker,
        direction: t.direction ?? null,
        grade: (t.grade as string | undefined) ?? null,
      });
    }
  }

  return {
    tradingDay: row.tradingDay,
    script: row.script,
    videoUrl: row.videoS3Key,
    thumbnailUrl: row.thumbnailUrl,
    postedAt: row.postedAt ?? row.updatedAt,
    calls,
  };
}

export async function listPublicBriefingDays(limit = 60): Promise<string[]> {
  const rows = await db
    .select({ tradingDay: briefings.tradingDay })
    .from(briefings)
    .where(hasVideoFilter())
    .orderBy(desc(briefings.tradingDay))
    .limit(limit);
  return rows.map((r) => r.tradingDay);
}

// ---------------------------------------------------------------------------
// Weekly Earnings Brief — Sunday morning video. Parallel structure to the
// daily helpers above; the same projection-at-query-layer security model
// applies. No `calls` panel — the weekly script narrates earnings setups
// inline rather than referencing a structured calls list.
// ---------------------------------------------------------------------------

export interface PublicWeeklyEarningsBrief {
  /** Sunday-of-the-week date used as the row's natural key. */
  weekAnchor: string;
  script: string;
  /** Public URL to the muxed MP4 (our bucket). */
  videoUrl: string;
  thumbnailUrl: string | null;
  postedAt: Date | null;
}

/** Mirror of hasVideoFilter() for the weekly table. */
function hasWeeklyVideoFilter() {
  return and(
    isNotNull(weeklyEarningsBriefings.videoS3Key),
    or(
      eq(weeklyEarningsBriefings.status, "pending_upload"),
      eq(weeklyEarningsBriefings.status, "uploading"),
      eq(weeklyEarningsBriefings.status, "posted"),
    ),
  );
}

export async function loadLatestWeeklyEarnings(): Promise<PublicWeeklyEarningsBrief | null> {
  const [row] = await db
    .select({
      weekAnchor: weeklyEarningsBriefings.weekAnchor,
      script: weeklyEarningsBriefings.script,
      videoS3Key: weeklyEarningsBriefings.videoS3Key,
      thumbnailUrl: weeklyEarningsBriefings.thumbnailUrl,
      postedAt: weeklyEarningsBriefings.postedAt,
      updatedAt: weeklyEarningsBriefings.updatedAt,
    })
    .from(weeklyEarningsBriefings)
    .where(hasWeeklyVideoFilter())
    .orderBy(desc(weeklyEarningsBriefings.weekAnchor))
    .limit(1);
  if (!row || !row.script || !row.videoS3Key) return null;
  return {
    weekAnchor: row.weekAnchor,
    script: row.script,
    videoUrl: row.videoS3Key,
    thumbnailUrl: row.thumbnailUrl,
    postedAt: row.postedAt ?? row.updatedAt,
  };
}

export async function loadWeeklyEarningsByAnchor(
  weekAnchor: string,
): Promise<PublicWeeklyEarningsBrief | null> {
  const [row] = await db
    .select({
      weekAnchor: weeklyEarningsBriefings.weekAnchor,
      script: weeklyEarningsBriefings.script,
      videoS3Key: weeklyEarningsBriefings.videoS3Key,
      thumbnailUrl: weeklyEarningsBriefings.thumbnailUrl,
      postedAt: weeklyEarningsBriefings.postedAt,
      updatedAt: weeklyEarningsBriefings.updatedAt,
    })
    .from(weeklyEarningsBriefings)
    .where(
      and(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor), hasWeeklyVideoFilter()),
    )
    .limit(1);
  if (!row || !row.script || !row.videoS3Key) return null;
  return {
    weekAnchor: row.weekAnchor,
    script: row.script,
    videoUrl: row.videoS3Key,
    thumbnailUrl: row.thumbnailUrl,
    postedAt: row.postedAt ?? row.updatedAt,
  };
}

export async function listPublicWeeklyEarningsAnchors(limit = 26): Promise<string[]> {
  const rows = await db
    .select({ weekAnchor: weeklyEarningsBriefings.weekAnchor })
    .from(weeklyEarningsBriefings)
    .where(hasWeeklyVideoFilter())
    .orderBy(desc(weeklyEarningsBriefings.weekAnchor))
    .limit(limit);
  return rows.map((r) => r.weekAnchor);
}

