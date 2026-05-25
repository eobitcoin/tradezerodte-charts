import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  loadMetalsPreview,
  listMetalsScanDays,
} from "@/lib/explore-preview";
import MetalsPreviewView from "@/components/MetalsPreviewView";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

interface PageProps {
  params: Promise<{ scanDay: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { scanDay } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scanDay)) return {};
  const preview = await loadMetalsPreview(scanDay);
  if (!preview) return {};
  const scanLabel = new Date(`${scanDay}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const teaser = preview.headline
    ? (preview.headline.headline || preview.headline.title).slice(0, 180)
    : "Weekly metals research preview.";
  return {
    title: `Metals Research — ${scanLabel} | Olivia Trades`,
    description: teaser,
    alternates: { canonical: `${APP_URL}/explore/metals/${scanDay}` },
  };
}

export const dynamic = "force-dynamic";

export default async function ExploreMetalsArchive({ params }: PageProps) {
  const { scanDay } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scanDay)) notFound();
  const preview = await loadMetalsPreview(scanDay);
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
