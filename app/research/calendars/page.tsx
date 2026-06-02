import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendarScans, type CalendarScanData } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import OptionsSubNav from "@/components/OptionsSubNav";
import CalendarScanView from "@/components/CalendarScanView";

export const dynamic = "force-dynamic";

/**
 * /research/calendars — landing page for the weekly Calendar Trades
 * scan. Reads the most recent row from calendar_scans. Empty state
 * when the cron hasn't run yet.
 */
export default async function CalendarsPage() {
  const [latest] = await db
    .select()
    .from(calendarScans)
    .orderBy(desc(calendarScans.scanDay))
    .limit(1);

  if (!latest) {
    return (
      <>
        <SiteHeader />
        <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
          <OptionsSubNav active="calendars" />
          <header className="space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-amber-400">
              Calendars · High-probability calendar spread ranker
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Calendars</h1>
          </header>
          <div className="text-center space-y-4 max-w-md mx-auto pt-12">
            <h2 className="text-xl font-semibold">No Calendar scans yet</h2>
            <p className="text-sm text-black/60 dark:text-white/60">
              The Calendars cron runs every Sunday evening, walks the
              locked large-cap universe, and ranks long-calendar spread
              setups (sell ~30 DTE front-month ATM call, buy ~90 DTE
              back-month ATM call at the same strike) by IV rank, term
              structure, and earnings clearance. First scan appears
              here once the cron publishes.
            </p>
            <Link
              href="/research/sell-puts"
              className="inline-block underline text-sm"
            >
              See Sell Puts →
            </Link>
          </div>
        </main>
      </>
    );
  }

  const scanData = latest.data as CalendarScanData;

  return (
    <>
      <SiteHeader />
      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <OptionsSubNav active="calendars" />
        <header className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[10px] uppercase tracking-widest text-amber-400">
              Calendars · High-probability calendar spread ranker
            </div>
            <Link
              href="/learn/calendars"
              className="text-xs text-white/55 hover:text-white hover:underline"
            >
              Help · how to read this →
            </Link>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Calendars</h1>
          <p className="text-sm text-white/55 max-w-3xl">
            Weekly scan of the locked large-cap universe for
            high-probability long-calendar setups. Each pick is sized
            ATM (sell front ~30 DTE, buy back ~90 DTE at same strike),
            ranked by composite score = IV rank + term structure +
            post-earnings timing + DTE quality. Hard filters: no
            earnings in next 30d, IV rank ≥ 60%, front IV ≥ back IV.
          </p>
        </header>

        <CalendarScanView
          scanDay={latest.scanDay}
          picks={scanData.picks}
          universeSize={latest.universeSize}
          computedSize={latest.computedSize}
        />
      </main>
    </>
  );
}
