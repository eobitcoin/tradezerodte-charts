/**
 * Aggregate metrics for a backtest run.
 *
 * Hit-rate model is intentionally simple: "touched the OTM strike before
 * close ≈ option had intrinsic value at expiry." A touch isn't a fair P&L
 * proxy (you'd still need premium + path-dependence to compute $) but it
 * IS a fair *directional* signal of strategy fitness:
 *   - high touch rate → ALMA × VWAP is picking real directional setups
 *   - low touch rate → the signal is noise, no amount of sizing fixes it
 */

import type { BacktestSignal } from "./replay";

export type BacktestSummary = {
  totalSignals: number;
  longSignals: number;
  shortSignals: number;
  /** Fraction (0..1) of signals where the OTM strike was touched before close. */
  hitRate: number;
  longHitRate: number;
  shortHitRate: number;
  /** Average max favourable excursion (% of underlying) across all signals. */
  avgFavorablePct: number;
  /** Average max adverse excursion (% of underlying) across all signals. */
  avgAdversePct: number;
  /** Average time-to-touch (minutes) among signals that touched. null when none touched. */
  avgTimeToTouchMin: number | null;
  /** Per-ticker breakdown for quick filtering. */
  byTicker: Array<{
    ticker: string;
    n: number;
    hits: number;
    hitRate: number;
    avgFavorablePct: number;
    avgAdversePct: number;
  }>;
  /**
   * Exit-policy outcomes — present only when each signal has a `policy` block.
   * win = exit > 0, loss = exit < 0. expectedRPerTrade = avg net P&L per trade.
   */
  policy: {
    /** Configured exit policy (echoed for clarity). */
    params: {
      target1Pct: number;
      target2Pct: number | null;
      stopLossPct: number;
      timeStopMin: number;
      leverageMultiplier: number;
    };
    winRate: number;             // 0..1
    avgWinPct: number;           // average P&L % of winning trades
    avgLossPct: number;          // average P&L % of losing trades (negative)
    expectedPnlPctPerTrade: number;  // simple mean P&L %
    /** % of trades that hit Target1 before any other exit. */
    target1Rate: number;
    target2Rate: number;         // % whose forward window ever touched target2
    stopLossRate: number;
    timeStopRate: number;
    endOfDayRate: number;
    /** Sharpe-ish: expectedPnl / std(pnl). null when std == 0. */
    sharpe: number | null;
  } | null;
};

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function summarize(
  signals: BacktestSignal[],
  policyParams?: {
    target1Pct: number;
    target2Pct: number | null;
    stopLossPct: number;
    timeStopMin: number;
    leverageMultiplier: number;
  },
): BacktestSummary {
  const total = signals.length;
  const longs = signals.filter((s) => s.side === "long");
  const shorts = signals.filter((s) => s.side === "short");
  const hits = signals.filter((s) => s.touched);
  const longHits = longs.filter((s) => s.touched).length;
  const shortHits = shorts.filter((s) => s.touched).length;
  const touchTimes = hits
    .map((s) => s.timeToTouchMin)
    .filter((v): v is number => v != null);

  // Per-ticker breakdown.
  const tickers = Array.from(new Set(signals.map((s) => s.ticker))).sort();
  const byTicker = tickers.map((ticker) => {
    const subset = signals.filter((s) => s.ticker === ticker);
    const hitN = subset.filter((s) => s.touched).length;
    return {
      ticker,
      n: subset.length,
      hits: hitN,
      hitRate: subset.length ? hitN / subset.length : 0,
      avgFavorablePct: round(avg(subset.map((s) => s.maxFavorablePct)), 3),
      avgAdversePct: round(avg(subset.map((s) => s.maxAdversePct)), 3),
    };
  });

  // Exit-policy aggregation (skip when params or per-signal policy missing).
  const withPolicy = signals.filter((s) => s.policy != null);
  let policy: BacktestSummary["policy"] = null;
  if (policyParams && withPolicy.length > 0) {
    const pnls = withPolicy.map((s) => s.policy!.optionPnlPct);
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p < 0);
    const reasonCount = (r: string) =>
      withPolicy.filter((s) => s.policy!.exitReason === r).length;
    const mean = avg(pnls);
    const variance = pnls.length > 1
      ? pnls.reduce((acc, p) => acc + (p - mean) ** 2, 0) / (pnls.length - 1)
      : 0;
    const std = Math.sqrt(variance);
    policy = {
      params: policyParams,
      winRate: round(wins.length / withPolicy.length, 4),
      avgWinPct: wins.length ? round(avg(wins), 2) : 0,
      avgLossPct: losses.length ? round(avg(losses), 2) : 0,
      expectedPnlPctPerTrade: round(mean, 2),
      target1Rate: round(reasonCount("target1") / withPolicy.length, 4),
      target2Rate: round(
        withPolicy.filter((s) => s.policy!.hitTarget2).length / withPolicy.length,
        4,
      ),
      stopLossRate: round(reasonCount("stop_loss") / withPolicy.length, 4),
      timeStopRate: round(reasonCount("time_stop") / withPolicy.length, 4),
      endOfDayRate: round(reasonCount("end_of_day") / withPolicy.length, 4),
      sharpe: std > 0 ? round(mean / std, 3) : null,
    };
  }

  return {
    totalSignals: total,
    longSignals: longs.length,
    shortSignals: shorts.length,
    hitRate: total ? hits.length / total : 0,
    longHitRate: longs.length ? longHits / longs.length : 0,
    shortHitRate: shorts.length ? shortHits / shorts.length : 0,
    avgFavorablePct: round(avg(signals.map((s) => s.maxFavorablePct)), 3),
    avgAdversePct: round(avg(signals.map((s) => s.maxAdversePct)), 3),
    avgTimeToTouchMin: touchTimes.length ? round(avg(touchTimes), 1) : null,
    byTicker,
    policy,
  };
}

function round(x: number, places: number): number {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}
