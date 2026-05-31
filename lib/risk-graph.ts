/**
 * Risk-graph computation for multi-leg option positions.
 *
 * Given a list of legs (each with type/strike/expiry/qty/side/entry-IV),
 * computes:
 *   - the P&L grid across (underlying price × time-to-expiry × IV-shift)
 *   - per-leg pricing at each grid point
 *   - headline stats (max profit, max risk, breakevens, ROI)
 *   - combined Greeks (sum across legs at current spot)
 *
 * Math is all client-evaluable (lib/black-scholes), so the UI can
 * re-render on slider movement without a server round-trip.
 *
 * Sign convention for P&L:
 *   - Buy (side = "long"): you pay the premium; P&L = current_value − entry_debit
 *   - Sell (side = "short"): you receive premium; P&L = entry_credit − current_value
 *   Combined across legs: sum of per-leg P&L.
 *   Each leg's qty is positive; side carries the direction.
 *
 * Contract multiplier: 100 shares per option contract. All dollar
 * quantities returned here are PER POSITION (qty × multiplier).
 */

import { bsPriceGreeks, intrinsic } from "@/lib/black-scholes";

export interface Leg {
  /** "call" or "put" */
  type: "call" | "put";
  /** "long" = bought (pays premium), "short" = sold (receives premium). */
  side: "long" | "short";
  /** Strike in dollars. */
  strike: number;
  /** Expiration ISO date (YYYY-MM-DD). */
  expiration: string;
  /** Number of contracts (positive integer). */
  qty: number;
  /** Entry price per share (mid of bid/ask at construction time). */
  entryPrice: number;
  /** Entry IV at construction time (decimal — 0.30 = 30%). */
  entryIv: number;
}

export interface GridConfig {
  /** Underlying spot at construction time. */
  spot: number;
  /** Today's date — ISO. Used to compute DTE per leg. */
  asOf: string;
  /** Number of price points on the x-axis (default 81). */
  pricePoints?: number;
  /** Price range as % of spot (default ±30% → 0.7×spot to 1.3×spot). */
  priceRangePct?: number;
  /** Risk-free rate (default 4%). */
  r?: number;
  /** IV shift to apply (decimal — +0.10 = +10% IV, additive to each
   *  leg's entry IV). Default 0. */
  ivShift?: number;
}

export interface RiskCurvePoint {
  underlying: number;
  /** P&L total at this underlying price + this DTE snapshot. */
  pnl: number;
}

export interface RiskCurve {
  /** Days from `asOf` to this snapshot (0 = today, N = expiry). */
  daysOut: number;
  /** Human label: "Today", "30d", "Expiry", etc. */
  label: string;
  points: RiskCurvePoint[];
}

export interface HeadlineStats {
  /** Net entry cost: positive = debit paid; negative = credit received. */
  entryDebit: number;
  /** Highest P&L on the expiry curve. */
  maxProfit: number;
  /** Lowest P&L on the expiry curve (most negative). */
  maxRisk: number;
  /** Underlying prices where expiry P&L crosses zero, sorted asc.
   *  Multi-leg trades can have 0, 1, or 2 breakevens. */
  breakevens: number[];
  /** maxProfit / |maxRisk| · 100. Null if maxRisk = 0. */
  riskRewardPct: number | null;
  /** Combined Greeks at current spot, today, with no IV shift. */
  greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  };
}

export interface RiskGraphResult {
  /** One curve per snapshot time (Today, 50% time, Expiry, etc.). */
  curves: RiskCurve[];
  headline: HeadlineStats;
}

/** Calendar days between two ISO dates. */
function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

/**
 * Net entry debit. Positive = paid; negative = received credit.
 * Per CONTRACT (× 100). Sums across legs.
 */
export function computeEntryDebit(legs: Leg[]): number {
  let net = 0;
  for (const leg of legs) {
    const sign = leg.side === "long" ? +1 : -1;
    net += sign * leg.qty * leg.entryPrice * 100;
  }
  return net;
}

/**
 * P&L for one leg at (underlying, daysOut, ivShift). Used internally
 * by the curve walker.
 */
function legPnlAt(
  leg: Leg,
  underlying: number,
  daysOut: number,
  asOf: string,
  ivShift: number,
  r: number,
): number {
  const dteAtSnapshot = daysBetween(asOf, leg.expiration) - daysOut;
  const T = Math.max(0, dteAtSnapshot) / 365;
  const sigma = Math.max(0, leg.entryIv + ivShift);

  const value =
    T <= 0
      ? intrinsic(leg.type, underlying, leg.strike)
      : bsPriceGreeks(leg.type, {
          S: underlying,
          K: leg.strike,
          T,
          sigma,
          r,
        }).price;

  // Position-level P&L: long = (current − entry); short = (entry − current).
  const directional = leg.side === "long" ? value - leg.entryPrice : leg.entryPrice - value;
  return directional * leg.qty * 100;
}

/**
 * Total P&L summed across all legs at a given (underlying, daysOut, ivShift).
 */
function totalPnlAt(
  legs: Leg[],
  underlying: number,
  daysOut: number,
  asOf: string,
  ivShift: number,
  r: number,
): number {
  let total = 0;
  for (const leg of legs) {
    total += legPnlAt(leg, underlying, daysOut, asOf, ivShift, r);
  }
  return total;
}

/**
 * Find zero-crossings of the expiry P&L curve (interpolated between
 * adjacent grid points). Used for breakeven calculation.
 */
function findBreakevens(points: RiskCurvePoint[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if ((a.pnl <= 0 && b.pnl >= 0) || (a.pnl >= 0 && b.pnl <= 0)) {
      if (Math.abs(b.pnl - a.pnl) < 1e-9) {
        out.push(a.underlying);
      } else {
        const t = -a.pnl / (b.pnl - a.pnl);
        out.push(a.underlying + t * (b.underlying - a.underlying));
      }
    }
  }
  return out;
}

/**
 * Walk the grid + assemble headline stats.
 *
 * Snapshots:
 *   - "Today" (0 days out, current IV+shift)
 *   - "Halfway" (DTE/2 days out)
 *   - "Near expiry" (90% of DTE)
 *   - "Expiry" (uses intrinsic)
 *
 * DTE is the FURTHEST expiry across all legs — calendars stay on the
 * graph until the back-month expires.
 */
export function computeRiskGraph(legs: Leg[], cfg: GridConfig): RiskGraphResult {
  if (legs.length === 0) {
    return {
      curves: [],
      headline: {
        entryDebit: 0,
        maxProfit: 0,
        maxRisk: 0,
        breakevens: [],
        riskRewardPct: null,
        greeks: { delta: 0, gamma: 0, theta: 0, vega: 0 },
      },
    };
  }

  const pricePoints = cfg.pricePoints ?? 81;
  const priceRangePct = cfg.priceRangePct ?? 0.30;
  const r = cfg.r ?? 0.04;
  const ivShift = cfg.ivShift ?? 0;

  const lo = cfg.spot * (1 - priceRangePct);
  const hi = cfg.spot * (1 + priceRangePct);
  const step = (hi - lo) / (pricePoints - 1);
  const priceGrid = Array.from({ length: pricePoints }, (_, i) => lo + i * step);

  // Furthest expiry → defines "Expiry" snapshot DTE.
  const maxDte = Math.max(...legs.map((l) => daysBetween(cfg.asOf, l.expiration)));
  const snapshots: Array<{ daysOut: number; label: string }> = [
    { daysOut: 0, label: "Today" },
    { daysOut: Math.floor(maxDte * 0.5), label: `${Math.floor(maxDte * 0.5)}d` },
    { daysOut: Math.floor(maxDte * 0.9), label: `${Math.floor(maxDte * 0.9)}d` },
    { daysOut: maxDte, label: "Expiry" },
  ].filter((s, i, arr) => arr.findIndex((x) => x.daysOut === s.daysOut) === i);

  const curves: RiskCurve[] = snapshots.map((snap) => {
    const points: RiskCurvePoint[] = priceGrid.map((px) => ({
      underlying: px,
      pnl: totalPnlAt(legs, px, snap.daysOut, cfg.asOf, ivShift, r),
    }));
    return { daysOut: snap.daysOut, label: snap.label, points };
  });

  // Headline stats off the EXPIRY curve (the "outcome at hold-to-end" scenario).
  const expiryCurve = curves[curves.length - 1];
  const pnls = expiryCurve.points.map((p) => p.pnl);
  const maxProfit = Math.max(...pnls);
  const maxRisk = Math.min(...pnls);
  const breakevens = findBreakevens(expiryCurve.points);
  const entryDebit = computeEntryDebit(legs);
  const riskRewardPct =
    maxRisk < 0 ? (maxProfit / Math.abs(maxRisk)) * 100 : null;

  // Combined Greeks at current spot, today, no IV shift.
  const greeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const leg of legs) {
    const dteToday = daysBetween(cfg.asOf, leg.expiration);
    const T = Math.max(0, dteToday) / 365;
    const sigma = Math.max(0, leg.entryIv + ivShift);
    if (T <= 0 || sigma <= 0) continue;
    const g = bsPriceGreeks(leg.type, {
      S: cfg.spot,
      K: leg.strike,
      T,
      sigma,
      r,
    });
    const sign = leg.side === "long" ? +1 : -1;
    const positionMult = sign * leg.qty * 100;
    greeks.delta += g.delta * positionMult;
    greeks.gamma += g.gamma * positionMult;
    greeks.theta += g.theta * positionMult;
    greeks.vega += g.vega * positionMult;
  }

  return {
    curves,
    headline: {
      entryDebit,
      maxProfit,
      maxRisk,
      breakevens,
      riskRewardPct,
      greeks,
    },
  };
}
