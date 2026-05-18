import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSectorRotationPreview, listSectorRotationScanDays } from "@/lib/explore-preview";
import RotationPreviewView from "@/components/RotationPreviewView";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";

interface PageProps {
  params: Promise<{ scanDay: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { scanDay } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scanDay)) return {};
  const preview = await loadSectorRotationPreview(scanDay);
  if (!preview) return {};
  const desc = preview.summary
    ? preview.summary.slice(0, 180).trim() + (preview.summary.length > 180 ? "…" : "")
    : "Weekly sector rotation scan.";
  return {
    title: `Sector Rotation — ${scanDay} | tradezerodte.com`,
    description: desc,
    alternates: { canonical: `${APP_URL}/explore/sector-rotation/${scanDay}` },
  };
}

export const dynamic = "force-dynamic";

export default async function ExploreRotationArchive({ params }: PageProps) {
  const { scanDay } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scanDay)) notFound();
  const preview = await loadSectorRotationPreview(scanDay);
  if (!preview) notFound();
  const archive = (await listSectorRotationScanDays(60))
    .filter((d) => d !== preview.scanDay)
    .map((d) => ({ scanDay: d, href: `/explore/sector-rotation/${d}`, label: "View preview" }));
  return <RotationPreviewView preview={preview} archive={archive} />;
}
