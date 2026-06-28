import type { MetadataRoute } from "next";
import {
  listInstitutionalScanDays,
  listEarningsScanDays,
  listSectorRotationScanDays,
  listInsiderScanDays,
  listDailyAnalysisTradingDays,
  listMetalsScanDays,
  listQuantumScanDays,
} from "@/lib/explore-preview";
import {
  listPublicBriefingDays,
  listPublicWeeklyEarningsAnchors,
} from "@/lib/briefings-public";
import { listAllCoveredTickers } from "@/lib/tickers-public";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

// Force dynamic generation per request — without this, Next.js prerenders
// the sitemap at build time, when the DB queries haven't run yet, locking
// the URL list to whatever the static phase saw (essentially: only the
// hardcoded entries). We want the sitemap to reflect every brief and
// ticker hub published since the build.
export const dynamic = "force-dynamic";

const LEARN_SLUGS = [
  "0dte-options",
  "max-pain",
  "gamma-exposure",
  "polymarket-whales",
  // App-features (how-to-read explainers for authenticated tabs)
  "trade-cards",
  "analysis",
  "scorecard",
  // Research-section explainers (mirror of the in-app help pages, public)
  "weekly-research",
  "institutional-flow",
  "earnings-whiplash",
  "sector-rotation",
  "insider-buys",
  "premium-ranker",
  "squeeze-scan",
];

const EXPLORE_TYPES: Array<{
  slug: "daily" | "institutional" | "earnings" | "sector-rotation" | "insider" | "metals" | "quantum";
  lister: (limit?: number) => Promise<string[]>;
}> = [
  { slug: "daily", lister: listDailyAnalysisTradingDays },
  { slug: "institutional", lister: listInstitutionalScanDays },
  { slug: "earnings", lister: listEarningsScanDays },
  { slug: "sector-rotation", lister: listSectorRotationScanDays },
  { slug: "insider", lister: listInsiderScanDays },
  { slug: "metals", lister: listMetalsScanDays },
  { slug: "quantum", lister: listQuantumScanDays },
];

/**
 * sitemap.xml for public crawlable routes. Auth-gated pages are explicitly
 * excluded — they're listed in robots.ts disallow rules and would 307 to
 * login anyway, but a clean sitemap removes any ambiguity for crawlers.
 *
 * /explore/* pages are public-by-design teaser views. We surface every
 * scan day as its own indexable URL so Google accumulates fresh inventory
 * weekly (Institutional, Earnings, Sector Rotation) + daily (Insider).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const out: MetadataRoute.Sitemap = [
    {
      url: `${APP_URL}/welcome`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${APP_URL}/explore`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${APP_URL}/learn`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.85,
    },
    {
      url: `${APP_URL}/help`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${APP_URL}/morning-brief`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${APP_URL}/morning-brief/earnings`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.85,
    },
    {
      url: `${APP_URL}/tickers`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    },
    ...LEARN_SLUGS.map((slug) => ({
      url: `${APP_URL}/learn/${slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];

  // Add the /explore/{type} latest pages plus every historical scan day.
  // Limit to 60 per type to keep the sitemap reasonable; older scans still
  // resolve at their URL, they just stop appearing in the sitemap.
  for (const { slug, lister } of EXPLORE_TYPES) {
    out.push({
      url: `${APP_URL}/explore/${slug}`,
      lastModified: now,
      changeFrequency: slug === "insider" || slug === "daily" ? "daily" : "weekly",
      priority: 0.7,
    });
    try {
      const days = await lister(60);
      for (const d of days) {
        out.push({
          url: `${APP_URL}/explore/${slug}/${d}`,
          lastModified: new Date(`${d}T12:00:00Z`),
          changeFrequency: "monthly",
          priority: 0.5,
        });
      }
    } catch (err) {
      // If the DB query fails (table missing during initial deploy, etc.),
      // skip the archives for this type rather than failing the whole
      // sitemap generation. Log so we can see real bugs instead of
      // missing-table noise.
      console.error(`[sitemap] explore/${slug} lister failed:`, err);
    }
  }

  // Morning Brief — one indexable URL per trading day with a published video.
  try {
    const briefingDays = await listPublicBriefingDays(60);
    for (const d of briefingDays) {
      out.push({
        url: `${APP_URL}/morning-brief/${d}`,
        lastModified: new Date(`${d}T12:00:00Z`),
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }
  } catch (err) {
    console.error("[sitemap] listPublicBriefingDays failed:", err);
  }

  // Weekly Earnings Briefs — one indexable URL per Sunday anchor with a
  // published video. Same idempotency contract as the daily block above.
  try {
    const weeklyAnchors = await listPublicWeeklyEarningsAnchors(26);
    for (const w of weeklyAnchors) {
      out.push({
        url: `${APP_URL}/morning-brief/earnings/${w}`,
        lastModified: new Date(`${w}T12:00:00Z`),
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }
  } catch (err) {
    console.error("[sitemap] listPublicWeeklyEarningsAnchors failed:", err);
  }

  // Per-ticker hub pages — one per ticker with at least one published
  // brief. The /tickers/[symbol] route 404s when there's no coverage, so
  // mirroring listAllCoveredTickers's filter guarantees no broken links
  // in the sitemap.
  try {
    const tickers = await listAllCoveredTickers();
    for (const t of tickers) {
      out.push({
        url: `${APP_URL}/tickers/${t}`,
        lastModified: now,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  } catch (err) {
    console.error("[sitemap] listAllCoveredTickers failed:", err);
  }

  return out;
}
