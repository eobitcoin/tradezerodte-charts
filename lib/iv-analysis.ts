/**
 * IV anomaly analysis — runs against the iv_snapshots historical depth.
 *
 * For each ticker, computes four metrics + their 1-year statistics:
 *   1. atm_iv_rank   — current 30d ATM IV percentile vs 1y history
 *   2. skew_z        — (put25Δ - call25Δ) z-score vs 1y norm
 *   3. term_z        — (60d - 30d ATM) z-score vs 1y norm
 *   4. iv_hv_ratio   — current 30d ATM IV / 30d realized HV, z-scored
 *
 * Surfaces top-N anomalies (|z| > THRESHOLD) with suggested trades per
 * metric direction. Returns null fields when history is too thin — won't
 * fake a z-score with only 30 data points.
 */

import { desc, eq, sql, and, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { ivSnapshots, type OptionsEdgeAnomaly } from "@/lib/db/schema";

/** Minimum observations required to compute a stable z-score. */
const MIN_HISTORY = 60;
/** |z| ≥ this and the candidate enters the anomaly list. */
const ANOMALY_THRESHOLD = 2.0;

/** Stats over a number series — used everywhere. */
function stats(values: number[]): { mean: number; std: number; n: number } {
  const filtered = values.filter((v) => Number.isFinite(v));
  const n = filtered.length;
  if (n === 0) return { mean: NaN, std: NaN, n: 0 };
  const mean = filtered.reduce((s, v) => s + v, 0) / n;
  if (n < 2) return { mean, std: NaN, n };
  const variance =
    filtered.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return { mean, std: Math.sqrt(variance), n };
}

/** Empirical percentile of `value` in `series` — 0..100. */
function percentileRank(value: number, series: number[]): number {
  const sorted = series.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  // Fraction of values strictly below `value`, ties count as half.
  let below = 0;
  let ties = 0;
  for (const v of sorted) {
    if (v < value) below++;
    else if (v === value) ties++;
    else break;
  }
  return ((below + 0.5 * ties) / sorted.length) * 100;
}

/** One row pulled from iv_snapshots — strings coerced to numbers. */
interface SnapshotRow {
  snapshotDate: string;
  underlyingPrice: number | null;
  atmIv30d: number | null;
  atmIv60d: number | null;
  put25dIv30d: number | null;
  call25dIv30d: number | null;
  hv30d: number | null;
}

/** Read the last N daily snapshots for a ticker, newest first. */
async function loadHistory(
  ticker: string,
  daysBack: number,
): Promise<SnapshotRow[]> {
  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - daysBack);
  const cutoff = cutoffDate.toISOString().slice(0, 10);
  const rows = await db
    .select({
      snapshotDate: ivSnapshots.snapshotDate,
      underlyingPrice: ivSnapshots.underlyingPrice,
      atmIv30d: ivSnapshots.atmIv30d,
      atmIv60d: ivSnapshots.atmIv60d,
      put25dIv30d: ivSnapshots.put25dIv30d,
      call25dIv30d: ivSnapshots.call25dIv30d,
      hv30d: ivSnapshots.hv30d,
    })
    .from(ivSnapshots)
    .where(
      and(eq(ivSnapshots.ticker, ticker), gte(ivSnapshots.snapshotDate, cutoff)),
    )
    .orderBy(desc(ivSnapshots.snapshotDate));
  return rows.map((r) => ({
    snapshotDate: r.snapshotDate,
    underlyingPrice: r.underlyingPrice ? Number(r.underlyingPrice) : null,
    atmIv30d: r.atmIv30d ? Number(r.atmIv30d) : null,
    atmIv60d: r.atmIv60d ? Number(r.atmIv60d) : null,
    put25dIv30d: r.put25dIv30d ? Number(r.put25dIv30d) : null,
    call25dIv30d: r.call25dIv30d ? Number(r.call25dIv30d) : null,
    hv30d: r.hv30d ? Number(r.hv30d) : null,
  }));
}

/**
 * Suggested-trade copy library. The strategy you'd put on depends on the
 * anomaly direction AND the metric — selling a stretched put-call skew
 * is different from selling a stretched ATM IV. These strings are what
 * the routine surfaces in the published scan card.
 */
function suggestStrategy(
  metric: OptionsEdgeAnomaly["metric"],
  direction: "high" | "low",
): { strategy: string; thesis: string } {
  if (metric === "atm_iv_rank") {
    return direction === "high"
      ? {
          strategy: "Sell 30d short strangle or iron condor",
          thesis:
            "ATM IV is in the top decile of its 1-year range — historically reverts. Collect rich premium with a delta-neutral structure; manage tail with the iron condor wings.",
        }
      : {
          strategy: "Buy 30d ATM straddle or debit spread",
          thesis:
            "ATM IV is at the bottom of its 1-year range — vol is cheap. Long-gamma position cheaply expresses the view that realized vol mean-reverts up.",
        };
  }
  if (metric === "skew_z") {
    return direction === "high"
      ? {
          strategy: "Sell put spread / buy risk-reversal (short put, long call)",
          thesis:
            "25Δ put-call skew is unusually wide (puts expensive vs calls). Mean-reverts by either the put richening to fade or skew collapsing — both favor structures that are short puts and long calls.",
        }
      : {
          strategy: "Buy put spread / sell risk-reversal (long put, short call)",
          thesis:
            "25Δ put-call skew is unusually narrow — puts cheap relative to calls. Buy puts for downside protection at a discount, finance with rich calls.",
        };
  }
  if (metric === "term_z") {
    return direction === "high"
      ? {
          strategy: "Buy calendar spread (sell front, buy back month)",
          thesis:
            "Term structure unusually steep (contango wider than normal). Calendar long the cheap front decay against the rich back month — vega-positive without big directional bet.",
        }
      : {
          strategy: "Sell calendar / buy front-month vega",
          thesis:
            "Term structure inverted or flat — back month cheap vs front (often event-driven). Buy the underpriced back-month vol; let front-month event premium decay.",
        };
  }
  // iv_hv_ratio
  return direction === "high"
    ? {
        strategy: "Sell 30d premium (short strangle, iron condor)",
        thesis:
          "IV is unusually elevated vs the realized vol the underlying has actually printed. The variance risk premium is fat — short vol pays for the gap.",
      }
    : {
        strategy: "Buy 30d ATM gamma (long straddle or calendar)",
        thesis:
          "Realized vol is running hotter than IV is pricing — long gamma profits when actual moves outpace implied. Bookend with stops since negative VRP regimes can persist.",
      };
}

/** One ticker's analysis result. */
export interface TickerAnalysis {
  ticker: string;
  snapshotDate: string | null;
  underlyingPrice: number | null;
  /** History depth used. */
  observations: number;
  /** Surface values at the latest snapshot (current). */
  current: {
    atmIv30d: number | null;
    atmIv60d: number | null;
    put25dIv30d: number | null;
    call25dIv30d: number | null;
    hv30d: number | null;
    skew: number | null;          // put25 - call25
    termSlope: number | null;     // atm60 - atm30
    ivHvRatio: number | null;     // atm30 / hv30
  };
  /** Metric statistics + current z-score and percentile rank. */
  metrics: {
    atm_iv_rank: { z: number | null; percentile: number | null };
    skew_z: { z: number | null; percentile: number | null };
    term_z: { z: number | null; percentile: number | null };
    iv_hv_ratio: { z: number | null; percentile: number | null };
  };
  /** Anomalies the scanner would flag for THIS ticker. May be empty. */
  anomalies: OptionsEdgeAnomaly[];
}

/** Analyze one ticker against its own 1-year history. */
export async function analyzeTicker(ticker: string): Promise<TickerAnalysis> {
  const history = await loadHistory(ticker, 365);
  const observations = history.length;
  const empty: TickerAnalysis = {
    ticker,
    snapshotDate: null,
    underlyingPrice: null,
    observations,
    current: {
      atmIv30d: null, atmIv60d: null,
      put25dIv30d: null, call25dIv30d: null,
      hv30d: null, skew: null, termSlope: null, ivHvRatio: null,
    },
    metrics: {
      atm_iv_rank: { z: null, percentile: null },
      skew_z:      { z: null, percentile: null },
      term_z:      { z: null, percentile: null },
      iv_hv_ratio: { z: null, percentile: null },
    },
    anomalies: [],
  };
  if (observations === 0) return empty;

  const latest = history[0]; // newest first
  const current = {
    atmIv30d: latest.atmIv30d,
    atmIv60d: latest.atmIv60d,
    put25dIv30d: latest.put25dIv30d,
    call25dIv30d: latest.call25dIv30d,
    hv30d: latest.hv30d,
    skew:
      latest.put25dIv30d != null && latest.call25dIv30d != null
        ? latest.put25dIv30d - latest.call25dIv30d
        : null,
    termSlope:
      latest.atmIv60d != null && latest.atmIv30d != null
        ? latest.atmIv60d - latest.atmIv30d
        : null,
    ivHvRatio:
      latest.atmIv30d != null && latest.hv30d != null && latest.hv30d > 0
        ? latest.atmIv30d / latest.hv30d
        : null,
  };

  // Build the 1-year series for each metric (skipping the latest row so
  // the current value isn't double-counted in its own baseline).
  const olderHistory = history.slice(1);
  const atmIvSeries = olderHistory
    .map((r) => r.atmIv30d)
    .filter((v): v is number => v != null);
  const skewSeries = olderHistory
    .map((r) =>
      r.put25dIv30d != null && r.call25dIv30d != null
        ? r.put25dIv30d - r.call25dIv30d
        : null,
    )
    .filter((v): v is number => v != null);
  const termSeries = olderHistory
    .map((r) =>
      r.atmIv60d != null && r.atmIv30d != null ? r.atmIv60d - r.atmIv30d : null,
    )
    .filter((v): v is number => v != null);
  const ivHvSeries = olderHistory
    .map((r) =>
      r.atmIv30d != null && r.hv30d != null && r.hv30d > 0
        ? r.atmIv30d / r.hv30d
        : null,
    )
    .filter((v): v is number => v != null);

  const metric = (cur: number | null, series: number[]) => {
    if (cur == null || series.length < MIN_HISTORY) {
      return { z: null as number | null, percentile: null as number | null };
    }
    const s = stats(series);
    const z = s.std > 0 ? (cur - s.mean) / s.std : null;
    const p = percentileRank(cur, series);
    return { z, percentile: p };
  };

  const m = {
    atm_iv_rank: metric(current.atmIv30d, atmIvSeries),
    skew_z:      metric(current.skew, skewSeries),
    term_z:      metric(current.termSlope, termSeries),
    iv_hv_ratio: metric(current.ivHvRatio, ivHvSeries),
  };

  // Build anomaly entries when |z| crosses the threshold.
  const anomalies: OptionsEdgeAnomaly[] = [];
  const pushIfAnomaly = (
    name: OptionsEdgeAnomaly["metric"],
    z: number | null,
    pct: number | null,
    currentValue: number | null,
  ) => {
    if (z == null || pct == null || currentValue == null) return;
    if (Math.abs(z) < ANOMALY_THRESHOLD) return;
    const direction: "high" | "low" = z > 0 ? "high" : "low";
    const { strategy, thesis } = suggestStrategy(name, direction);
    anomalies.push({
      ticker,
      metric: name,
      currentValue,
      zScore: z,
      percentileRank: pct,
      direction,
      suggestedStrategy: strategy,
      thesis,
      surface: {
        atmIv30d: current.atmIv30d,
        put25dIv30d: current.put25dIv30d,
        call25dIv30d: current.call25dIv30d,
        hv30d: current.hv30d,
        underlyingPrice: latest.underlyingPrice,
      },
    });
  };

  pushIfAnomaly("atm_iv_rank", m.atm_iv_rank.z, m.atm_iv_rank.percentile, current.atmIv30d);
  pushIfAnomaly("skew_z", m.skew_z.z, m.skew_z.percentile, current.skew);
  pushIfAnomaly("term_z", m.term_z.z, m.term_z.percentile, current.termSlope);
  pushIfAnomaly("iv_hv_ratio", m.iv_hv_ratio.z, m.iv_hv_ratio.percentile, current.ivHvRatio);

  return {
    ticker,
    snapshotDate: latest.snapshotDate,
    underlyingPrice: latest.underlyingPrice,
    observations,
    current,
    metrics: m,
    anomalies,
  };
}

/** The canonical Options Edge watchlist (keep in sync with the backfill
 *  script + routine prompt). */
export const OPTIONS_EDGE_WATCHLIST = [
  "SPY", "QQQ", "IWM",
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA",
  "AMD", "INTC", "MU", "AVGO", "MRVL",
  "COIN", "MSTR", "GME", "PLTR", "NFLX",
  "BAC", "TLT", "GLD", "XLE", "XLF",
] as const;

export type OptionsEdgeTicker = (typeof OPTIONS_EDGE_WATCHLIST)[number];

/**
 * Run the full scan across the watchlist. Returns per-ticker analyses
 * plus a flat ranked anomaly list sorted by absolute z-score (most
 * extreme first).
 */
export async function scanOptionsEdgeUniverse(): Promise<{
  scanDate: string;
  byTicker: TickerAnalysis[];
  rankedAnomalies: OptionsEdgeAnomaly[];
  universeSize: number;
}> {
  const analyses = await Promise.all(
    OPTIONS_EDGE_WATCHLIST.map((t) => analyzeTicker(t)),
  );
  const rankedAnomalies = analyses
    .flatMap((a) => a.anomalies)
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
  return {
    scanDate: new Date().toISOString().slice(0, 10),
    byTicker: analyses,
    rankedAnomalies,
    universeSize: OPTIONS_EDGE_WATCHLIST.length,
  };
}

// Silence unused-import lint when sql isn't referenced in some build paths.
void sql;
