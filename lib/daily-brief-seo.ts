/**
 * SEO helpers for the public daily 0DTE Brief pages.
 *
 * Parallel to `lib/earnings-brief-seo.ts` — fronts the tickers in title,
 * description, OG, and JSON-LD VideoObject.about[] so search engines and
 * social previews see them in the strongest signals (not just the page
 * body where they're weakly indexable).
 *
 * Used by:
 *   - app/morning-brief/[date]/page.tsx  (the dated canonical)
 *   - app/morning-brief/page.tsx         (landing — redirects to dated)
 */

import type { PublicBriefingWithCalls } from "@/lib/briefings-public";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

/** "May 25, 2026" — short, search-friendly. */
function fmtDateShort(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Mon, May 25, 2026" — for the header microcopy. */
export function fmtDateForSeo(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Build the page `<title>`. Fronts the tickers so a search for
 * "SPY puts today" can match. Falls back to dateless when no calls
 * (rare — premarket scan should always produce 3).
 *
 * Examples:
 *   "Daily 0DTE — SPY, TSLA, NVDA — May 25, 2026 — Olivia Trades"
 *   "Daily 0DTE Brief — May 25, 2026 — Olivia Trades"
 */
export function buildSeoTitle(brief: PublicBriefingWithCalls): string {
  const visible = brief.calls.slice(0, 3).map((c) => c.ticker);
  const tickerList = visible.join(", ");
  const date = fmtDateShort(brief.tradingDay);
  return tickerList
    ? `Daily 0DTE — ${tickerList} — ${date} — Olivia Trades`
    : `Daily 0DTE Brief — ${date} — Olivia Trades`;
}

/**
 * Build the `<meta description>`. Leads with the first sentence of the
 * script so the snippet is informative, then names the call tickers with
 * direction (SPY puts / TSLA calls) for finance-specific query matches.
 * Capped at ~160 chars for Google display.
 */
export function buildSeoDescription(brief: PublicBriefingWithCalls): string {
  const firstSentence =
    brief.script.trim().split(/[.!?]\s/)[0]?.trim() || "Today's 0DTE setups.";
  const callsClause = brief.calls.length
    ? ` Today's calls: ${brief.calls
        .slice(0, 3)
        .map((c) => `${c.ticker}${c.direction ? ` ${c.direction}` : ""}`)
        .join(", ")}.`
    : "";
  const raw = `${firstSentence}.${callsClause} Daily premarket brief from Olivia Trades.`;
  if (raw.length <= 160) return raw;
  return raw.slice(0, 157).trimEnd() + "…";
}

/** Canonical URL for a dated daily brief. */
export function buildCanonicalUrl(tradingDay: string): string {
  return `${APP_URL}/morning-brief/${tradingDay}`;
}

/**
 * Build the JSON-LD `VideoObject` blob. The critical bit is the `about[]`
 * array — one `Corporation` entry per call ticker so Google's finance +
 * rich-result crawlers can link this video to each equity in the
 * knowledge graph.
 *
 * Duration "PT20S" matches the daily clip target (vs PT55S for weekly).
 */
export function buildVideoObjectJsonLd(brief: PublicBriefingWithCalls) {
  const uploadDate = (
    brief.postedAt ?? new Date(`${brief.tradingDay}T13:00:00Z`)
  ).toISOString();
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: buildSeoTitle(brief),
    description: brief.script,
    thumbnailUrl: brief.thumbnailUrl
      ? [brief.thumbnailUrl]
      : [`${APP_URL}/assets/briefing-outro.png`],
    uploadDate,
    contentUrl: brief.videoUrl,
    embedUrl: buildCanonicalUrl(brief.tradingDay),
    duration: "PT20S",
    publisher: {
      "@type": "Organization",
      name: "Olivia Trades",
      url: APP_URL,
    },
    about: brief.calls.map((c) => ({
      "@type": "Corporation",
      name: c.ticker,
      tickerSymbol: c.ticker,
    })),
    keywords: [
      "0DTE",
      "options trading",
      "premarket",
      "daily setups",
      ...brief.calls.map((c) => c.ticker),
    ].join(", "),
  };
}
