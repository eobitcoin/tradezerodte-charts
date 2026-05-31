import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gexSnapshots, type GexSnapshot } from "@/lib/db/schema";
import { GEX_WATCHLIST } from "@/lib/gex";
import SiteHeader from "@/components/SiteHeader";
import OptionsSubNav from "@/components/OptionsSubNav";
import GexUniverseTable from "@/components/GexUniverseTable";

export const dynamic = "force-dynamic";

/**
 * /research/gex — universe overview. One row per ticker showing the
 * latest snapshot. We run 13 small "latest per ticker" queries in
 * parallel rather than a fancy DISTINCT ON — drizzle's typed return
 * properly maps snake_case columns to camelCase, and 13 indexed
 * lookups against (ticker, ts desc) is microseconds.
 */
export default async function GexLandingPage() {
  const perTicker = await Promise.all(
    GEX_WATCHLIST.map(async (ticker) => {
      const [row] = await db
        .select()
        .from(gexSnapshots)
        .where(eq(gexSnapshots.ticker, ticker))
        .orderBy(desc(gexSnapshots.ts))
        .limit(1);
      return row;
    }),
  );
  // Preserve watchlist order; drop tickers that haven't been
  // snapshotted yet (cron hasn't run since they were added).
  const flat: GexSnapshot[] = perTicker.filter((r): r is GexSnapshot => Boolean(r));

  return (
    <>
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        <OptionsSubNav active="gex" />
        <header className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-amber-400">
            Dealer GEX · Refreshed every 5 minutes during RTH
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Gamma Exposure</h1>
          <p className="text-sm text-white/55 max-w-3xl">
            Net dealer gamma per ticker, computed from the live options
            chain under the standard dealer-long-calls / short-puts
            assumption. <strong className="text-emerald-300">Long γ</strong> regimes
            pin (dealers fade moves); <strong className="text-rose-300">short γ</strong>{" "}
            regimes amplify (dealers chase). The zero-gamma flip strike
            is where the regime changes — when spot crosses it, intraday
            volatility behavior often shifts.
          </p>
        </header>

        <GexUniverseTable rows={flat} />

        <footer className="text-xs text-white/45 border-t border-white/10 pt-4">
          <p>
            GEX = Σ over all strikes of (callOI · callGamma − putOI · putGamma)
            × 100 × spot². Universe: {GEX_WATCHLIST.length} tickers —
            3 indexes + mega-cap tech + high-flow single names. Sign
            convention is the standard SqueezeMetrics-style model; for
            indexes some practitioners use the opposite convention —
            interpret directional reads accordingly.
          </p>
        </footer>
      </main>
    </>
  );
}
