import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  RADAR_TICKERS,
  RADAR_TIMEFRAMES,
  buildRadarRow,
  emptyCells,
  fetchEquityQuotes,
  type RadarCell,
  type RadarRow,
  type RadarTicker,
} from "@/lib/radar";
import type { RadarSignal, RadarTimeframe } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import StocksNavTabs from "@/components/StocksNavTabs";
import RadarTable from "@/components/RadarTable";

export const dynamic = "force-dynamic";

interface LatestRow {
  ticker: string;
  timeframe: string;
  signal: string;
  indicator: string | null;
  price: string | null;
  // db.execute(sql.raw(...)) returns timestamps as ISO strings (not Date),
  // unlike Drizzle's typed query builder. We coerce to Date below.
  signal_at: string | Date | null;
  created_at: string | Date | null;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function RadarPage() {
  // One query per Postgres trick: DISTINCT ON keeps just the latest signal per
  // (ticker, timeframe). Order key is (ticker, timeframe, latest-first); the
  // first row in each group wins.
  const tickerLiteral = RADAR_TICKERS.map((t) => `'${t}'`).join(",");
  const result = await db.execute(sql.raw(`
    SELECT DISTINCT ON (ticker, timeframe)
      ticker, timeframe, signal, indicator,
      price::text AS price,
      signal_at, created_at
    FROM radar_signals
    WHERE ticker IN (${tickerLiteral})
    ORDER BY ticker, timeframe,
             COALESCE(signal_at, created_at) DESC NULLS LAST,
             created_at DESC
  `));

  // The `postgres` driver returns an iterable RowList; spread to plain array.
  const rowsRaw = [...result] as unknown as LatestRow[];

  // Index by [ticker][timeframe]
  const byTicker: Record<RadarTicker, Record<RadarTimeframe, RadarCell>> = {} as Record<
    RadarTicker,
    Record<RadarTimeframe, RadarCell>
  >;
  for (const t of RADAR_TICKERS) {
    byTicker[t] = emptyCells();
  }
  for (const r of rowsRaw) {
    const tk = r.ticker as RadarTicker;
    const tf = r.timeframe as RadarTimeframe;
    if (!byTicker[tk]) continue;
    if (!RADAR_TIMEFRAMES.includes(tf)) continue;
    byTicker[tk][tf] = {
      signal: r.signal as RadarSignal,
      indicator: r.indicator,
      price: r.price != null ? Number(r.price) : null,
      signalAt: toDate(r.signal_at),
      createdAt: toDate(r.created_at),
    };
  }

  const rows: RadarRow[] = RADAR_TICKERS.map((t) => buildRadarRow(t, byTicker[t]));
  // Fire the Tradier quote fetch in parallel so it doesn't add latency to the
  // already-completed DB query. (DB is local — this Promise still drives total
  // page latency, ~200-400ms for 18 symbols.)
  const quotes = await fetchEquityQuotes(RADAR_TICKERS);
  const now = new Date();

  const totalSignals = rowsRaw.length;
  const tickersWithAtLeastOne = new Set(rowsRaw.map((r) => r.ticker)).size;

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <StocksNavTabs active="radar" />
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Radar</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            TradingView buy/sell signals for {RADAR_TICKERS.length} tickers across 4H, Daily, and Weekly timeframes.
            Tickers with all-three-agree are highlighted at the top.
          </p>
          {totalSignals === 0 ? (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              No signals received yet. Configure TradingView alerts to POST to{" "}
              <code className="px-1 py-0.5 rounded bg-black/5 dark:bg-white/10 text-xs">
                /api/radar/signal/&lt;TOKEN&gt;
              </code>{" "}
              and they&apos;ll appear here.
            </div>
          ) : (
            <p className="text-xs text-black/50 dark:text-white/50">
              {totalSignals} unique cells populated · {tickersWithAtLeastOne} of {RADAR_TICKERS.length} tickers active
            </p>
          )}
        </header>

        <RadarTable rows={rows} quotes={quotes} now={now} />
      </div>
    </>
  );
}
