import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { uoaScans } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import OptionsSubNav from "@/components/OptionsSubNav";
import UoaScanView from "@/components/UoaScanView";

// OptionsSubNav is rendered inside UoaScanView for populated scans —
// imported here too only for the empty-state branch below.

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

  if (!latest) {
    return (
      <>
        <SiteHeader />
        <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
          <header className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Unusual Activity</h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              Daily smart-money flow scan across the 25-ticker options watchlist.
            </p>
          </header>
          <OptionsSubNav active="unusual" />
          <div className="text-center space-y-4 max-w-md mx-auto pt-12">
            <h2 className="text-xl font-semibold">No Unusual Activity scans yet</h2>
            <p className="text-sm text-black/60 dark:text-white/60">
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
          </div>
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
      />
    </>
  );
}
