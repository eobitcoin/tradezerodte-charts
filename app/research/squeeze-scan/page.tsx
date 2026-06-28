import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { squeezeUltraScans, type SqueezeUltraScanData } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import StocksNavTabs from "@/components/StocksNavTabs";
import SqueezeUltraView from "@/components/SqueezeUltraView";

export const dynamic = "force-dynamic";

/**
 * /research/squeeze-scan — ST Squeeze Ultra full-market scanner.
 * Reads the most recent squeeze_ultra_scans row. Empty state until the
 * weekly cron publishes.
 */
export default async function SqueezeScanPage() {
  const [latest] = await db
    .select()
    .from(squeezeUltraScans)
    .orderBy(desc(squeezeUltraScans.scanDay))
    .limit(1);

  return (
    <>
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        <StocksNavTabs active="squeeze-scan" />

        <header className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[10px] uppercase tracking-widest text-amber-400">
              Squeeze Scan · ST Squeeze Ultra
            </div>
            <Link
              href="/learn/squeeze-scan"
              className="text-xs text-white/55 hover:text-white hover:underline whitespace-nowrap"
            >
              Help · how to read this →
            </Link>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Squeeze Scan</h1>
          <p className="text-sm text-white/55 max-w-3xl">
            Weekly full-market scan for ST Squeeze Ultra setups — Bollinger Bands
            compressing inside Keltner Channels — across every optionable US stock
            priced $20+ with daily volume over 500,000. Each name shows its squeeze
            state and momentum on the <strong>Daily</strong> and <strong>Weekly</strong>{" "}
            timeframes, with the cleanest stacked-EMA &ldquo;ideal&rdquo; coils flagged.
          </p>
        </header>

        {latest ? (
          <SqueezeUltraView
            scanDay={latest.scanDay}
            universeSize={latest.universeSize}
            computedSize={latest.computedSize}
            data={latest.data as SqueezeUltraScanData}
          />
        ) : (
          <div className="text-center space-y-3 max-w-md mx-auto pt-12">
            <h2 className="text-xl font-semibold">No Squeeze Scan yet</h2>
            <p className="text-sm text-white/55">
              The Squeeze Scan cron runs every Sunday evening. It pulls the entire
              US-stock snapshot, keeps optionable names priced $20+ with 500k+ daily
              volume, then runs the ST Squeeze Ultra engine on Daily and Weekly bars.
              The first scan will appear here once the cron publishes.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
