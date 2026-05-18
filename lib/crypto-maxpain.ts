/**
 * Crypto max pain + GEX computation.
 *
 * Mirrors lib/options-math.ts (which handles equity options via Tradier),
 * but adapts for Deribit's data shape:
 *   - Contract size = 1 unit (1 BTC or 1 ETH), not 100 like equity
 *   - Greeks NOT in the book-summary response — compute Black-Scholes gamma
 *     from mark_iv + parsed strike + time to expiry server-side
 *   - Deribit options are inverse-settled in the base currency, but max
 *     pain as a USD price level is unaffected by that (same calc as linear).
 */

import {
  getBookSummaryByCurrency,
  groupByExpiry,
  parseInstrumentName,
  type DeribitCurrency,
  type DeribitBookSummary,
  type ParsedInstrument,
} from "./deribit";

// ----- Black-Scholes gamma -------------------------------------------------

/** Standard normal PDF: φ(x) = exp(-x²/2) / √(2π) */
function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Black-Scholes gamma for a European option. Same formula for calls + puts.
 *
 *   d1 = (ln(S/K) + (r + σ²/2) * T) / (σ * √T)
 *   gamma = N'(d1) / (S * σ * √T)
 *
 * Returns gamma per $1 move in the underlying — same convention as Tradier.
 */
export function blackScholesGamma(params: {
  spot: number;
  strike: number;
  /** Time to expiry in years. */
  timeYears: number;
  /** Annualized volatility as decimal (0.60 = 60% IV). */
  sigma: number;
  /** Risk-free rate as decimal. Usually ~0 for crypto. */
  rate: number;
}): number {
  const { spot, strike, timeYears, sigma, rate } = params;
  if (spot <= 0 || strike <= 0 || timeYears <= 0 || sigma <= 0) return 0;
  const sqrtT = Math.sqrt(timeYears);
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * sigma * sigma) * timeYears) / (sigma * sqrtT);
  return normalPdf(d1) / (spot * sigma * sqrtT);
}

// ----- Max pain + GEX ------------------------------------------------------

export interface CryptoExpirationStat {
  /** ISO YYYY-MM-DD in UTC. Deribit options settle at 08:00 UTC. */
  exp: string;
  dte: number;
  maxPain: number | undefined;
  callOI: number;
  putOI: number;
  pcRatio: number | undefined;
  /** Net signed GEX for this expiry, in $M per 1% spot move. */
  netGEX: number;
}

export interface CryptoMaxPainStats {
  currency: DeribitCurrency;
  spot: number;
  /** Front-week (closest non-zero-DTE) max pain. */
  frontMaxPain: number | undefined;
  /** Total signed GEX across ALL active expiries in $B per 1%. */
  totalGEX: number;
  /** Strike where cumulative GEX crosses zero (constrained to ±15% of spot). */
  flipStrike: number | undefined;
  /** Strike with the largest +GEX (sticky to upside). */
  callWall: number | undefined;
  /** Strike with the largest −GEX (sticky to downside). */
  putWall: number | undefined;
  regime: "POS" | "NEG" | "FLIP";
  /** Per-expiry breakdown for the next ~10 expiries. */
  expirations: CryptoExpirationStat[];
  /** Total OI summed across all expiries — useful for "low OI" warnings. */
  totalOI: number;
}

/** Compute max pain for one expiry's worth of contracts. */
function computeMaxPainForExpiration(
  rows: Array<DeribitBookSummary & { parsed: ParsedInstrument }>,
): number | undefined {
  type Bucket = { call: number; put: number };
  const oiByStrike = new Map<number, Bucket>();
  for (const r of rows) {
    const oi = r.open_interest;
    if (!Number.isFinite(oi) || oi <= 0) continue;
    const k = r.parsed.strike;
    let b = oiByStrike.get(k);
    if (!b) {
      b = { call: 0, put: 0 };
      oiByStrike.set(k, b);
    }
    if (r.parsed.optionType === "call") b.call += oi;
    else b.put += oi;
  }
  const strikes = [...oiByStrike.keys()].sort((a, b) => a - b);
  if (strikes.length === 0) return undefined;

  // For each candidate settlement K, compute total dollar loss to holders.
  // Same formula as equity (the "100 multiplier" cancels — we just want the K
  // that minimizes loss, and the multiplier is a constant scaling factor).
  let bestK = strikes[0];
  let bestLoss = Number.POSITIVE_INFINITY;
  for (const K of strikes) {
    let loss = 0;
    for (const [S, b] of oiByStrike) {
      if (b.call > 0 && K > S) loss += (K - S) * b.call;
      if (b.put > 0 && K < S) loss += (S - K) * b.put;
    }
    if (loss < bestLoss) {
      bestLoss = loss;
      bestK = K;
    }
  }
  return bestK;
}

/** Sum signed GEX (in $) across one expiry's contracts. */
function gexAcrossExpiry(
  rows: Array<DeribitBookSummary & { parsed: ParsedInstrument }>,
  spot: number,
  rate: number,
  asOfMs: number,
  contractSize: number,
): { totalGex: number; perStrike: Map<number, number> } {
  const perStrike = new Map<number, number>();
  let total = 0;

  for (const r of rows) {
    const oi = r.open_interest;
    const ivPct = r.mark_iv;
    if (!Number.isFinite(oi) || oi <= 0) continue;
    if (ivPct == null || !Number.isFinite(ivPct) || ivPct <= 0) continue;

    const sigma = ivPct / 100;
    const timeMs = r.parsed.expiry.getTime() - asOfMs;
    if (timeMs <= 0) continue; // already expired
    const timeYears = timeMs / (365 * 24 * 60 * 60 * 1000);

    const gamma = blackScholesGamma({
      spot,
      strike: r.parsed.strike,
      timeYears,
      sigma,
      rate,
    });
    if (!Number.isFinite(gamma) || gamma <= 0) continue;

    // GEX per contract: gamma * OI * contractSize * spot² * 0.01 (per 1% move)
    const gex = gamma * oi * contractSize * spot * spot * 0.01;
    const signed = r.parsed.optionType === "call" ? gex : -gex;
    total += signed;
    perStrike.set(r.parsed.strike, (perStrike.get(r.parsed.strike) ?? 0) + signed);
  }

  return { totalGex: total, perStrike };
}

function findFlipStrike(perStrike: Map<number, number>, spot: number): number | undefined {
  const strikes = [...perStrike.keys()].sort((a, b) => a - b);
  if (strikes.length === 0) return undefined;
  // Restrict to ±15% of spot — far-OTM crossings aren't actionable "zero
  // gamma" levels (same convention as the equity implementation).
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
      if (cross >= lo && cross <= hi) nearSpotCrossing = cross;
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
 * Top-level: fetch + compute everything for one currency.
 * Renders happen at /crypto/maxpain page-load time, cached by Next 60s.
 */
export async function fetchCryptoMaxPain(
  currency: DeribitCurrency,
  options: { maxExpirations?: number } = {},
): Promise<CryptoMaxPainStats> {
  const maxExp = options.maxExpirations ?? 10;
  const rows = await getBookSummaryByCurrency(currency);
  if (rows.length === 0) {
    throw new Error(`No active ${currency} options on Deribit`);
  }

  // The book summary repeats underlying_price per row — take the first
  // valid one. (All rows for a given currency share the same underlying.)
  const spot = rows.find((r) => Number.isFinite(r.underlying_price))?.underlying_price ?? 0;
  if (!spot) throw new Error(`No underlying_price in ${currency} response`);
  const rate = rows[0]?.interest_rate ?? 0;

  // Group active rows by expiry and walk in chronological order.
  const grouped = groupByExpiry(rows);
  const sortedKeys = [...grouped.keys()].sort();

  const asOfMs = Date.now();
  const contractSize = 1; // Deribit BTC and ETH options: 1 unit per contract

  let totalGexUsd = 0;
  let totalOI = 0;
  const allPerStrike = new Map<number, number>();
  const expirations: CryptoExpirationStat[] = [];

  for (const expKey of sortedKeys) {
    const expRows = grouped.get(expKey)!;
    const expDate = expRows[0].parsed.expiry;
    const dteMs = expDate.getTime() - asOfMs;
    if (dteMs < 0) continue; // already expired but still in feed; skip
    const dte = Math.max(0, Math.round(dteMs / (24 * 60 * 60 * 1000)));

    const maxPain = computeMaxPainForExpiration(expRows);

    let callOI = 0;
    let putOI = 0;
    for (const r of expRows) {
      const oi = r.open_interest;
      if (!Number.isFinite(oi) || oi <= 0) continue;
      if (r.parsed.optionType === "call") callOI += oi;
      else putOI += oi;
    }
    totalOI += callOI + putOI;

    const { totalGex, perStrike } = gexAcrossExpiry(expRows, spot, rate, asOfMs, contractSize);
    totalGexUsd += totalGex;
    for (const [k, v] of perStrike) {
      allPerStrike.set(k, (allPerStrike.get(k) ?? 0) + v);
    }

    expirations.push({
      exp: expKey,
      dte,
      maxPain,
      callOI,
      putOI,
      pcRatio: callOI > 0 ? putOI / callOI : undefined,
      netGEX: totalGex / 1_000_000, // $M per 1%
    });
  }

  // Sort + truncate the per-expiry breakdown.
  expirations.sort((a, b) => a.exp.localeCompare(b.exp));
  const truncatedExpirations = expirations.slice(0, maxExp);

  const flipStrike = findFlipStrike(allPerStrike, spot);
  const { callWall, putWall } = findWalls(allPerStrike);
  const totalGexB = totalGexUsd / 1_000_000_000; // $B per 1%

  let regime: CryptoMaxPainStats["regime"] = totalGexB > 0 ? "POS" : "NEG";
  if (flipStrike != null && Math.abs(spot - flipStrike) / spot < 0.005) regime = "FLIP";

  return {
    currency,
    spot,
    frontMaxPain: expirations[0]?.maxPain,
    totalGEX: totalGexB,
    flipStrike,
    callWall,
    putWall,
    regime,
    expirations: truncatedExpirations,
    totalOI,
  };
}

// silence unused-import warning — parseInstrumentName is re-exported for tests
void parseInstrumentName;
