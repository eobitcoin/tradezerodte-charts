import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { premiumRankerScans, type PremiumRankerScanData } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import OptionsSubNav from "@/components/OptionsSubNav";
import SellOptionsSubNav from "@/components/SellOptionsSubNav";
import PremiumRankerView from "@/components/PremiumRankerView";

export const dynamic = "force-dynamic";

/**
 * /research/premium-ranker — full-market high-IV / premium scanner.
 * Reads the most recent premium_ranker_scans row. Empty state until the
 * weekly cron publishes.
 */
export default async function PremiumRankerPage() {
  const [latest] = await db
    .select()
    .from(premiumRankerScans)
    .orderBy(desc(premiumRankerScans.scanDay))
    .limit(1);

  return (
    <>
      <SiteHeader />
      <main className="max-w-7xl mx-auto px-4 py-8 space-y-5">
        <OptionsSubNav active="sell-options" />
        <SellOptionsSubNav active="premium-ranker" />

        <header className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-amber-400">
            Premium Ranker · High-IV / premium scanner
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Premium Ranker</h1>
          <p className="text-sm text-white/55 max-w-3xl">
            Weekly full-market scan of every optionable US stock priced $20+
            with daily volume over 500,000. Ranked by 30-day ATM implied
            volatility and by short-put premium richness — the two reads a
            premium seller cares about. The three headline ideas pair each
            name&apos;s best cash-secured naked put with a defined-risk put
            credit spread.
          </p>
        </header>

        {latest ? (
          <PremiumRankerView
            scanDay={latest.scanDay}
            universeSize={latest.universeSize}
            computedSize={latest.computedSize}
            data={latest.data as PremiumRankerScanData}
          />
        ) : (
          <div className="text-center space-y-3 max-w-md mx-auto pt-12">
            <h2 className="text-xl font-semibold">No Premium Ranker scan yet</h2>
            <p className="text-sm text-white/55">
              The Premium Ranker cron runs every Sunday evening. It pulls the
              entire US-stock snapshot, keeps names priced $20+ with 500k+
              daily volume and listed options, then ranks them by implied
              vol and premium. The first scan will appear here once the cron
              publishes.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
