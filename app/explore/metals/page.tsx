import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  loadMetalsPreview,
  listMetalsScanDays,
} from "@/lib/explore-preview";
import MetalsPreviewView from "@/components/MetalsPreviewView";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

/**
 * /explore/metals — public landing page for metals research previews.
 * Renders the latest scan-day's preview (headline metals ticker fully
 * revealed + count of the rest as blurred placeholders).
 *
 * The dated archive lives at /explore/metals/[scanDay].
 */

export async function generateMetadata(): Promise<Metadata> {
  const preview = await loadMetalsPreview();
  if (!preview) return { title: "Metals Research — Olivia Trades" };
  const scanLabel = new Date(`${preview.scanDay}T12:00:00Z`).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
  );
  const teaser = preview.headline
    ? (preview.headline.headline || "Weekly metals research preview.").slice(0, 180)
    : "Weekly metals research — GLD, SLV, GDX, and more.";
  return {
    title: `Metals Research — ${scanLabel} | Olivia Trades`,
    description: teaser,
    alternates: { canonical: `${APP_URL}/explore/metals` },
  };
}

export const dynamic = "force-dynamic";

export default async function ExploreMetalsLanding() {
  const preview = await loadMetalsPreview();
  if (!preview) notFound();
  const archive = (await listMetalsScanDays(26))
    .filter((d) => d !== preview.scanDay)
    .map((d) => ({
      scanDay: d,
      href: `/explore/metals/${d}`,
      label: "View preview",
    }));
  return <MetalsPreviewView preview={preview} archive={archive} />;
}
