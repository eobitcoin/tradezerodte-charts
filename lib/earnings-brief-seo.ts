/**
 * SEO helpers for the public Weekly Earnings Brief pages.
 *
 * Two surfaces consume this:
 *   - app/morning-brief/earnings/page.tsx           (latest week)
 *   - app/morning-brief/earnings/[anchor]/page.tsx  (specific week)
 *
 * Goals:
 *   1. Surface the covered tickers in `<title>`, `<meta description>`, and
 *      OpenGraph so Google + social previews know which equities the video
 *      is about — without these signals the tickers in the page body are
 *      weakly indexable at best.
 *   2. Emit schema.org `VideoObject` JSON-LD with each ticker as a
 *      `Corporation` in `about[]`. That's the explicit "this video is
 *      about [equity X]" signal Google's finance + rich-result crawlers
 *      look for. Without it the video isn't connected to the ticker
 *      knowledge graph.
 */

import type { PublicWeeklyEarningsBrief } from "@/lib/briefings-public";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

/** Human-readable week range. Same logic as EarningsBriefDayView.fmtWeekRange
 *  but kept here so the SEO helpers don't depend on a client/RSC component. */
export function fmtWeekRangeForSeo(sundayAnchor: string): string {
  const start = new Date(`${sundayAnchor}T12:00:00Z`);
  const mon = new Date(start);
  mon.setUTCDate(start.getUTCDate() + 1);
  const fri = new Date(start);
  fri.setUTCDate(start.getUTCDate() + 5);
  const sameMonth = mon.getUTCMonth() === fri.getUTCMonth();
  const monLabel = mon.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const friLabel = sameMonth
    ? String(fri.getUTCDate())
    : fri.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
  return `${monLabel}–${friLabel}, ${fri.getUTCFullYear()}`;
}

/**
 * Build the `<title>` for a brief — fronts the tickers so search engines
 * see them in the strongest signal. Stays under Google's ~60-char display
 * cap by listing up to 5 tickers explicitly, then "…" for the rest.
 *
 * Examples:
 *   "This Week's Earnings: MRVL, DELL, AVGO, CRM, LULU — Olivia Trades"
 *   "Earnings May 25–29: MRVL, DELL, AVGO, CRM… — Olivia Trades"
 */
export function buildSeoTitle(brief: PublicWeeklyEarningsBrief): string {
  const visible = brief.tickers.slice(0, 5);
  const overflow = brief.tickers.length - visible.length;
  const tickerList = visible.join(", ") + (overflow > 0 ? "…" : "");
  const range = fmtWeekRangeForSeo(brief.weekAnchor);
  return tickerList
    ? `Earnings ${range}: ${tickerList} — Olivia Trades`
    : `Weekly Earnings Brief — ${range} — Olivia Trades`;
}

/**
 * Build the `<meta description>`. Starts with the script's first sentence
 * so the snippet Google shows is genuinely informative, then names the
 * tickers explicitly so a query like "MRVL earnings preview" can match.
 * Capped to ~160 chars to fit Google's display.
 */
export function buildSeoDescription(brief: PublicWeeklyEarningsBrief): string {
  const firstSentence =
    brief.script.trim().split(/[.!?]\s/)[0]?.trim() || "This week's earnings to watch.";
  const tickers = brief.tickers.length
    ? ` Covers ${brief.tickers.join(", ")}.`
    : "";
  const raw = `${firstSentence}.${tickers} Sunday weekly brief from Olivia Trades.`;
  if (raw.length <= 160) return raw;
  return raw.slice(0, 157).trimEnd() + "…";
}

/**
 * Canonical URL for a brief. Always points to the per-week path so that
 * the latest-week page (no anchor) and the /[anchor] page agree on which
 * canonical to serve.
 */
export function buildCanonicalUrl(weekAnchor: string): string {
  return `${APP_URL}/morning-brief/earnings/${weekAnchor}`;
}

/**
 * Build the JSON-LD `VideoObject` blob for the page. The crucial bits:
 *
 *   - `contentUrl` → the actual MP4 served from our bucket
 *   - `uploadDate` → when the row was first marked posted (or week anchor)
 *   - `about[]`    → one `Corporation` entry per ticker. This is the
 *                    explicit signal that connects the video to each
 *                    equity in Google's knowledge graph. Using
 *                    `tickerSymbol` (a Corporation property) rather than
 *                    a generic `identifier` so finance crawlers parse it
 *                    correctly.
 *
 * The duration "PT55S" is an estimate — the Hedra clip + outro card is
 * narration-end + 2.5s, typically 35-55s. Picking a fixed plausible
 * upper bound here keeps the schema valid without measuring per file.
 */
export function buildVideoObjectJsonLd(brief: PublicWeeklyEarningsBrief) {
  const uploadDate = (brief.postedAt ?? new Date(`${brief.weekAnchor}T13:00:00Z`)).toISOString();
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
    embedUrl: buildCanonicalUrl(brief.weekAnchor),
    duration: "PT55S",
    publisher: {
      "@type": "Organization",
      name: "Olivia Trades",
      url: APP_URL,
    },
    about: brief.tickers.map((ticker) => ({
      "@type": "Corporation",
      name: ticker,
      tickerSymbol: ticker,
    })),
    // Mention the same tickers in keywords too — separate vocab that some
    // crawlers index independently of `about[]`.
    keywords: [
      "earnings preview",
      "weekly earnings",
      "options trading",
      "implied volatility",
      ...brief.tickers,
    ].join(", "),
  };
}
