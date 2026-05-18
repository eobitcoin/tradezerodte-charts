import type { Metadata } from "next";
import {
  loadInstitutionalPreview,
  listInstitutionalScanDays,
} from "@/lib/explore-preview";
import InstitutionalPreviewView from "@/components/InstitutionalPreviewView";
import { renderInstitutionalLatestEmpty } from "@/components/ExploreEmptyStates";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";

export const metadata: Metadata = {
  title: "Institutional Flow — Where Smart Money Is Quietly Buying",
  description:
    "Weekly 13F-driven scan of stocks where hedge funds and Berkshire are accumulating before retail catches on. Public preview — sign up for the full thesis.",
  alternates: { canonical: `${APP_URL}/explore/institutional` },
};

export const dynamic = "force-dynamic";

export default async function ExploreInstitutionalLatest() {
  const preview = await loadInstitutionalPreview();
  if (!preview) return renderInstitutionalLatestEmpty();
  const archive = (await listInstitutionalScanDays(60))
    .filter((d) => d !== preview.scanDay)
    .map((d) => ({ scanDay: d, href: `/explore/institutional/${d}`, label: "View preview" }));
  return <InstitutionalPreviewView preview={preview} archive={archive} />;
}
