import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  loadDailyAnalysisPreview,
  listDailyAnalysisTradingDays,
} from "@/lib/explore-preview";
import DailyAnalysisPreviewView from "@/components/DailyAnalysisPreviewView";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";

interface PageProps {
  params: Promise<{ tradingDay: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tradingDay } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay)) return {};
  const preview = await loadDailyAnalysisPreview(tradingDay);
  if (!preview) return {};
  const desc = preview.headlineTrade?.rationale
    ? preview.headlineTrade.rationale.slice(0, 180).trim() +
      (preview.headlineTrade.rationale.length > 180 ? "…" : "")
    : `Daily 0DTE trading research for ${tradingDay}.`;
  return {
    title: `Daily 0DTE Analysis — ${tradingDay} | tradezerodte.com`,
    description: desc,
    alternates: { canonical: `${APP_URL}/explore/daily/${tradingDay}` },
  };
}

export const dynamic = "force-dynamic";

export default async function ExploreDailyArchive({ params }: PageProps) {
  const { tradingDay } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay)) notFound();
  const preview = await loadDailyAnalysisPreview(tradingDay);
  if (!preview) notFound();
  const archive = (await listDailyAnalysisTradingDays(60))
    .filter((d) => d !== preview.tradingDay)
    .map((d) => ({ scanDay: d, href: `/explore/daily/${d}`, label: "View preview" }));
  return <DailyAnalysisPreviewView preview={preview} archive={archive} />;
}
