/**
 * Black-Scholes pricing + Greeks for European-style equity/ETF options.
 *
 * No external dependency — uses Abramowitz & Stegun polynomial
 * approximations for the standard-normal CDF (accurate to ~1e-7,
 * way better than we need for risk-graph rendering).
 *
 * Conventions:
 *   - All inputs are floats. Strike, spot in dollars.
 *   - σ (sigma) is annualized volatility as a decimal (0.30 = 30%).
 *   - T is time to expiration in YEARS (calendar, not trading).
 *   - r is the annualized risk-free rate as a decimal (0.05 = 5%).
 *     Default 4% — close enough to current SOFR; user can override.
 *   - Greeks returned in the conventional units traders expect:
 *       delta: per $1 underlying move      (-1 .. +1)
 *       gamma: delta change per $1 move    (positive for long options)
 *       vega:  P&L per +1% IV move (NOT per +1.00) — divided by 100
 *       theta: P&L per CALENDAR day        (divided by 365)
 *
 * For dividends: optional q (continuous dividend yield). Default 0.
 * Most short-dated equity options can ignore q; LEAPs on dividend
 * payers may want it. The risk-graph UI doesn't expose this — we
 * just pass 0.
 */

const DEFAULT_R = 0.04;

// ---------------------------------------------------------------------------
// Normal CDF — Abramowitz & Stegun 7.1.26 approximation.
// ---------------------------------------------------------------------------

const A = [
  0.254829592,
  -0.284496736,
  1.421413741,
  -1.453152027,
  1.061405429,
];
const P_ERF = 0.3275911;

/** Standard normal CDF. */
export function normalCdf(x: number): number {
  // erf approximation, then convert to CDF.
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + P_ERF * ax);
  const y =
    1 -
    (((((A[4] * t + A[3]) * t) + A[2]) * t + A[1]) * t + A[0]) *
      t *
      Math.exp(-ax * ax);
  const erf = sign * y;
  return 0.5 * (1 + erf);
}

/** Standard normal PDF. */
export function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// ---------------------------------------------------------------------------
// Pricing + Greeks.
// ---------------------------------------------------------------------------

export interface BlackScholesParams {
  /** Underlying spot price. */
  S: number;
  /** Strike. */
  K: number;
  /** Time to expiration in YEARS. */
  T: number;
  /** Annualized implied vol as decimal (0.30 = 30%). */
  sigma: number;
  /** Risk-free rate (default 4%). */
  r?: number;
  /** Continuous dividend yield (default 0). */
  q?: number;
}

export interface OptionPricing {
  price: number;
  delta: number;
  gamma: number;
  /** Per +1% IV move (divided by 100). */
  vega: number;
  /** Per +1 calendar day (divided by 365). */
  theta: number;
}

/**
 * Pure intrinsic value — used for expiry-payoff curves and as a
 * guard when T → 0 (Black-Scholes blows up at T = 0).
 */
export function intrinsic(type: "call" | "put", S: number, K: number): number {
  if (type === "call") return Math.max(0, S - K);
  return Math.max(0, K - S);
}

/**
 * Price + greeks for one option. Handles edge cases:
 *   - T ≤ 0: returns intrinsic with zero greeks (positions at/past expiry).
 *   - sigma ≤ 0: also returns intrinsic (degenerate; happens if user
 *     drags IV slider to zero).
 *   - S ≤ 0 or K ≤ 0: returns zero (defensive — shouldn't happen).
 */
export function bsPriceGreeks(
  type: "call" | "put",
  params: BlackScholesParams,
): OptionPricing {
  const { S, K, T, sigma } = params;
  const r = params.r ?? DEFAULT_R;
  const q = params.q ?? 0;

  if (S <= 0 || K <= 0) {
    return { price: 0, delta: 0, gamma: 0, vega: 0, theta: 0 };
  }
  if (T <= 0 || sigma <= 0) {
    const px = intrinsic(type, S, K);
    return { price: px, delta: 0, gamma: 0, vega: 0, theta: 0 };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const nd1 = normalCdf(d1);
  const nd2 = normalCdf(d2);
  const nmd1 = normalCdf(-d1);
  const nmd2 = normalCdf(-d2);
  const pd1 = normalPdf(d1);

  const discount = Math.exp(-r * T);
  const divDiscount = Math.exp(-q * T);

  let price: number;
  let delta: number;
  let thetaAnnual: number;

  if (type === "call") {
    price = S * divDiscount * nd1 - K * discount * nd2;
    delta = divDiscount * nd1;
    thetaAnnual =
      -(S * divDiscount * pd1 * sigma) / (2 * sqrtT) -
      r * K * discount * nd2 +
      q * S * divDiscount * nd1;
  } else {
    price = K * discount * nmd2 - S * divDiscount * nmd1;
    delta = -divDiscount * nmd1;
    thetaAnnual =
      -(S * divDiscount * pd1 * sigma) / (2 * sqrtT) +
      r * K * discount * nmd2 -
      q * S * divDiscount * nmd1;
  }

  const gamma = (divDiscount * pd1) / (S * sigma * sqrtT);
  // Vega is per +1 unit of sigma in the formula; divide by 100 so the
  // returned number is per +1% IV move (the trader convention).
  const vega = (S * divDiscount * pd1 * sqrtT) / 100;
  // Theta is per year; divide by 365 for per calendar day.
  const theta = thetaAnnual / 365;

  return { price, delta, gamma, vega, theta };
}

/**
 * Implied volatility from market price via Brent's method.
 * Brackets [1e-4, 5.0] (0.01% to 500%). Converges in <50 iters.
 * Returns null if no root in range (deep ITM/OTM puts can hit this).
 *
 * Used by the risk-graph builder when the user wants to imply vol
 * from a contract's market price instead of using Polygon's reported
 * IV (which can be stale on illiquid LEAPs).
 */
export function impliedVolatility(
  type: "call" | "put",
  marketPrice: number,
  params: Omit<BlackScholesParams, "sigma">,
): number | null {
  const intr = intrinsic(type, params.S, params.K);
  if (marketPrice <= intr) return null; // below intrinsic → no positive vol

  const f = (sigma: number): number =>
    bsPriceGreeks(type, { ...params, sigma }).price - marketPrice;

  let lo = 1e-4;
  let hi = 5.0;
  let fLo = f(lo);
  let fHi = f(hi);
  if (fLo * fHi > 0) return null;

  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const fMid = f(mid);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (fMid * fLo < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}
