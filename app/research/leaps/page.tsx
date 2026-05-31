import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { leapScans } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import OptionsSubNav from "@/components/OptionsSubNav";
import LeapScanView from "@/components/LeapScanView";

export const dynamic = "force-dynamic";

/**
 * /research/leaps — landing for the latest weekly Cheap LEAPs scan.
 */
export default async function LeapsLandingPage() {
  const [latest] = await db
    .select()
    .from(leapScans)
    .orderBy(desc(leapScans.scanDay))
    .limit(1);

  const archive = await db
    .select({ scanDay: leapScans.scanDay })
    .from(leapScans)
    .orderBy(desc(leapScans.scanDay))
    .limit(12);

  if (!latest) {
    return (
      <>
        <SiteHeader />
        <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
          <OptionsSubNav active="leaps" />
          <header className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Cheap LEAPs</h1>
            <p className="text-sm text-black/60 dark:text-white/60 max-w-3xl">
              Weekly scan that surfaces 14-20 month calls where (a) implied vol
              is in the bottom quartile of its 1-year range, (b) the company
              has solid SEC fundamentals (revenue growth, positive op income,
              cash buffer), and (c) the stock has pulled back 25-50% from its
              52-week high while staying above its 200-day moving average.
              Vega-positive long-term position — two ways to win (delta +
              vega).
            </p>
          </header>
          <div className="text-center space-y-4 max-w-md mx-auto pt-12">
            <h2 className="text-xl font-semibold">No LEAPs scans yet</h2>
            <p className="text-sm text-black/60 dark:text-white/60">
              The Cheap LEAPs scanner runs every Sunday at 5 PM ET.
              The first scan will appear here once the routine
              publishes.
            </p>
            <Link
              href="/research/options-edge"
              className="inline-block underline text-sm"
            >
              See Options Edge →
            </Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <LeapScanView
        scan={latest}
        archive={archive.filter((a) => a.scanDay !== latest.scanDay)}
      />
    </>
  );
}
