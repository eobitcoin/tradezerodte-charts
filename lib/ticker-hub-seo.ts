/**
 * SEO helpers for /tickers/[symbol] hub pages.
 *
 * The hub is the strongest internal-link surface in the SEO graph: every
 * brief that mentions $MRVL links here, and this page links back out to
 * every brief + research piece. To make Google rank this as the canonical
 * "$MRVL coverage" page, we:
 *
 *   1. Front the ticker in <title> ("$MRVL — Recent Coverage — Olivia Trades")
 *   2. JSON-LD: a CollectionPage about a Corporation (the equity), with an
 *      ItemList of mixed VideoObject (briefs, free) and CreativeWork
 *      (research, isAccessibleForFree=false).
 *   3. The `isAccessibleForFree=false` flag is the Google-blessed signal
 *      for paywalled content — required to surface in SERPs without
 *      cloaking penalty.
 */

import type { TickerBriefCoverage } from "@/lib/tickers-public";
import type { TickerResearchItem } from "@/lib/research-by-ticker";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export function buildTickerCanonicalUrl(symbol: string): string {
  return `${APP_URL}/tickers/${symbol.toUpperCase()}`;
}

export function buildTickerSeoTitle(symbol: string, briefCount: number): string {
  const t = symbol.toUpperCase();
  // Include count when we have content — boosts CTR ("12 daily briefs +
  // earnings coverage" reads more substantial than "Recent Coverage").
  if (briefCount > 0) {
    return `$${t} — ${briefCount} 0DTE & earnings briefs — Olivia Trades`;
  }
  return `$${t} — Coverage — Olivia Trades`;
}

export function buildTickerSeoDescription(
  symbol: string,
  briefs: TickerBriefCoverage[],
  research: TickerResearchItem[],
): string {
  const t = symbol.toUpperCase();
  const latestBrief = briefs[0];
  const totalCoverage = briefs.length + research.length;
  const intro = latestBrief
    ? `${latestBrief.excerpt}`
    : `Every brief and research piece from Olivia Trades that covered $${t}.`;
  const counts = `${briefs.length} brief${briefs.length === 1 ? "" : "s"} + ${research.length} research piece${research.length === 1 ? "" : "s"}.`;
  const raw = totalCoverage > 0 ? `${intro} ${counts}` : intro;
  if (raw.length <= 160) return raw;
  return raw.slice(0, 157).trimEnd() + "…";
}

/**
 * Build the JSON-LD blob for a ticker hub. Two-level structure:
 *   - Outer `CollectionPage` with `about` → Corporation(symbol)
 *   - Inner `mainEntity` → ItemList of VideoObjects (briefs) +
 *     CreativeWorks (research, paywalled)
 *
 * The `Corporation` + `tickerSymbol` is what connects this page to the
 * equity in Google's knowledge graph; the ItemList tells Google "these
 * are the things this page is a collection of" so it understands depth.
 */
export function buildTickerJsonLd(
  symbol: string,
  briefs: TickerBriefCoverage[],
  research: TickerResearchItem[],
) {
  const t = symbol.toUpperCase();
  const canonical = buildTickerCanonicalUrl(t);

  const briefItems = briefs.map((b, i) => ({
    "@type": "ListItem",
    position: i + 1,
    item: {
      "@type": "VideoObject",
      name: b.title,
      url: `${APP_URL}${b.url}`,
      uploadDate: `${b.date}T13:00:00Z`,
      description: b.excerpt,
      // Briefs are free — no paywall flag.
      isAccessibleForFree: true,
      about: [
        {
          "@type": "Corporation",
          name: t,
          tickerSymbol: t,
        },
      ],
    },
  }));

  const researchItems = research.map((r, i) => ({
    "@type": "ListItem",
    position: briefs.length + i + 1,
    item: {
      "@type": "CreativeWork",
      name: r.title,
      url: `${APP_URL}${r.url}`,
      dateCreated: r.date,
      // Required signal that this is paywalled — Google honors this
      // and doesn't penalize us for showing a teaser to crawlers vs
      // a paywall to users.
      isAccessibleForFree: false,
      hasPart: {
        "@type": "WebPageElement",
        isAccessibleForFree: false,
        cssSelector: ".paywall",
      },
      about: [
        {
          "@type": "Corporation",
          name: t,
          tickerSymbol: t,
        },
      ],
    },
  }));

  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": canonical,
    url: canonical,
    name: buildTickerSeoTitle(t, briefs.length),
    description: buildTickerSeoDescription(t, briefs, research),
    about: {
      "@type": "Corporation",
      name: t,
      tickerSymbol: t,
    },
    publisher: {
      "@type": "Organization",
      name: "Olivia Trades",
      url: APP_URL,
    },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: briefs.length + research.length,
      itemListElement: [...briefItems, ...researchItems],
    },
  };
}
