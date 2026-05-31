/**
 * Earnings-scan analyst layer.
 *
 * The backtest numbers (win rate, avg ROI, cycle count, sparkline) are
 * raw data. This module turns those numbers into PROSE — the kind of
 * one-line read a human analyst would write next to each row.
 *
 * Two outputs:
 *   1. classifyBacktest(stats) → per-row analyst note (5-15 words).
 *      Drives a small text label next to the backtest cell.
 *
 *   2. composeWeeklyRead(rows) → hero-box paragraph above the table.
 *      Picks the top STRONG candidates and writes 2-3 sentences naming
 *      the highest-conviction setup, a second pick if one stands out,
 *      and any deceptive-looking row to skip.
 *
 * The logic is deterministic — same inputs always yield the same prose.
 * No model calls. The categories match the help-page FAQ so users can
 * learn the rules.
 */

import type {
  EarningsBacktestCycle,
  EarningsBacktestStats,
} from "@/lib/db/schema";

export type AnalystTone = "positive" | "caution" | "negative" | "neutral";

export interface AnalystNote {
  /** 5-15 word read displayed next to the backtest cell. */
  text: string;
  /** Drives the chip color / icon. */
  tone: AnalystTone;
  /** Optional category key — used for telemetry and the help-page index. */
  category:
    | "best-of-week"
    | "thin-edge"
    | "asymmetric-tails"
    | "negative-edge"
    | "small-sample"
    | "single-cycle"
    | "mixed-signal"
    | "high-variance"
    | "reasonable-setup"
    | "no-data";
}

/** Per-cycle ROI summary used by both the row classifier and the
 *  asymmetry detector. */
function distributionStats(cycles: EarningsBacktestCycle[]): {
  winRois: number[];
  lossRois: number[];
  range: number;
  avgWin: number | null;
  avgLoss: number | null;
} {
  const priced = cycles
    .map((c) => c.roiPct)
    .filter((r): r is number => typeof r === "number");
  const winRois = priced.filter((r) => r > 0);
  const lossRois = priced.filter((r) => r <= 0);
  const range = priced.length > 0 ? Math.max(...priced) - Math.min(...priced) : 0;
  const avgWin =
    winRois.length > 0 ? winRois.reduce((s, x) => s + x, 0) / winRois.length : null;
  const avgLoss =
    lossRois.length > 0
      ? lossRois.reduce((s, x) => s + x, 0) / lossRois.length
      : null;
  return { winRois, lossRois, range, avgWin, avgLoss };
}

/**
 * Turn raw backtest stats into a one-line analyst read.
 *
 * Decision tree (top-to-bottom; first match wins):
 *   1. cyclesUsed = 0 — no data
 *   2. cyclesUsed = 1 — single cycle, informational only
 *   3. cyclesUsed 2-3 — WEAK tier; subdivide by win-rate optimism
 *   4. cyclesUsed ≥ 4 (STRONG):
 *        a. asymmetric tails (loss magnitude ≥ 2× win magnitude)
 *        b. negative expectancy
 *        c. high variance (cycle range > 60%)
 *        d. decisive positive (win ≥70% AND avgRoi ≥5%)
 *        e. thin edge (win ≥60% but avgRoi < 2%)
 *        f. mixed (everything else)
 */
export function classifyBacktest(
  stats: EarningsBacktestStats,
): AnalystNote {
  const { winRate, avgRoiPct, cyclesUsed, cycles } = stats;

  if (cyclesUsed === 0) {
    return {
      text: "No historical cycles to price — V1 score only.",
      tone: "neutral",
      category: "no-data",
    };
  }
  if (cyclesUsed === 1) {
    return {
      text: "Single cycle — informational only, can't generalize.",
      tone: "neutral",
      category: "single-cycle",
    };
  }
  if (cyclesUsed <= 3) {
    if (winRate != null && winRate >= 0.99) {
      return {
        text: `Small sample — ${cyclesUsed}-for-${cyclesUsed} is statistically meaningless.`,
        tone: "caution",
        category: "small-sample",
      };
    }
    return {
      text: `Sample too small (${cyclesUsed} cycles) to commit capital.`,
      tone: "caution",
      category: "small-sample",
    };
  }

  // STRONG tier from here down (≥4 cycles).
  const dist = distributionStats(cycles);

  // Asymmetric tails: typical loss eats multiple typical wins. This is
  // the "looks fine on win rate, disaster waiting to happen" pattern.
  if (
    dist.avgWin != null &&
    dist.avgLoss != null &&
    dist.avgLoss < 0 &&
    Math.abs(dist.avgLoss) >= dist.avgWin * 2
  ) {
    return {
      text: `Asymmetric — typical loss (${dist.avgLoss.toFixed(0)}%) wipes ${Math.round(Math.abs(dist.avgLoss) / Math.max(dist.avgWin, 0.1))}+ wins.`,
      tone: "caution",
      category: "asymmetric-tails",
    };
  }

  // Negative edge.
  if (avgRoiPct != null && avgRoiPct < 0) {
    return {
      text: `Negative edge — strategy lost ${Math.abs(avgRoiPct).toFixed(0)}% on average across ${cyclesUsed} cycles.`,
      tone: "negative",
      category: "negative-edge",
    };
  }

  // High variance — sparkline boom/bust.
  if (dist.range > 60) {
    return {
      text: `High variance (${dist.range.toFixed(0)}% range) — boom/bust pattern, size small.`,
      tone: "caution",
      category: "high-variance",
    };
  }

  // Decisive positive setup.
  if (winRate != null && winRate >= 0.7 && avgRoiPct != null && avgRoiPct >= 5) {
    return {
      text: `Decisive wins, positive edge — ${(winRate * 100).toFixed(0)}% × +${avgRoiPct.toFixed(0)}% avg.`,
      tone: "positive",
      category: "best-of-week",
    };
  }

  // Thin edge — win rate looks good, expected value doesn't.
  if (winRate != null && winRate >= 0.6 && avgRoiPct != null && avgRoiPct < 2) {
    return {
      text: `Strong win rate but thin edge — single loss erases multiple wins.`,
      tone: "caution",
      category: "thin-edge",
    };
  }

  // Reasonable but not exceptional.
  if (winRate != null && winRate >= 0.5 && avgRoiPct != null && avgRoiPct >= 2) {
    return {
      text: `Reasonable setup — moderate edge (${(winRate * 100).toFixed(0)}% × +${avgRoiPct.toFixed(0)}%).`,
      tone: "positive",
      category: "reasonable-setup",
    };
  }

  return {
    text: `Mixed signal — read the sparkline before trading.`,
    tone: "neutral",
    category: "mixed-signal",
  };
}

// ---------------------------------------------------------------------------
// Weekly read — top-of-tab hero box prose
// ---------------------------------------------------------------------------

export interface WeeklyReadInput {
  symbol: string;
  stats: EarningsBacktestStats;
}

export interface WeeklyRead {
  paragraph: string;
  /** Symbols mentioned in order — useful for highlighting rows. */
  highlighted: string[];
}

/**
 * Composite score for picking the "best" candidate.
 * winRate × avgRoi × √(cyclesUsed) — rewards both quality and sample size.
 * Negative win rates × negative ROI would be positive, which is wrong;
 * we floor at zero so only winning setups can be "best of week."
 */
function pickScore(stats: EarningsBacktestStats): number {
  const wr = stats.winRate ?? 0;
  const roi = stats.avgRoiPct ?? 0;
  if (wr <= 0 || roi <= 0) return 0;
  return wr * roi * Math.sqrt(stats.cyclesUsed);
}

/**
 * Compose the top-of-tab paragraph. Picks at most 3 names to mention:
 *   1. The top-scored STRONG-tier ticker → "highest-conviction setup"
 *   2. A second STRONG-tier with positive edge → "pairs well as a second leg"
 *   3. Any STRONG-tier with asymmetric / negative / thin-edge note → "skip"
 *
 * Returns null when zero STRONG-tier rows exist (the existing
 * BacktestSignalBanner already handles that empty-week case).
 */
export function composeWeeklyRead(
  rows: WeeklyReadInput[],
  strategyLabel: "Straddle" | "Condor",
): WeeklyRead | null {
  const strong = rows.filter((r) => r.stats.cyclesUsed >= 4);
  if (strong.length === 0) return null;

  // Best — highest pickScore (winRate × avgRoi × √sample).
  const best = [...strong].sort((a, b) => pickScore(b.stats) - pickScore(a.stats))[0];
  if (pickScore(best.stats) <= 0) {
    // No setup with both positive win rate AND positive avg ROI. Don't
    // synthesize an emerald hero box — let the table speak for itself.
    return null;
  }

  // Second pick — next highest non-overlapping with positive edge.
  const second = strong
    .filter((r) => r.symbol !== best.symbol)
    .sort((a, b) => pickScore(b.stats) - pickScore(a.stats))[0];
  const secondIsActionable =
    second != null &&
    pickScore(second.stats) > 0 &&
    pickScore(second.stats) >= pickScore(best.stats) * 0.5;

  // Trap — a STRONG row whose classifier flagged it as misleading.
  const trap = strong
    .filter((r) => r.symbol !== best.symbol)
    .find((r) => {
      const note = classifyBacktest(r.stats);
      return (
        note.category === "thin-edge" ||
        note.category === "asymmetric-tails" ||
        note.category === "negative-edge"
      );
    });

  const bestPctWin = ((best.stats.winRate ?? 0) * 100).toFixed(0);
  const bestRoi = (best.stats.avgRoiPct ?? 0).toFixed(0);

  let p = `${best.symbol} is the highest-conviction ${strategyLabel} setup this week — ${bestPctWin}% win rate across ${best.stats.cyclesUsed} priced cycles with ${(best.stats.avgRoiPct ?? 0) >= 0 ? "+" : ""}${bestRoi}% avg ROI.`;

  const highlighted = [best.symbol];

  if (secondIsActionable && second) {
    const secWr = ((second.stats.winRate ?? 0) * 100).toFixed(0);
    const secRoi = (second.stats.avgRoiPct ?? 0).toFixed(0);
    p += ` ${second.symbol} pairs well as a second leg (${secWr}% × ${(second.stats.avgRoiPct ?? 0) >= 0 ? "+" : ""}${secRoi}%).`;
    highlighted.push(second.symbol);
  }

  if (trap && trap.symbol !== best.symbol && trap.symbol !== second?.symbol) {
    const trapNote = classifyBacktest(trap.stats);
    if (trapNote.category === "thin-edge") {
      p += ` ${trap.symbol}'s win rate looks fine but the expectancy is thin — single big loss erases multiple wins; pass.`;
    } else if (trapNote.category === "asymmetric-tails") {
      p += ` ${trap.symbol}'s sample looks clean but the typical loss outsizes the typical win; skip.`;
    } else {
      p += ` ${trap.symbol} has negative historical edge despite the V1 score; skip.`;
    }
    highlighted.push(trap.symbol);
  }

  return { paragraph: p, highlighted };
}
