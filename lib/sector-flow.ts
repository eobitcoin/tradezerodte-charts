/**
 * Sector Flow scanner.
 *
 * Pulls 2-min windows of stock trades + NBBO for the 22-name universe,
 * classifies each print as aggressive-buy / aggressive-sell / ambiguous
 * via classifyAggressor (same Lee-Ready-style rule UOA uses), aggregates
 * per ticker, and upserts one row per (ticker, window_start) into
 * sector_flow_bars.
 *
 * Universe (22 names):
 *   Sector SPDRs (11): XLK XLF XLE XLV XLY XLP XLI XLB XLU XLRE XLC
 *   Index ETFs    (4): SPY QQQ IWM DIA
 *   Mag 7         (7): AAPL MSFT NVDA GOOGL AMZN META TSLA
 *
 * The /sector page rolls bars up at read time:
 *   5m  = SUM of last 3 bars
 *   1h  = SUM of last 30 bars
 *   1d  = SUM since session open
 *   1w  = SUM since 5 trading days ago
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { sectorFlowBars } from "@/lib/db/schema";
import {
  fetchStockTrades,
  fetchStockQuotes,
  classifyAggressor,
  type PolygonStockTrade,
  type PolygonStockQuote,
} from "@/lib/polygon";

/** Universe of names rendered on /sector. Locked — the cron expects this list. */
export const SECTOR_FLOW_UNIVERSE = [
  // Sector SPDRs
  "XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLB", "XLU", "XLRE", "XLC",
  // Index ETFs
  "SPY", "QQQ", "IWM", "DIA",
  // Mag 7
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA",
] as const;

export type SectorTicker = typeof SECTOR_FLOW_UNIVERSE[number];

/** Display grouping — feeds the legend on the bubble chart. */
export const SECTOR_FLOW_GROUPS: Record<string, SectorTicker[]> = {
  Indexes: ["SPY", "QQQ", "IWM", "DIA"],
  Sectors: ["XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLB", "XLU", "XLRE", "XLC"],
  "Mag 7": ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA"],
};

const NS_PER_MS = 1_000_000;

/** Floor a Date to the nearest N-minute boundary (UTC). */
export function floorToWindowMs(ms: number, windowMinutes: number): number {
  const windowMs = windowMinutes * 60_000;
  return Math.floor(ms / windowMs) * windowMs;
}

/** Pick a trade's timestamp — Polygon may set sip or participant. */
function tradeTs(t: PolygonStockTrade): number | null {
  const ts = t.sip_timestamp ?? t.participant_timestamp;
  return typeof ts === "number" && ts > 0 ? ts : null;
}

function quoteTs(q: PolygonStockQuote): number | null {
  const ts = q.sip_timestamp ?? q.participant_timestamp;
  return typeof ts === "number" && ts > 0 ? ts : null;
}

/** Per-ticker aggregate for one 2-min window. */
export interface SectorFlowAgg {
  ticker: string;
  windowStartMs: number;
  windowEndMs: number;
  buyVolume: number;
  sellVolume: number;
  ambiguousVolume: number;
  totalVolume: number;
  notionalUsd: number;
  openPrice: number | null;
  closePrice: number | null;
  tradeCount: number;
}

/**
 * Walk trades + quotes for one ticker, classify each print, return the
 * aggregate. Both arrays must be sorted asc by timestamp.
 *
 * Uses a monotonic index into `quotes` — since trades are asc, the
 * "latest quote at or before trade time" cursor only ever moves forward.
 * O(trades + quotes) total. No binary search needed.
 */
export function aggregateWindow(
  ticker: string,
  windowStartMs: number,
  windowEndMs: number,
  trades: PolygonStockTrade[],
  quotes: PolygonStockQuote[],
): SectorFlowAgg {
  let buyVol = 0;
  let sellVol = 0;
  let ambigVol = 0;
  let notional = 0;
  let tradeCount = 0;
  let openPrice: number | null = null;
  let closePrice: number | null = null;

  // Quote cursor — most recent quote at or before the current trade time.
  let qIdx = -1;
  let curBid: number | null = null;
  let curAsk: number | null = null;

  for (const t of trades) {
    const ts = tradeTs(t);
    if (ts == null) continue;
    if (t.size <= 0 || !Number.isFinite(t.price) || t.price <= 0) continue;

    // Advance quote cursor to latest quote with ts <= trade ts.
    while (qIdx + 1 < quotes.length) {
      const nextQTs = quoteTs(quotes[qIdx + 1]);
      if (nextQTs == null || nextQTs > ts) break;
      qIdx++;
      const q = quotes[qIdx];
      curBid = typeof q.bid_price === "number" && q.bid_price > 0 ? q.bid_price : curBid;
      curAsk = typeof q.ask_price === "number" && q.ask_price > 0 ? q.ask_price : curAsk;
    }

    const side = classifyAggressor(t.price, curBid, curAsk);
    if (side === "buy") buyVol += t.size;
    else if (side === "sell") sellVol += t.size;
    else ambigVol += t.size;

    notional += t.price * t.size;
    tradeCount++;
    if (openPrice == null) openPrice = t.price;
    closePrice = t.price;
  }

  return {
    ticker,
    windowStartMs,
    windowEndMs,
    buyVolume: buyVol,
    sellVolume: sellVol,
    ambiguousVolume: ambigVol,
    totalVolume: buyVol + sellVol + ambigVol,
    notionalUsd: Math.round(notional * 100) / 100,
    openPrice,
    closePrice,
    tradeCount,
  };
}

export interface SectorFlowScanResult {
  windowStartMs: number;
  windowEndMs: number;
  universeSize: number;
  written: number;
  errors: Array<{ ticker: string; message: string }>;
}

/**
 * Run one scan cycle across the universe. The window is the 2 minutes
 * immediately before `nowMs` (default now), aligned to the nearest 2-min
 * boundary so retries hit the same bar.
 *
 * `perTickerDelayMs` (default 250) — small inter-ticker pause to spread
 * Polygon load over the cron's wall-clock budget. With 22 tickers and 250ms
 * spacing that's ~5.5s of sleep + the per-ticker fetch time (1-3s each).
 *
 * Tickers that error are skipped — they get retried on the next cycle.
 */
export async function runSectorFlowScan(opts: {
  nowMs?: number;
  perTickerDelayMs?: number;
} = {}): Promise<SectorFlowScanResult> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const perTickerDelayMs = opts.perTickerDelayMs ?? 250;
  const now = opts.nowMs ?? Date.now();

  // The completed window is the one ending at the nearest 2-min boundary
  // <= now. Polygon trades for the current open window are still
  // streaming, so we always look one bar back.
  const boundaryMs = floorToWindowMs(now, 2);
  const windowEndMs = boundaryMs;
  const windowStartMs = boundaryMs - 2 * 60_000;
  const tsGteNs = windowStartMs * NS_PER_MS;
  const tsLteNs = (windowEndMs - 1) * NS_PER_MS;

  const errors: Array<{ ticker: string; message: string }> = [];
  let written = 0;
  let first = true;

  for (const ticker of SECTOR_FLOW_UNIVERSE) {
    if (!first) await sleep(perTickerDelayMs);
    first = false;
    try {
      const [trades, quotes] = await Promise.all([
        fetchStockTrades(ticker, { tsGteNs, tsLteNs }),
        fetchStockQuotes(ticker, { tsGteNs, tsLteNs }),
      ]);
      const agg = aggregateWindow(ticker, windowStartMs, windowEndMs, trades, quotes);

      // Skip writing a row when the window had zero trades — keeps the
      // table free of noise from pre-market / after-hours cron cycles.
      if (agg.tradeCount === 0) continue;

      await db
        .insert(sectorFlowBars)
        .values({
          ticker,
          windowStart: new Date(agg.windowStartMs),
          windowEnd: new Date(agg.windowEndMs),
          buyVolume: agg.buyVolume.toString(),
          sellVolume: agg.sellVolume.toString(),
          ambiguousVolume: agg.ambiguousVolume.toString(),
          totalVolume: agg.totalVolume.toString(),
          notionalUsd: agg.notionalUsd.toString(),
          openPrice: agg.openPrice != null ? agg.openPrice.toString() : null,
          closePrice: agg.closePrice != null ? agg.closePrice.toString() : null,
          tradeCount: agg.tradeCount,
        })
        .onConflictDoUpdate({
          target: [sectorFlowBars.ticker, sectorFlowBars.windowStart],
          set: {
            windowEnd: new Date(agg.windowEndMs),
            buyVolume: agg.buyVolume.toString(),
            sellVolume: agg.sellVolume.toString(),
            ambiguousVolume: agg.ambiguousVolume.toString(),
            totalVolume: agg.totalVolume.toString(),
            notionalUsd: agg.notionalUsd.toString(),
            openPrice: agg.openPrice != null ? agg.openPrice.toString() : null,
            closePrice: agg.closePrice != null ? agg.closePrice.toString() : null,
            tradeCount: agg.tradeCount,
            capturedAt: sql`now()`,
          },
        });
      written++;
    } catch (err) {
      errors.push({
        ticker,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Rolling retention — delete bars older than 8 days. Keeps the table at
  // ~34k live rows max (22 tickers × ~195 windows × 8 days).
  await db.execute(sql`
    DELETE FROM sector_flow_bars
    WHERE window_start < now() - interval '8 days'
  `);

  return {
    windowStartMs,
    windowEndMs,
    universeSize: SECTOR_FLOW_UNIVERSE.length,
    written,
    errors,
  };
}
