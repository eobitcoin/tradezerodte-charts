/**
 * Per-ticker reverse-index for member-only research content.
 *
 * Surfaces on /tickers/[symbol] as locked teaser cards under the "Research"
 * heading. Each card links to the existing /explore/[type]/[date] public
 * preview (which already shows headline + paywall + signup CTA via
 * ExploreScaffold). Where no preview exists, the card links to the member
 * URL directly — middleware redirects to /login?next=… for unauth visitors.
 *
 * Six research surfaces:
 *   1. Daily 0DTE Analysis (posts)              → /explore/daily/[tradingDay]
 *   2. Insider Buys (insiderPosts)              → /explore/insider/[scanDay]
 *   3. Wicked Stocks Equity Research (researchPosts) → /research/[scanDay]/[ticker]  (member, per-ticker)
 *   4. Institutional Flow (institutionalPosts)  → /explore/institutional/[scanDay]
 *   5. Earnings Whiplash (earningsPosts)        → /explore/earnings/[scanDay]
 *   6. Max Pain + GEX (maxPainPosts)            → /maxpain/[scanDay]   (member, no preview)
 *
 * Recency filter: last 60 days. Older content stays indexable on its own
 * pages but doesn't clutter the hub.
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export type ResearchKind =
  | "daily"
  | "insider"
  | "wicked_stocks"
  | "institutional"
  | "earnings"
  | "max_pain";

/** Display label per kind — short, fits in a chip. */
export const RESEARCH_KIND_LABEL: Record<ResearchKind, string> = {
  daily: "Daily 0DTE Analysis",
  insider: "Insider Buys",
  wicked_stocks: "Wicked Stocks",
  institutional: "Institutional Flow",
  earnings: "Earnings Whiplash",
  max_pain: "Max Pain + GEX",
};

export interface TickerResearchItem {
  kind: ResearchKind;
  /** YYYY-MM-DD — sort key. */
  date: string;
  title: string;
  /** Where the locked card sends the user. Public preview when one
   *  exists; otherwise the member URL (middleware handles the auth gate). */
  url: string;
  /** Always false for items in this list — research is members-only. */
  isFree: false;
}

/** Build a date label for the card title — "May 25, 2026". */
function fmtDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Sixty-day SQL window — research older than this is excluded from the hub. */
const SIXTY_DAYS = sql`CURRENT_DATE - INTERVAL '60 days'`;

/**
 * Run one query per research surface in parallel, normalize, merge,
 * sort desc by date, slice to the cap. Reads are independent + scoped
 * to last 60 days so each query stays small.
 *
 * Each subquery is a raw `sql` template because the JSONB containment
 * patterns (`stocks @> '[{"ticker":"MRVL"}]'`) don't have first-class
 * drizzle helpers — and the query shape per table differs enough that a
 * unified abstraction would be more code, not less.
 */
export async function loadResearchForTicker(
  tickerUpper: string,
  limit = 5,
): Promise<TickerResearchItem[]> {
  const t = tickerUpper.toUpperCase();
  // Containment payload for jsonb arrays-of-{ticker: …}. Bound as
  // parameter rather than inlined to avoid SQL injection even though the
  // ticker is regex-validated upstream.
  const arrayObjContains = sql`jsonb_build_array(jsonb_build_object('ticker', ${t}::text))`;

  const [daily, insider, wicked, institutional, earnings, maxPain] = await Promise.all([
    db.execute<{ trading_day: string }>(sql`
      SELECT trading_day::text AS trading_day
      FROM posts
      WHERE tickers && ARRAY[${t}]::text[]
        AND trading_day >= ${SIXTY_DAYS}
        AND scan_kind = 'premarket'
      ORDER BY trading_day DESC
      LIMIT ${limit}
    `),
    db.execute<{ scan_day: string }>(sql`
      SELECT scan_day::text AS scan_day
      FROM insider_posts
      WHERE buys @> ${arrayObjContains}::jsonb
        AND scan_day >= ${SIXTY_DAYS}
      ORDER BY scan_day DESC
      LIMIT ${limit}
    `),
    db.execute<{ scan_day: string; ticker: string }>(sql`
      SELECT scan_day::text AS scan_day, ticker
      FROM research_posts
      WHERE ticker = ${t}
        AND scan_day >= ${SIXTY_DAYS}
      ORDER BY scan_day DESC
      LIMIT ${limit}
    `),
    db.execute<{ scan_day: string }>(sql`
      SELECT scan_day::text AS scan_day
      FROM institutional_posts
      WHERE stocks @> ${arrayObjContains}::jsonb
        AND scan_day >= ${SIXTY_DAYS}
      ORDER BY scan_day DESC
      LIMIT ${limit}
    `),
    db.execute<{ scan_day: string }>(sql`
      SELECT scan_day::text AS scan_day
      FROM earnings_posts
      WHERE stocks @> ${arrayObjContains}::jsonb
        AND scan_day >= ${SIXTY_DAYS}
      ORDER BY scan_day DESC
      LIMIT ${limit}
    `),
    db.execute<{ scan_day: string }>(sql`
      SELECT scan_day::text AS scan_day
      FROM max_pain_posts
      WHERE tickers @> ${arrayObjContains}::jsonb
        AND scan_day >= ${SIXTY_DAYS}
      ORDER BY scan_day DESC
      LIMIT ${limit}
    `),
  ]);

  const items: TickerResearchItem[] = [];

  for (const r of daily) {
    items.push({
      kind: "daily",
      date: r.trading_day,
      title: `${RESEARCH_KIND_LABEL.daily} — ${fmtDate(r.trading_day)}`,
      url: `/explore/daily/${r.trading_day}`,
      isFree: false,
    });
  }
  for (const r of insider) {
    items.push({
      kind: "insider",
      date: r.scan_day,
      title: `${RESEARCH_KIND_LABEL.insider} — ${fmtDate(r.scan_day)}`,
      url: `/explore/insider/${r.scan_day}`,
      isFree: false,
    });
  }
  for (const r of wicked) {
    items.push({
      kind: "wicked_stocks",
      date: r.scan_day,
      title: `${RESEARCH_KIND_LABEL.wicked_stocks}: ${r.ticker} — ${fmtDate(r.scan_day)}`,
      // Wicked Stocks doesn't have a public preview — link directly to
      // the member URL; middleware redirects unauth visitors to /login.
      url: `/research/${r.scan_day}/${r.ticker}`,
      isFree: false,
    });
  }
  for (const r of institutional) {
    items.push({
      kind: "institutional",
      date: r.scan_day,
      title: `${RESEARCH_KIND_LABEL.institutional} — ${fmtDate(r.scan_day)}`,
      url: `/explore/institutional/${r.scan_day}`,
      isFree: false,
    });
  }
  for (const r of earnings) {
    items.push({
      kind: "earnings",
      date: r.scan_day,
      title: `${RESEARCH_KIND_LABEL.earnings} — ${fmtDate(r.scan_day)}`,
      url: `/explore/earnings/${r.scan_day}`,
      isFree: false,
    });
  }
  for (const r of maxPain) {
    items.push({
      kind: "max_pain",
      date: r.scan_day,
      title: `${RESEARCH_KIND_LABEL.max_pain} — ${fmtDate(r.scan_day)}`,
      // No /explore/maxpain/[date] route — middleware handles the gate.
      url: `/maxpain/${r.scan_day}`,
      isFree: false,
    });
  }

  // Date desc, then kind alphabetical for stable ordering on same-day ties.
  return items
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind),
    )
    .slice(0, limit);
}
