import type { Metadata } from "next";
import { loadEarningsPreview, listEarningsScanDays } from "@/lib/explore-preview";
import EarningsPreviewView from "@/components/EarningsPreviewView";
import { renderEarningsLatestEmpty } from "@/components/ExploreEmptyStates";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Earnings Whiplash Map — Asymmetric Volatility Setups",
  description:
    "Weekly scan of S&P 500 earnings reports where options-implied move is meaningfully below historical realized move. Public preview — sign up for the full list.",
  alternates: { canonical: `${APP_URL}/explore/earnings` },
};

export const dynamic = "force-dynamic";

export default async function ExploreEarningsLatest() {
  const preview = await loadEarningsPreview();
  if (!preview) return renderEarningsLatestEmpty();
  const archive = (await listEarningsScanDays(60))
    .filter((d) => d !== preview.scanDay)
    .map((d) => ({ scanDay: d, href: `/explore/earnings/${d}`, label: "View preview" }));
  return <EarningsPreviewView preview={preview} archive={archive} />;
}
