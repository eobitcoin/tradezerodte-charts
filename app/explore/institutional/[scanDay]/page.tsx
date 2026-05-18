import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  loadInstitutionalPreview,
  listInstitutionalScanDays,
} from "@/lib/explore-preview";
import InstitutionalPreviewView from "@/components/InstitutionalPreviewView";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";

interface PageProps {
  params: Promise<{ scanDay: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { scanDay } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scanDay)) return {};
  const preview = await loadInstitutionalPreview(scanDay);
  if (!preview) return {};
  const desc = preview.summary
    ? preview.summary.slice(0, 180).trim() + (preview.summary.length > 180 ? "…" : "")
    : "Weekly 13F-driven institutional flow scan.";
  return {
    title: `Institutional Flow — ${scanDay} | tradezerodte.com`,
    description: desc,
    alternates: { canonical: `${APP_URL}/explore/institutional/${scanDay}` },
  };
}

export const dynamic = "force-dynamic";

export default async function ExploreInstitutionalArchive({ params }: PageProps) {
  const { scanDay } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scanDay)) notFound();
  const preview = await loadInstitutionalPreview(scanDay);
  if (!preview) notFound();
  const archive = (await listInstitutionalScanDays(60))
    .filter((d) => d !== preview.scanDay)
    .map((d) => ({ scanDay: d, href: `/explore/institutional/${d}`, label: "View preview" }));
  return <InstitutionalPreviewView preview={preview} archive={archive} />;
}
