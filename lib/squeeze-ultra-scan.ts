/**
 * Squeeze Scan (ST Squeeze Ultra) scanner.
 *
 * A full-market price-action funnel for TTM-style squeezes:
 *
 *   1. Pull the Polygon all-tickers snapshot (1 call) for price + volume.
 *   2. Keep price >= $20 AND daily volume > 500,000, intersected with the
 *      common-stock / ADR reference set (optionable proxy — drops ETFs/ETNs).
 *   3. For each survivor, pull ~420 calendar days of daily OHLC bars (1 call),
 *      run the squeeze engine on the Daily series, resample to Weekly and run
 *      it again. Emit the latest confirmed signal per timeframe.
 *   4. Keep tickers that are IN A SQUEEZE on Daily and/or Weekly (any state,
 *      normal or ideal). Sort ideal-first, then tightest-state-first.
 *
 * Read-only and tolerant — any ticker that errors or lacks enough bars is
 * skipped, never fatal. Sized to finish inside a weekly cron.
 */

import {
  fetchAllTickersSnapshot,
  fetchCommonStockTickerSet,
  fetchUnderlyingOhlcBars,
  type PolygonOhlcBar,
} from "@/lib/polygon";
import {
  computeSeries,
  resampleWeekly,
  type OhlcBar,
  type SqueezeSignal,
} from "@/lib/squeeze-ultra-engine";
import type { SqueezeUltraRow, SqueezeUltraTf } from "@/lib/db/schema";

// ---- Filters ----
export const MIN_PRICE = 20;
export const MIN_DAY_VOLUME = 500_000;
/** Calendar days of daily bars to pull. ~420d ≈ 290 trading days ≈ 58 weekly
 *  bars — comfortably past the weekly momentum warmup (needs ~40). */
export const BARS_LOOKBACK_DAYS = 420;

// ---- Tunables ----
/** Cap on stored in-squeeze rows (keeps the JSONB bounded). */
const STORE_MAX_ROWS = 400;
/** Concurrency for the per-ticker bar pulls. */
const SCAN_CONCURRENCY = 16;
/** Safety backstop on deep-scan candidates. */
const MAX_DEEP_SCAN = 4000;
/** Minimum daily bars required to produce a usable signal. */
const MIN_BARS = 60;

function isoDaysAgo(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Bounded-concurrency map preserving input order. */
async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function toTf(sig: SqueezeSignal | null): SqueezeUltraTf {
  if (!sig) {
    return { state: null, label: null, inSqueeze: false, ideal: false, momentum: null, momColor: null };
  }
  return {
    state: sig.state,
    label: sig.label,
    inSqueeze: sig.inSqueeze,
    ideal: sig.ideal,
    momentum: sig.momentum,
    momColor: sig.momColor,
  };
}

interface ScanResult {
  symbol: string;
  row: SqueezeUltraRow | null;
}

async function scanTicker(
  symbol: string,
  price: number,
  dayVolume: number,
  fromDate: string,
  toDate: string,
): Promise<ScanResult> {
  try {
    const bars: PolygonOhlcBar[] = await fetchUnderlyingOhlcBars(symbol, fromDate, toDate);
    if (bars.length < MIN_BARS) return { symbol, row: null };

    const dailyBars: OhlcBar[] = bars.map((b) => ({ date: b.date, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
    const weeklyBars = resampleWeekly(dailyBars);

    const dailySeries = computeSeries(dailyBars);
    const weeklySeries = weeklyBars.length > 0 ? computeSeries(weeklyBars) : [];
    const daily = toTf(dailySeries.length ? dailySeries[dailySeries.length - 1] : null);
    const weekly = toTf(weeklySeries.length ? weeklySeries[weeklySeries.length - 1] : null);

    // Only keep names in a squeeze on at least one timeframe.
    if (!daily.inSqueeze && !weekly.inSqueeze) return { symbol, row: null };

    return {
      symbol,
      row: {
        symbol,
        price: Math.round(price * 100) / 100,
        dayVolume,
        daily,
        weekly,
      },
    };
  } catch {
    return { symbol, row: null };
  }
}

/** Sort key: ideal-first (weekly weighted over daily), then tightest state. */
function sortRows(rows: SqueezeUltraRow[]): SqueezeUltraRow[] {
  const idealRank = (r: SqueezeUltraRow) => (r.weekly.ideal ? 2 : 0) + (r.daily.ideal ? 1 : 0);
  const tightness = (r: SqueezeUltraRow) => Math.max(r.daily.state ?? 0, r.weekly.state ?? 0);
  const stateSum = (r: SqueezeUltraRow) => (r.daily.state ?? 0) + (r.weekly.state ?? 0);
  return [...rows].sort((a, b) => {
    const di = idealRank(b) - idealRank(a);
    if (di !== 0) return di;
    const dt = tightness(b) - tightness(a);
    if (dt !== 0) return dt;
    const ds = stateSum(b) - stateSum(a);
    if (ds !== 0) return ds;
    return b.dayVolume - a.dayVolume;
  });
}

export interface SqueezeUltraResult {
  universeSize: number;
  computedSize: number;
  rows: SqueezeUltraRow[];
  counts: { dailyIdeal: number; weeklyIdeal: number; dailySqueeze: number; weeklySqueeze: number };
  timing: { snapshotSec: number; scanSec: number; totalSec: number };
  truncated: boolean;
}

export async function runSqueezeUltraScan(today: string): Promise<SqueezeUltraResult> {
  const start = Date.now();
  const fromDate = isoDaysAgo(today, BARS_LOOKBACK_DAYS);
  const toDate = today;

  // Phase 1: snapshot + optionable reference set (parallel) → price/volume/stock gate.
  const [snap, stockSet] = await Promise.all([
    fetchAllTickersSnapshot(),
    fetchCommonStockTickerSet().catch(() => new Set<string>()),
  ]);
  const snapshotSec = (Date.now() - start) / 1000;

  let candidates = snap.filter(
    (s) =>
      s.price != null && s.price >= MIN_PRICE &&
      s.dayVolume != null && s.dayVolume > MIN_DAY_VOLUME &&
      (stockSet.size === 0 || stockSet.has(s.ticker.toUpperCase())),
  );
  const truncated = candidates.length > MAX_DEEP_SCAN;
  if (truncated) {
    candidates = candidates.sort((a, b) => (b.dayVolume ?? 0) - (a.dayVolume ?? 0)).slice(0, MAX_DEEP_SCAN);
  }
  const universeSize = candidates.length;

  // Phase 2: per-ticker bar pull + squeeze compute (bounded concurrency).
  const scanStart = Date.now();
  const results = await mapConcurrent(candidates, SCAN_CONCURRENCY, (c) =>
    scanTicker(c.ticker, c.price!, c.dayVolume!, fromDate, toDate),
  );
  const scanSec = (Date.now() - scanStart) / 1000;

  const inSqueeze = results.map((r) => r.row).filter((r): r is SqueezeUltraRow => r != null);

  const counts = {
    dailyIdeal: inSqueeze.filter((r) => r.daily.ideal).length,
    weeklyIdeal: inSqueeze.filter((r) => r.weekly.ideal).length,
    dailySqueeze: inSqueeze.filter((r) => r.daily.inSqueeze).length,
    weeklySqueeze: inSqueeze.filter((r) => r.weekly.inSqueeze).length,
  };

  const rows = sortRows(inSqueeze).slice(0, STORE_MAX_ROWS);

  return {
    universeSize,
    computedSize: inSqueeze.length,
    rows,
    counts,
    timing: { snapshotSec, scanSec, totalSec: (Date.now() - start) / 1000 },
    truncated,
  };
}
