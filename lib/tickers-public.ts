/**
 * Per-ticker reverse-index helpers for the public /tickers/[symbol] hub
 * pages. Answers:
 *   1. "Which tickers have we ever covered?"        → listAllCoveredTickers
 *   2. "What briefs mentioned $MRVL?"               → loadBriefCoverageForTicker
 *
 * Research coverage lives in `lib/research-by-ticker.ts` so this file
 * stays focused on the always-free briefs surface. The ticker hub page
 * composes both.
 *
 * Briefs come from two sources, both fully public:
 *   - briefings (daily 0DTE clips, via posts.tickers join on tradingDay)
 *   - weeklyEarningsBriefings (Sunday weekly, via .tickers column directly)
 *
 * For the DAILY join: posts.tickers is the structured top-3 calls. A
 * briefing is "about a ticker" iff its corresponding post had that ticker
 * in the calls — which is the actual narration content (we don't try to
 * re-parse the 20s voiceover).
 */

import { and, desc, eq, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  briefings,
  posts,
  weeklyEarningsBriefings,
} from "@/lib/db/schema";

/** Normalized "brief covered $TICKER on $date" row used by the hub. */
export interface TickerBriefCoverage {
  kind: "daily" | "weekly";
  /** YYYY-MM-DD — sort key (tradingDay or weekAnchor). */
  date: string;
  /** Human title for the row (kind-aware). */
  title: string;
  /** Canonical /morning-brief URL the user lands on. Public. */
  url: string;
  /** First sentence of the script — useful for snippets. */
  excerpt: string;
}

/** Same shape but with only public-safe filtering applied. */
function hasDailyBriefVideoSql() {
  return and(
    isNotNull(briefings.videoS3Key),
    or(
      eq(briefings.status, "pending_upload"),
      eq(briefings.status, "uploading"),
      eq(briefings.status, "posted"),
    ),
  );
}
function hasWeeklyBriefVideoSql() {
  return and(
    isNotNull(weeklyEarningsBriefings.videoS3Key),
    or(
      eq(weeklyEarningsBriefings.status, "pending_upload"),
      eq(weeklyEarningsBriefings.status, "uploading"),
      eq(weeklyEarningsBriefings.status, "posted"),
    ),
  );
}

/** Heuristic excerpt = first sentence of the script. Keeps the listing
 *  scannable without dumping the full 20-200 word body. */
function firstSentence(script: string | null): string {
  if (!script) return "";
  const trimmed = script.trim();
  const m = trimmed.match(/^[^.!?]+[.!?]/);
  return (m ? m[0] : trimmed).trim();
}

/**
 * List every ticker that has appeared in at least one published brief
 * (daily or weekly). Used by /tickers (the alphabetical index) and the
 * sitemap. Output is uppercase + sorted alphabetically.
 *
 * `posts.tickers` is a generated `text[]` of the calls; we unnest it.
 * `weekly_earnings_briefings.tickers` is a regular `text[]`; same.
 */
export async function listAllCoveredTickers(): Promise<string[]> {
  // Pull the union of distinct symbols across both tables. Done in SQL so
  // we don't materialize every row in Node just to dedupe.
  const rows = await db.execute<{ ticker: string }>(sql`
    SELECT DISTINCT ticker FROM (
      SELECT UNNEST(p.tickers) AS ticker
      FROM ${posts} p
      JOIN ${briefings} b ON b.trading_day = p.trading_day
      WHERE b.video_s3_key IS NOT NULL
        AND b.status IN ('pending_upload','uploading','posted')
      UNION
      SELECT UNNEST(w.tickers) AS ticker
      FROM ${weeklyEarningsBriefings} w
      WHERE w.video_s3_key IS NOT NULL
        AND w.status IN ('pending_upload','uploading','posted')
    ) t
    WHERE ticker IS NOT NULL AND length(ticker) BETWEEN 1 AND 6
    ORDER BY ticker ASC
  `);
  return rows.map((r) => r.ticker.toUpperCase());
}

/** Format the human title for a brief row in the ticker hub. */
function dailyTitle(tradingDay: string): string {
  const d = new Date(`${tradingDay}T12:00:00Z`);
  const label = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `Daily 0DTE — ${label}`;
}
function weeklyTitle(weekAnchor: string): string {
  // weekAnchor is Sunday; the trading week starts Monday.
  const sun = new Date(`${weekAnchor}T12:00:00Z`);
  const mon = new Date(sun);
  mon.setUTCDate(sun.getUTCDate() + 1);
  const label = mon.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `Weekly Earnings Brief — Week of ${label}`;
}

/**
 * All briefs that mentioned the given ticker, ordered newest first.
 *
 * `tickerUpper` is uppercase already at the route layer. Daily lookup
 * goes via `posts.tickers && ARRAY[$1]` (overlap test — fast against GIN
 * index), then joins to the corresponding briefing row. Weekly lookup
 * uses the same overlap test directly on the briefings table.
 */
export async function loadBriefCoverageForTicker(
  tickerUpper: string,
  limit = 60,
): Promise<TickerBriefCoverage[]> {
  const ticker = tickerUpper.toUpperCase();

  // Daily: posts.tickers ∋ ticker → join briefings → only return public-safe.
  const dailyRows = await db
    .select({
      tradingDay: briefings.tradingDay,
      script: briefings.script,
    })
    .from(briefings)
    .innerJoin(posts, eq(posts.tradingDay, briefings.tradingDay))
    .where(
      and(
        sql`${posts.tickers} && ARRAY[${ticker}]::text[]` as SQL<unknown>,
        hasDailyBriefVideoSql(),
      ),
    )
    .orderBy(desc(briefings.tradingDay))
    .limit(limit);

  const dailyCoverage: TickerBriefCoverage[] = dailyRows.map((r) => ({
    kind: "daily" as const,
    date: r.tradingDay,
    title: dailyTitle(r.tradingDay),
    url: `/morning-brief/${r.tradingDay}`,
    excerpt: firstSentence(r.script),
  }));

  // Weekly: weekly_earnings_briefings.tickers ∋ ticker.
  const weeklyRows = await db
    .select({
      weekAnchor: weeklyEarningsBriefings.weekAnchor,
      script: weeklyEarningsBriefings.script,
    })
    .from(weeklyEarningsBriefings)
    .where(
      and(
        sql`${weeklyEarningsBriefings.tickers} && ARRAY[${ticker}]::text[]` as SQL<unknown>,
        hasWeeklyBriefVideoSql(),
      ),
    )
    .orderBy(desc(weeklyEarningsBriefings.weekAnchor))
    .limit(limit);

  const weeklyCoverage: TickerBriefCoverage[] = weeklyRows.map((r) => ({
    kind: "weekly" as const,
    date: r.weekAnchor,
    title: weeklyTitle(r.weekAnchor),
    url: `/morning-brief/earnings/${r.weekAnchor}`,
    excerpt: firstSentence(r.script),
  }));

  // Merge + sort by date desc. Both arrays are date-sorted already; a
  // straight concat-then-sort is O(n log n) but n is tiny (≤120).
  return [...dailyCoverage, ...weeklyCoverage]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}
