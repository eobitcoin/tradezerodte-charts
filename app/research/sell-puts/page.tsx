import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { sellPutScans, type SellPutScanData } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import OptionsSubNav from "@/components/OptionsSubNav";
import SellPutsView from "@/components/SellPutsView";

export const dynamic = "force-dynamic";

/**
 * /research/sell-puts — landing page for the weekly Sell Puts scan.
 * Reads the most recent row from sell_put_scans. Empty state if the
 * cron hasn't run yet.
 */
export default async function SellPutsPage() {
  const [latest] = await db
    .select()
    .from(sellPutScans)
    .orderBy(desc(sellPutScans.scanDay))
    .limit(1);

  if (!latest) {
    return (
      <>
        <SiteHeader />
        <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
          <OptionsSubNav active="sell-puts" />
          <header className="space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-amber-400">
              Sell Puts · Cash-secured short-put ranker
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Sell Puts</h1>
          </header>
          <div className="text-center space-y-4 max-w-md mx-auto pt-12">
            <h2 className="text-xl font-semibold">No Sell Puts scan yet</h2>
            <p className="text-sm text-black/60 dark:text-white/60">
              The Sell Puts cron runs every Sunday evening, walks a locked
              universe of ~50 large-cap US equities + index ETFs, and
              ranks the most attractive 21–45 DTE short puts by expected
              ROI = P(profit) × (credit / close). The first scan will
              appear here once the cron publishes.
            </p>
            <Link
              href="/research/leaps"
              className="inline-block underline text-sm"
            >
              See LEAPs →
            </Link>
          </div>
        </main>
      </>
    );
  }

  const scanData = latest.data as SellPutScanData;

  return (
    <>
      <SiteHeader />
      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <OptionsSubNav active="sell-puts" />
        <header className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[10px] uppercase tracking-widest text-amber-400">
              Sell Puts · Cash-secured short-put ranker
            </div>
            <Link
              href="/learn/sell-puts"
              className="text-xs text-white/55 hover:text-white hover:underline"
            >
              Help · how to read this →
            </Link>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Sell Puts</h1>
          <p className="text-sm text-white/55 max-w-3xl">
            Weekly scan of a locked universe of ~50 large-cap US equities
            + index ETFs. For each ticker we pick the most attractive
            21–45 DTE short put by expected ROI = P(profit) × (credit /
            close). Risk-neutral Black-Scholes probability drives P(profit);
            current chain bid drives credit. Sorted best-first.
          </p>
        </header>

        <SellPutsView
          scanDay={latest.scanDay}
          picks={scanData.picks}
          universeSize={latest.universeSize}
          computedSize={latest.computedSize}
        />
      </main>
    </>
  );
}
