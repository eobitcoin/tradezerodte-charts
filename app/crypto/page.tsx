import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  CRYPTO_TICKERS,
  RADAR_TIMEFRAMES,
  buildRadarRow,
  emptyCells,
  fetchCryptoQuotes,
  type CryptoRadarRow,
  type CryptoTicker,
  type RadarCell,
} from "@/lib/crypto";
import type { RadarSignal, RadarTimeframe } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import CryptoTabs from "@/components/CryptoTabs";
import CryptoRadarTable from "@/components/CryptoRadarTable";

export const dynamic = "force-dynamic";

interface LatestRow {
  ticker: string;
  timeframe: string;
  signal: string;
  indicator: string | null;
  price: string | null;
  // db.execute(sql.raw(...)) returns timestamps as ISO strings.
  signal_at: string | Date | null;
  created_at: string | Date | null;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function CryptoRadarPage() {
  // Pull latest signal per (ticker, timeframe) — DISTINCT ON.
  const tickerLiteral = CRYPTO_TICKERS.map((t) => `'${t}'`).join(",");
  const result = await db.execute(sql.raw(`
    SELECT DISTINCT ON (ticker, timeframe)
      ticker, timeframe, signal, indicator,
      price::text AS price,
      signal_at, created_at
    FROM crypto_radar_signals
    WHERE ticker IN (${tickerLiteral})
    ORDER BY ticker, timeframe,
             COALESCE(signal_at, created_at) DESC NULLS LAST,
             created_at DESC
  `));
  const rowsRaw = [...result] as unknown as LatestRow[];

  // Live current prices (Coingecko, cached ~60s).
  const quotes = await fetchCryptoQuotes();

  // Index signals by ticker × timeframe.
  const byTicker = {} as Record<CryptoTicker, Record<RadarTimeframe, RadarCell>>;
  for (const t of CRYPTO_TICKERS) byTicker[t] = emptyCells();
  for (const r of rowsRaw) {
    const tk = r.ticker as CryptoTicker;
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

  const rows: CryptoRadarRow[] = CRYPTO_TICKERS.map((t) =>
    buildRadarRow<CryptoTicker>(t, byTicker[t]),
  );
  const now = new Date();
  const totalSignals = rowsRaw.length;
  const tickersWithAtLeastOne = new Set(rowsRaw.map((r) => r.ticker)).size;

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Crypto</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Live radar + daily research for {CRYPTO_TICKERS.length} crypto USDT pairs.
          </p>
        </header>
        <CryptoTabs active="radar" />
        {totalSignals === 0 && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            No signals received yet. Configure TradingView crypto alerts to POST to{" "}
            <code className="px-1 py-0.5 rounded bg-black/5 dark:bg-white/10 text-xs">
              /api/crypto/radar/signal/&lt;TOKEN&gt;
            </code>{" "}
            and they&apos;ll appear here. The &quot;Current Price&quot; column is live regardless.
          </div>
        )}
        {totalSignals > 0 && (
          <p className="text-xs text-black/50 dark:text-white/50">
            {totalSignals} unique cells populated · {tickersWithAtLeastOne} of {CRYPTO_TICKERS.length} tickers active
          </p>
        )}
        <CryptoRadarTable rows={rows} quotes={quotes} now={now} />
      </div>
    </>
  );
}
