import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadEarningsPreview, listEarningsScanDays } from "@/lib/explore-preview";
import EarningsPreviewView from "@/components/EarningsPreviewView";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";

interface PageProps {
  params: Promise<{ scanDay: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { scanDay } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scanDay)) return {};
  const preview = await loadEarningsPreview(scanDay);
  if (!preview) return {};
  const desc = preview.summary
    ? preview.summary.slice(0, 180).trim() + (preview.summary.length > 180 ? "…" : "")
    : "Weekly earnings whiplash scan — implied vs realized volatility.";
  return {
    title: `Earnings Whiplash — ${scanDay} | tradezerodte.com`,
    description: desc,
    alternates: { canonical: `${APP_URL}/explore/earnings/${scanDay}` },
  };
}

export const dynamic = "force-dynamic";

export default async function ExploreEarningsArchive({ params }: PageProps) {
  const { scanDay } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scanDay)) notFound();
  const preview = await loadEarningsPreview(scanDay);
  if (!preview) notFound();
  const archive = (await listEarningsScanDays(60))
    .filter((d) => d !== preview.scanDay)
    .map((d) => ({ scanDay: d, href: `/explore/earnings/${d}`, label: "View preview" }));
  return <EarningsPreviewView preview={preview} archive={archive} />;
}
