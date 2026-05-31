import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { gexSnapshots, type GexSnapshot } from "@/lib/db/schema";
import { GEX_WATCHLIST } from "@/lib/gex";
import SiteHeader from "@/components/SiteHeader";
import OptionsSubNav from "@/components/OptionsSubNav";
import GexUniverseTable from "@/components/GexUniverseTable";

export const dynamic = "force-dynamic";

/**
 * /research/gex — universe overview. One row per ticker showing the
 * latest snapshot. Backed by a DISTINCT ON query that grabs the
 * freshest snapshot per ticker without a separate aggregation step.
 */
export default async function GexLandingPage() {
  // Latest snapshot per ticker. DISTINCT ON + ORDER BY (ticker, ts desc)
  // is the canonical Postgres pattern for "newest per group" — single
  // table scan, no window function.
  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (ticker) *
    FROM ${gexSnapshots}
    ORDER BY ticker, ts DESC
  `)) as unknown as { rows?: GexSnapshot[] } | GexSnapshot[];

  // postgres-js returns the array directly; drizzle's execute can wrap
  // it in { rows }. Handle both.
  const flat: GexSnapshot[] = Array.isArray(rows)
    ? rows
    : (rows.rows ?? []);

  // Sort by watchlist position so the table reads consistently
  // (indexes first, then mega-cap tech, then high-flow names).
  const order = new Map(GEX_WATCHLIST.map((t, i) => [t as string, i]));
  flat.sort(
    (a, b) =>
      (order.get(a.ticker) ?? 999) - (order.get(b.ticker) ?? 999),
  );

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
