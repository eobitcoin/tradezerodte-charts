import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadInsiderPreview, listInsiderScanDays } from "@/lib/explore-preview";
import InsiderPreviewView from "@/components/InsiderPreviewView";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

interface PageProps {
  params: Promise<{ scanDay: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { scanDay } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scanDay)) return {};
  const preview = await loadInsiderPreview(scanDay);
  if (!preview) return {};
  return {
    title: `${preview.title} | oliviatrades.com`,
    description: `Daily insider-buy scan for ${scanDay}. The headline pick is fully revealed; ${preview.buyCount - 1} other qualifying buys are members-only.`,
    alternates: { canonical: `${APP_URL}/explore/insider/${scanDay}` },
  };
}

export const dynamic = "force-dynamic";

export default async function ExploreInsiderArchive({ params }: PageProps) {
  const { scanDay } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scanDay)) notFound();
  const preview = await loadInsiderPreview(scanDay);
  if (!preview) notFound();
  const archive = (await listInsiderScanDays(60))
    .filter((d) => d !== preview.scanDay)
    .map((d) => ({ scanDay: d, href: `/explore/insider/${d}`, label: "View preview" }));
  return <InsiderPreviewView preview={preview} archive={archive} />;
}
