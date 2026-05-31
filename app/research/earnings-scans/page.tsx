import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { earningsScans, type EarningsScanData } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import OptionsSubNav from "@/components/OptionsSubNav";
import EarningsScanView from "@/components/EarningsScanView";

export const dynamic = "force-dynamic";

/**
 * /research/earnings-scans — landing page for the weekly Earnings
 * Scans. Reads the most recent row from earnings_scans. Empty state
 * if the cron hasn't run yet.
 */
export default async function EarningsScansPage() {
  const [latest] = await db
    .select()
    .from(earningsScans)
    .orderBy(desc(earningsScans.scanWeek))
    .limit(1);

  if (!latest) {
    return (
      <>
        <SiteHeader />
        <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
          <OptionsSubNav active="earnings" />
          <header className="space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-amber-400">
              Earnings Scans · Pre-earnings options strategy ranker
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Earnings</h1>
          </header>
          <div className="text-center space-y-4 max-w-md mx-auto pt-12">
            <h2 className="text-xl font-semibold">No earnings scans yet</h2>
            <p className="text-sm text-black/60 dark:text-white/60">
              The Earnings Scans cron runs every Sunday evening, pulls the
              upcoming week&apos;s earnings calendar from Finnhub, walks each
              ticker, and scores the four strategies (Rush / Condor /
              Straddle / Breakout) against historical earnings effects. The
              first scan will appear here once the cron publishes.
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

  const scanData = latest.data as EarningsScanData;

  return (
    <>
      <SiteHeader />
      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <OptionsSubNav active="earnings" />
        <header className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="text-[10px] uppercase tracking-widest text-amber-400">
              Earnings Scans · Pre-earnings options strategy ranker
            </div>
            <Link
              href="/learn/earnings-scans"
              className="text-xs text-white/55 hover:text-white hover:underline"
            >
              Help · how to read this →
            </Link>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Earnings</h1>
          <p className="text-sm text-white/55 max-w-3xl">
            For each company reporting next week, compares the historical
            earnings move magnitude against the current IV-implied move
            and scores all four earnings-options strategies. All four
            tabs (Straddle, Condor, Breakout, Rush) are gated by real
            Polygon-priced backtests across ~6-10 past cycles.
          </p>
        </header>

        <EarningsScanView
          coveredFrom={scanData.coveredFrom}
          coveredTo={scanData.coveredTo}
          tickers={scanData.tickers}
        />
      </main>
    </>
  );
}
