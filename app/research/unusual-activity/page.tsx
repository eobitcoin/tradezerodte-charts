import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { uoaScans } from "@/lib/db/schema";
import {
  fetchLatestIntradayPrints,
  fetchTodaySoFarTotals,
} from "@/lib/uoa";
import SiteHeader from "@/components/SiteHeader";
import OptionsSubNav from "@/components/OptionsSubNav";
import UoaScanView from "@/components/UoaScanView";

export const dynamic = "force-dynamic";

/**
 * /research/unusual-activity — landing for the latest daily Unusual
 * Options Activity scan. Reads the most recent row from uoa_scans.
 * Empty-state when no scan has been published yet.
 */
export default async function UnusualActivityLandingPage() {
  const [latest] = await db
    .select()
    .from(uoaScans)
    .orderBy(desc(uoaScans.scanDay))
    .limit(1);

  const archive = await db
    .select({ scanDay: uoaScans.scanDay })
    .from(uoaScans)
    .orderBy(desc(uoaScans.scanDay))
    .limit(12);

  // Last-hour intraday prints. Only relevant during RTH; outside it,
  // returns [] and the banner just doesn't render.
  const latestPrints = await fetchLatestIntradayPrints({
    lookbackMinutes: 60,
    limit: 10,
  });

  // Running totals for today (ET). Surfaces below the Latest Intraday
  // banner so users can see today's flow even though the page header
  // (driven by the EOD-locked uoa_scans row) still shows yesterday's
  // date until the 4:15 PM cron fires.
  const todaySoFar = await fetchTodaySoFarTotals();

  if (!latest) {
    return (
      <>
        <SiteHeader />
        <div className="max-w-6xl mx-auto px-4 pt-6">
          <OptionsSubNav active="unusual" />
        </div>
        <main className="max-w-5xl mx-auto px-4 py-12 space-y-4 text-center">
          <h1 className="text-xl font-semibold">No Unusual Activity scans yet</h1>
          <p className="text-sm text-black/60 dark:text-white/60 max-w-md mx-auto">
            The Unusual Activity scanner runs every trading day after
            market close. It walks the 25-ticker options watchlist,
            filters the day&apos;s tape for prints &gt;$50k with OI
            multiplier &ge; 3&times; and a clear aggressor side, and
            classifies each as bullish/bearish call/put buying or
            selling. The first scan will appear here once the routine
            publishes.
          </p>
          <Link href="/research/options-edge" className="inline-block underline text-sm">
            See Options Edge →
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <UoaScanView
        scan={latest}
        archive={archive.filter((a) => a.scanDay !== latest.scanDay)}
        latestPrints={latestPrints}
        todaySoFar={todaySoFar}
      />
    </>
  );
}
