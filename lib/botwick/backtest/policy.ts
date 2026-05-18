/**
 * Exit-policy simulator for backtest P&L estimation.
 *
 * The replay engine emits one signal per ticker × day with the forward bars
 * available after the entry. This module walks those bars and applies the
 * configured exit policy (target1 / stop_loss / time_stop / end-of-day) to
 * estimate option P&L %.
 *
 * Why a multiplier instead of a Black-Scholes premium model:
 *   For 0DTE nearest-OTM contracts, option % move ≈ underlying % move ×
 *   `leverageMultiplier`. The multiplier captures the joint effect of delta
 *   (~0.4 at entry) and the fact that the OTM premium is a small fraction
 *   of the strike. Empirically this lands at ~40–80× for SPY/QQQ 0DTE; we
 *   default to 50 and expose it in the UI so the user can re-run sensitivity.
 *
 * Conservative bar ordering: within a single 5-min bar we don't know whether
 * the high or the low printed first, so we resolve adverse moves BEFORE
 * favorable. That is the worst case for the strategy — if a bar's range
 * straddles both a stop and a target, we attribute the stop. Real life is
 * 50/50, so reported win rate tends to slightly understate actual edge.
 */
import type { TradierBar } from "../tradier-adapter";

export type ExitReason =
  | "target1"
  | "target2"
  | "stop_loss"
  | "time_stop"
  | "end_of_day";

export type PolicyParams = {
  /** Target 1 (% of position premium / share price). e.g. 50 = exit at +50%. */
  target1Pct: number;
  /** Optional Target 2. If null, target2 is ignored and target1 = full exit. */
  target2Pct: number | null;
  /** Stop loss (%, positive number). e.g. 50 = exit at -50%. */
  stopLossPct: number;
  /** Time stop in minutes from entry. */
  timeStopMin: number;
  /** Underlying-% to position-% multiplier. For options ~50 (0DTE OTM);
   *  for stocks the simulator forces it to 1 regardless of this value. */
  leverageMultiplier: number;
  /**
   * Optional instrument override. Defaults to "options" for backward
   * compatibility. Any stock_* value forces the simulator to use a 1×
   * leverage multiplier — target/stop %s are interpreted on the underlying
   * directly (no theta, no premium amplification). The short variants
   * differ only at the order layer; the P&L simulation is identical
   * because `side` already handles direction.
   */
  instrument?: "options" | "stock_long" | "stock_short" | "stock_both";
};

export type PolicyResult = {
  exitReason: ExitReason;
  /** Minutes from entry to exit. */
  exitMinutes: number;
  /** Estimated option P&L %, signed. e.g. +50, -50, -22 (time stop). */
  optionPnlPct: number;
  /** Did target2 ever get hit at any point in the forward window? (info only) */
  hitTarget2: boolean;
};

type EntryContext = {
  /** Underlying close at entry (bar of signal fire). */
  entryPrice: number;
  /** Side of the trade. */
  side: "long" | "short";
  /** Forward bars (5-min) AFTER the entry bar. */
  forwardBars: TradierBar[];
};

/**
 * Walk forward bars, return the first exit branch that triggers.
 * If no exit fires before the bars run out, returns end_of_day at the last
 * bar's close-derived mark.
 */
export function simulatePolicy(ctx: EntryContext, p: PolicyParams): PolicyResult {
  const { entryPrice, side, forwardBars } = ctx;
  const sign = side === "long" ? 1 : -1;
  // Stock mode (any direction) = linear share P&L; no leverage, no premium.
  const isStockMode =
    p.instrument === "stock_long" ||
    p.instrument === "stock_short" ||
    p.instrument === "stock_both";
  const mult = isStockMode ? 1 : p.leverageMultiplier;

  let hitTarget2 = false;

  for (let i = 0; i < forwardBars.length; i++) {
    const b = forwardBars[i];
    const elapsed = (i + 1) * 5;

    // Worst underlying excursion this bar (favorable / adverse).
    const favUnderPct = side === "long"
      ? ((b.high - entryPrice) / entryPrice) * 100
      : ((entryPrice - b.low) / entryPrice) * 100;
    const advUnderPct = side === "long"
      ? ((b.low - entryPrice) / entryPrice) * 100      // negative
      : ((entryPrice - b.high) / entryPrice) * 100;    // negative

    const favOptPct = favUnderPct * mult;
    const advOptPct = advUnderPct * mult;              // negative

    // 1. Stop loss has priority within the bar (conservative).
    if (advOptPct <= -p.stopLossPct) {
      return {
        exitReason: "stop_loss",
        exitMinutes: elapsed,
        optionPnlPct: -p.stopLossPct,
        hitTarget2,
      };
    }

    // 2. Target 1.
    if (favOptPct >= p.target1Pct) {
      // Did this same bar also push to target2? Mark it for info.
      if (p.target2Pct != null && favOptPct >= p.target2Pct) hitTarget2 = true;
      return {
        exitReason: "target1",
        exitMinutes: elapsed,
        optionPnlPct: p.target1Pct,
        hitTarget2,
      };
    }

    // 3. Track target2 touch for the info column even if we'd already have
    //    exited at target1 (this captures the "would the runner have paid"
    //    answer the user usually wants).
    if (p.target2Pct != null && favOptPct >= p.target2Pct) hitTarget2 = true;

    // 4. Time stop after this bar?
    if (elapsed >= p.timeStopMin) {
      const closePct = side === "long"
        ? ((b.close - entryPrice) / entryPrice) * 100 * mult
        : ((entryPrice - b.close) / entryPrice) * 100 * mult;
      return {
        exitReason: "time_stop",
        exitMinutes: elapsed,
        optionPnlPct: round(closePct, 2),
        hitTarget2,
      };
    }
  }

  // End of day — exit at last bar's close.
  if (forwardBars.length === 0) {
    return { exitReason: "end_of_day", exitMinutes: 0, optionPnlPct: 0, hitTarget2 };
  }
  const lastBar = forwardBars[forwardBars.length - 1];
  const closePct = side === "long"
    ? ((lastBar.close - entryPrice) / entryPrice) * 100 * mult
    : ((entryPrice - lastBar.close) / entryPrice) * 100 * mult;
  void sign; // keep `sign` referenced (kept for clarity above)
  return {
    exitReason: "end_of_day",
    exitMinutes: forwardBars.length * 5,
    optionPnlPct: round(closePct, 2),
    hitTarget2,
  };
}

function round(x: number, places: number): number {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}
