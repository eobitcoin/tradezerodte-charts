import type { Metadata } from "next";
import { loadSectorRotationPreview, listSectorRotationScanDays } from "@/lib/explore-preview";
import RotationPreviewView from "@/components/RotationPreviewView";
import { renderRotationLatestEmpty } from "@/components/ExploreEmptyStates";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Sector Rotation Detector — Where Capital Is Moving",
  description:
    "Weekly scan of S&P 500 sector leadership flips. Identifies sectors where relative strength just turned positive or negative — before headlines pick it up. Public preview.",
  alternates: { canonical: `${APP_URL}/explore/sector-rotation` },
};

export const dynamic = "force-dynamic";

export default async function ExploreRotationLatest() {
  const preview = await loadSectorRotationPreview();
  if (!preview) return renderRotationLatestEmpty();
  const archive = (await listSectorRotationScanDays(60))
    .filter((d) => d !== preview.scanDay)
    .map((d) => ({ scanDay: d, href: `/explore/sector-rotation/${d}`, label: "View preview" }));
  return <RotationPreviewView preview={preview} archive={archive} />;
}
