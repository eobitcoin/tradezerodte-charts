/**
 * Max pain + GEX computation from a raw options chain.
 *
 * Max pain (per expiration):
 *   For each candidate strike `K`, compute the total intrinsic-value loss to
 *   ALL option holders if the underlying settles at K:
 *     loss(K) = Σ_callOI_strikeS (max(K - S, 0) * 100)   for calls with strike S
 *             + Σ_putOI_strikeS (max(S - K, 0) * 100)    for puts with strike S
 *   The max-pain strike is the K that minimises holder profit (== minimises
 *   our `loss` here, which is dealer profit = holder loss).
 *
 *   Equivalently: max pain = the strike at which the most option contracts
 *   expire worthless. Search across all listed strikes.
 *
 * GEX (gamma exposure, per contract):
 *   gex_contract = gamma * OI * 100 * spot^2 * 0.01
 *   Sign convention: dealers short calls, long puts → call gamma = +GEX,
 *   put gamma = −GEX.
 *
 *   Per expiration: sum signed GEX across all contracts.
 *   Total per ticker: sum across all expirations.
 *
 * Walls + flip:
 *   Net per-strike GEX = Σ contracts at that strike (call_gex − put_gex) *
 *   their gamma * OI weighting. Call wall = strike with maximum positive net
 *   GEX. Put wall = strike with maximum negative net GEX. Zero-gamma flip =
 *   linear interpolation of the strike where cumulative GEX (sorted by strike)
 *   crosses zero.
 *
 * Regime:
 *   POS if total GEX > 0; NEG if < 0; FLIP if |spot − flip_strike| / spot < 0.5%.
 */

import type { TradierOption } from "./tradier";

export interface ExpirationStat {
  exp: string;
  dte: number;
  maxPain: number;
  spot: number;
  callOI: number;
  putOI: number;
  pcRatio?: number;
  netGEX: number; // $M per 1%
}

export interface TickerStats {
  spot: number;
  frontMonthMaxPain: number | undefined;
  totalGEX: number; // $B per 1%
  flipStrike: number | undefined;
  callWall: number | undefined;
  putWall: number | undefined;
  regime: "POS" | "NEG" | "FLIP";
  expirations: ExpirationStat[];
}

function dteFromDates(today: Date, expIso: string): number {
  const exp = new Date(`${expIso}T00:00:00Z`);
  const ms = exp.getTime() - today.getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** Compute max pain for a single expiration's option chain. */
function computeMaxPainForExpiration(opts: TradierOption[]): number | undefined {
  // Distinct strikes, sorted ascending.
  const strikeSet = new Set<number>();
  for (const o of opts) strikeSet.add(o.strike);
  const strikes = [...strikeSet].sort((a, b) => a - b);
  if (strikes.length === 0) return undefined;

  // Pre-bucket OI by strike + side for speed.
  type Bucket = { call: number; put: number };
  const oiByStrike = new Map<number, Bucket>();
  for (const o of opts) {
    if (!Number.isFinite(o.open_interest ?? NaN)) continue;
    const oi = o.open_interest!;
    if (oi <= 0) continue;
    if (!oiByStrike.has(o.strike)) oiByStrike.set(o.strike, { call: 0, put: 0 });
    const b = oiByStrike.get(o.strike)!;
    if (o.option_type === "call") b.call += oi;
    else b.put += oi;
  }

  // For each candidate settlement K, compute total dollar loss to holders.
  let bestK = strikes[0];
  let bestLoss = Number.POSITIVE_INFINITY;
  for (const K of strikes) {
    let loss = 0;
    for (const [S, b] of oiByStrike) {
      // Calls with strike S are ITM at settle K iff K > S → loss = (K - S) * 100 * call_OI
      if (b.call > 0 && K > S) loss += (K - S) * 100 * b.call;
      // Puts with strike S are ITM at settle K iff K < S → loss = (S - K) * 100 * put_OI
      if (b.put > 0 && K < S) loss += (S - K) * 100 * b.put;
    }
    if (loss < bestLoss) {
      bestLoss = loss;
      bestK = K;
    }
  }
  return bestK;
}

/** Sum signed GEX (in $) for one expiration, plus walls/flip across strikes. */
function gexAcrossStrikes(
  opts: TradierOption[],
  spot: number,
): {
  totalGex: number; // $ per 1% (raw, will be normalized to $M outside)
  perStrike: Map<number, number>; // signed $-GEX per 1%
} {
  const perStrike = new Map<number, number>();
  let total = 0;
  for (const o of opts) {
    const oi = o.open_interest;
    const gamma = o.greeks?.gamma;
    if (!oi || oi <= 0 || gamma == null || !Number.isFinite(gamma)) continue;
    // gamma per 1% = gamma * OI * 100 * spot^2 * 0.01  (Tradier returns gamma per $1 move; multiply by OI*100*spot²*0.01 to get $ per 1% move)
    const gex = gamma * oi * 100 * spot * spot * 0.01;
    const signed = o.option_type === "call" ? gex : -gex;
    total += signed;
    perStrike.set(o.strike, (perStrike.get(o.strike) ?? 0) + signed);
  }
  return { totalGex: total, perStrike };
}

function findFlipStrike(perStrike: Map<number, number>, spot: number): number | undefined {
  // Cumulative GEX walking strikes ascending — flip is the strike where it changes sign.
  // Restricted to strikes within ±15% of spot — far-OTM crossings (e.g. heavy
  // put gamma at deep-ITM-call strikes) are not actionable "zero-gamma" levels.
  const strikes = [...perStrike.keys()].sort((a, b) => a - b);
  if (strikes.length === 0) return undefined;
  const lo = spot * 0.85;
  const hi = spot * 1.15;

  let cum = 0;
  let prevK: number | null = null;
  let prevCum = 0;
  let nearSpotCrossing: number | undefined;
  for (const k of strikes) {
    const next = cum + perStrike.get(k)!;
    if (prevK != null && Math.sign(prevCum) !== 0 && Math.sign(next) !== Math.sign(prevCum)) {
      const t = prevCum / (prevCum - next);
      const cross = prevK + (k - prevK) * t;
      if (cross >= lo && cross <= hi) {
        nearSpotCrossing = cross;
      }
    }
    prevK = k;
    prevCum = next;
    cum = next;
  }
  return nearSpotCrossing;
}

function findWalls(perStrike: Map<number, number>): {
  callWall: number | undefined;
  putWall: number | undefined;
} {
  let callWall: number | undefined;
  let putWall: number | undefined;
  let maxPos = Number.NEGATIVE_INFINITY;
  let minNeg = Number.POSITIVE_INFINITY;
  for (const [k, v] of perStrike) {
    if (v > maxPos) {
      maxPos = v;
      callWall = k;
    }
    if (v < minNeg) {
      minNeg = v;
      putWall = k;
    }
  }
  return { callWall, putWall };
}

/**
 * Take a Tradier chain (across multiple expirations) plus the current spot
 * price and produce the per-ticker stats we publish.
 *
 * `chainsByExp` is { "YYYY-MM-DD": TradierOption[] } — already filtered to
 * the expirations we want (typically all <= 60 DTE).
 */
export function computeTickerStats(params: {
  spot: number;
  today: Date;
  chainsByExp: Record<string, TradierOption[]>;
}): TickerStats {
  const { spot, today, chainsByExp } = params;
  const expirations: ExpirationStat[] = [];
  const allPerStrike = new Map<number, number>();
  let totalGex = 0;

  // Sort expirations ascending so the front month is first.
  const sortedExps = Object.keys(chainsByExp).sort();
  for (const exp of sortedExps) {
    const opts = chainsByExp[exp];
    if (!opts || opts.length === 0) continue;
    const dte = dteFromDates(today, exp);
    const maxPain = computeMaxPainForExpiration(opts);
    let callOI = 0;
    let putOI = 0;
    for (const o of opts) {
      const oi = o.open_interest ?? 0;
      if (o.option_type === "call") callOI += oi;
      else putOI += oi;
    }
    const { totalGex: expGex, perStrike } = gexAcrossStrikes(opts, spot);
    totalGex += expGex;
    for (const [k, v] of perStrike) allPerStrike.set(k, (allPerStrike.get(k) ?? 0) + v);

    expirations.push({
      exp,
      dte,
      maxPain: maxPain ?? 0,
      spot,
      callOI,
      putOI,
      pcRatio: callOI > 0 ? putOI / callOI : undefined,
      // expGex is $ per 1% — convert to $M per 1%
      netGEX: expGex / 1_000_000,
    });
  }

  const flipStrike = findFlipStrike(allPerStrike, spot);
  const { callWall, putWall } = findWalls(allPerStrike);
  const totalGexB = totalGex / 1_000_000_000; // $B per 1%

  let regime: TickerStats["regime"] = totalGexB > 0 ? "POS" : "NEG";
  if (flipStrike != null && Math.abs(spot - flipStrike) / spot < 0.005) regime = "FLIP";

  return {
    spot,
    frontMonthMaxPain: expirations[0]?.maxPain,
    totalGEX: totalGexB,
    flipStrike,
    callWall,
    putWall,
    regime,
    expirations,
  };
}
