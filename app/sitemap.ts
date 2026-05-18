import type { MetadataRoute } from "next";
import {
  listInstitutionalScanDays,
  listEarningsScanDays,
  listSectorRotationScanDays,
  listInsiderScanDays,
  listDailyAnalysisTradingDays,
} from "@/lib/explore-preview";
import { listPublicBriefingDays } from "@/lib/briefings-public";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";

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
];

const EXPLORE_TYPES: Array<{
  slug: "daily" | "institutional" | "earnings" | "sector-rotation" | "insider";
  lister: (limit?: number) => Promise<string[]>;
}> = [
  { slug: "daily", lister: listDailyAnalysisTradingDays },
  { slug: "institutional", lister: listInstitutionalScanDays },
  { slug: "earnings", lister: listEarningsScanDays },
  { slug: "sector-rotation", lister: listSectorRotationScanDays },
  { slug: "insider", lister: listInsiderScanDays },
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
    } catch {
      // If the DB query fails (table missing during initial deploy, etc.),
      // skip the archives for this type rather than failing the whole
      // sitemap generation.
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
  } catch {
    // Briefings table may not exist on a fresh deploy; skip rather than fail.
  }

  return out;
}
