/**
 * ALMA (Arnaud Legoux Moving Average) computation + supporting analytics.
 *
 * ALMA is a Gaussian-weighted moving average that puts more weight on prices
 * near the *offset* position of the window, controlled by `sigma` (how
 * concentrated the weighting is around that point).
 *
 *   m = offset * (length - 1)
 *   s = length / sigma
 *   w[i] = exp(-(i - m)² / (2 s²))
 *   ALMA = Σ(price[i] * w[i]) / Σ(w[i])
 *
 * With our default settings (length=9, sigma=6, offset=0.85) the weights
 * concentrate near the most recent bar (i ≈ 6.8 out of 0..8), which makes
 * ALMA(9, 6, 0.85) reactive but smoother than a simple EMA(9).
 *
 * All functions are pure — no I/O. Callers pass close arrays and get
 * deterministic outputs back.
 */

export type AlmaParams = {
  length?: number;
  sigma?: number;
  offset?: number;
};

const DEFAULT_PARAMS: Required<AlmaParams> = { length: 9, sigma: 6, offset: 0.85 };

/**
 * Compute a single ALMA value over the window `closes[end - length + 1 .. end]`.
 * Returns null when the window doesn't have enough bars.
 *
 * `endIndex` is INCLUSIVE — pass `closes.length - 1` for "current bar."
 */
export function computeAlmaAt(
  closes: readonly number[],
  endIndex: number,
  params?: AlmaParams,
): number | null {
  const { length, sigma, offset } = { ...DEFAULT_PARAMS, ...params };
  if (endIndex < length - 1) return null;
  if (endIndex >= closes.length) return null;

  const m = offset * (length - 1);
  const s = length / sigma;
  const twoSSquared = 2 * s * s;

  let valueSum = 0;
  let weightSum = 0;
  for (let i = 0; i < length; i++) {
    const price = closes[endIndex - (length - 1) + i];
    if (!Number.isFinite(price)) return null;
    const dx = i - m;
    const w = Math.exp(-(dx * dx) / twoSSquared);
    valueSum += price * w;
    weightSum += w;
  }
  if (weightSum === 0) return null;
  return valueSum / weightSum;
}

/**
 * Compute ALMA for every bar where the window fits. Returns an array aligned
 * with `closes`, with null for indices < length - 1.
 */
export function computeAlmaSeries(
  closes: readonly number[],
  params?: AlmaParams,
): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    out[i] = computeAlmaAt(closes, i, params);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cross + slope detection on top of ALMA values
// ---------------------------------------------------------------------------

export type CrossSide = "above" | "below";

/**
 * "Did the relation between `alma` and `vwap` flip from one bar to the next?"
 *
 *   prev above, curr below → returned "below" (just crossed down)
 *   prev below, curr above → returned "above" (just crossed up)
 *   no flip → null
 *
 * Equal values (alma == vwap) on either bar are treated as "no signal"
 * conservatively (return null) — we want unambiguous crosses, not touches.
 */
export function detectCross(
  prevAlma: number,
  prevVwap: number,
  currAlma: number,
  currVwap: number,
): CrossSide | null {
  const eps = 1e-9;
  const prevDelta = prevAlma - prevVwap;
  const currDelta = currAlma - currVwap;
  if (Math.abs(prevDelta) < eps || Math.abs(currDelta) < eps) return null;
  if (prevDelta < 0 && currDelta > 0) return "above";
  if (prevDelta > 0 && currDelta < 0) return "below";
  return null;
}

/**
 * Slope as percent change of ALMA between two consecutive bars (curr - prev).
 * Positive = ALMA rising. Sign of `crossSide` determines whether this slope
 * counts as "steep" in the direction we care about.
 */
export function slopePctPerBar(prevAlma: number, currAlma: number): number {
  if (!Number.isFinite(prevAlma) || !Number.isFinite(currAlma) || prevAlma === 0) return 0;
  return ((currAlma - prevAlma) / prevAlma) * 100;
}

/**
 * "Is the ALMA slope steep enough in the direction of the cross?"
 *
 *   cross="above" → require slope ≥ +threshold (rising fast)
 *   cross="below" → require slope ≤ -threshold (falling fast)
 *
 * `thresholdPct` is the same scale as `slopePctPerBar` returns — 0.05 means
 * 0.05% per bar, the default in `bot_config.alma_steep_slope_pct`.
 */
export function isSteepInDirection(
  slopePct: number,
  cross: CrossSide,
  thresholdPct: number,
): boolean {
  if (!Number.isFinite(thresholdPct) || thresholdPct <= 0) return true; // 0 disables the check
  if (cross === "above") return slopePct >= thresholdPct;
  return slopePct <= -thresholdPct;
}

// ---------------------------------------------------------------------------
// Pullback detection
// ---------------------------------------------------------------------------

/**
 * Did the most recent bar pull back to ALMA in a way that confirms entry?
 *
 *   LONG (side="long"):  bar.low ≤ alma  AND  bar.close > vwap   (close holds the cross)
 *   SHORT (side="short"): bar.high ≥ alma AND bar.close < vwap   (close holds the cross)
 *
 * The "close holds" guard prevents firing on a bar that pulled to ALMA but
 * then closed back through VWAP — those are the false setups.
 */
/**
 * "Did ALMA × VWAP just cross AGAINST the position's side?"
 *
 * Helper for the optional ALMA-reversal exit filter. Takes the side of the
 * open position and the closed-bar history we computed locally; returns
 * true when the most recent closed bar shows ALMA crossing TO THE WRONG
 * SIDE of VWAP.
 *
 *   LONG  → cross "below"  → reversal
 *   SHORT → cross "above"  → reversal
 *
 * The cross detection itself reuses `detectCross`; this function just maps
 * trade side to the reversal direction.
 */
export function isAlmaReversal(args: {
  side: "long" | "short";
  prevAlma: number;
  prevVwap: number;
  currAlma: number;
  currVwap: number;
}): boolean {
  const { side, prevAlma, prevVwap, currAlma, currVwap } = args;
  const cross = detectCross(prevAlma, prevVwap, currAlma, currVwap);
  if (!cross) return false;
  if (side === "long") return cross === "below";
  return cross === "above";
}

/**
 * Pullback detection.
 *
 *   LONG  → wick reached ALMA from above (bar.low ≤ ALMA) AND didn't dip
 *           more than `thresholdPct` below ALMA. Above the threshold floor,
 *           we treat the move as a real reversal, not a buyable dip.
 *   SHORT → wick reached ALMA from below (bar.high ≥ ALMA) AND didn't rise
 *           more than `thresholdPct` above ALMA.
 *
 * When `requireCloseHolds=true`, additionally require `bar.close > vwap`
 * (long) / `bar.close < vwap` (short). The cool-down logic in the live
 * strategy passes `false` for bars inside the protective window — see
 * `processAlmaTicker` for the orchestration.
 */
export function isPullback(args: {
  side: "long" | "short";
  bar: { high: number; low: number; close: number };
  alma: number;
  vwap: number;
  /** Max wick depth beyond ALMA, % of ALMA. 0 = wick must stop at ALMA exactly. */
  thresholdPct?: number;
  /** Whether to require close on the right side of VWAP. Default true. */
  requireCloseHolds?: boolean;
}): boolean {
  const { side, bar, alma, vwap } = args;
  const thresholdPct = args.thresholdPct ?? 0;
  const requireCloseHolds = args.requireCloseHolds ?? true;
  if (!Number.isFinite(alma) || !Number.isFinite(vwap)) return false;
  const bandWidth = alma * (Math.max(0, thresholdPct) / 100);
  if (side === "long") {
    const wickReached = bar.low <= alma;
    const notTooDeep = bar.low >= alma - bandWidth;
    const closeOk = requireCloseHolds ? bar.close > vwap : true;
    return wickReached && notTooDeep && closeOk;
  }
  const wickReached = bar.high >= alma;
  const notTooHigh = bar.high <= alma + bandWidth;
  const closeOk = requireCloseHolds ? bar.close < vwap : true;
  return wickReached && notTooHigh && closeOk;
}
