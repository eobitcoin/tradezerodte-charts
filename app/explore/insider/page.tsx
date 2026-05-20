import type { Metadata } from "next";
import { loadInsiderPreview, listInsiderScanDays } from "@/lib/explore-preview";
import InsiderPreviewView from "@/components/InsiderPreviewView";
import { renderInsiderLatestEmpty } from "@/components/ExploreEmptyStates";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Insider Buys (SEC Form 4) — Daily Scan",
  description:
    "The largest open-market insider purchases of the day, ranked by dollar value. Public preview shows the headline buy; the authenticated post lists every qualifying buy.",
  alternates: { canonical: `${APP_URL}/explore/insider` },
};

export const dynamic = "force-dynamic";

export default async function ExploreInsiderLatest() {
  const preview = await loadInsiderPreview();
  if (!preview) return renderInsiderLatestEmpty();
  const archive = (await listInsiderScanDays(60))
    .filter((d) => d !== preview.scanDay)
    .map((d) => ({ scanDay: d, href: `/explore/insider/${d}`, label: "View preview" }));
  return <InsiderPreviewView preview={preview} archive={archive} />;
}
