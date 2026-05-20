import type { Metadata } from "next";
import {
  loadDailyAnalysisPreview,
  listDailyAnalysisTradingDays,
} from "@/lib/explore-preview";
import DailyAnalysisPreviewView from "@/components/DailyAnalysisPreviewView";
import { renderDailyAnalysisLatestEmpty } from "@/components/ExploreEmptyStates";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Daily 0DTE Analysis — Today's Top-Ranked Trade",
  description:
    "Premarket 0DTE trading research, published every session. Top setups graded A+ to F. Public preview reveals the highest-ranked trade in full — sign up for the complete day's analysis.",
  alternates: { canonical: `${APP_URL}/explore/daily` },
};

export const dynamic = "force-dynamic";

export default async function ExploreDailyLatest() {
  const preview = await loadDailyAnalysisPreview();
  if (!preview) return renderDailyAnalysisLatestEmpty();
  const archive = (await listDailyAnalysisTradingDays(60))
    .filter((d) => d !== preview.tradingDay)
    .map((d) => ({ scanDay: d, href: `/explore/daily/${d}`, label: "View preview" }));
  return <DailyAnalysisPreviewView preview={preview} archive={archive} />;
}
