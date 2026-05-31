/**
 * Dealer Gamma Exposure (GEX) computation.
 *
 * Pulls a Polygon options chain snapshot, aggregates per-strike net
 * dealer gamma using the standard "dealers long calls, short puts"
 * assumption, finds the cumulative-zero-cross (zero-gamma flip), and
 * returns a structured snapshot ready for DB persistence.
 *
 * Why this is the most-traded signal in 0DTE land:
 *   - When totalGex > 0 (long gamma), dealers hedge by selling rallies
 *     and buying dips — realized vol stays low, index pins.
 *   - When totalGex < 0 (short gamma), dealers chase the move — small
 *     pushes amplify into trends. The zero-gamma strike is where the
 *     regime flips intraday.
 *
 * Caveats — read before trading off this:
 *   1. The dealer-position assumption is a heuristic. SqueezeMetrics,
 *      Imran Lakha, et al. use slightly different sign conventions
 *      (sometimes treating dealers as net short calls on broad indexes).
 *      For single names the long-call/short-put assumption is
 *      conventional; for indexes opinions differ. We ship the standard
 *      version and note this in the UI.
 *   2. We aggregate ALL listed expiries equally. Dealer hedging is
 *      typically dominated by the near-month and 0/1 DTE. A future
 *      version could weight by 1/sqrt(DTE) or expose per-expiry GEX.
 *   3. Gamma snaps to zero on deep ITM/OTM strikes. Polygon's chain
 *      includes them all; we sum honestly. Some platforms truncate
 *      to ±10% from spot — easy to add later if our profile looks
 *      noisy at the tails.
 */

import { fetchOptionChain } from "@/lib/polygon";
import type { GexStrikeRow } from "@/lib/db/schema";

/** GEX watchlist — indexes + the most-traded single names. Locked
 *  list to match the cron's Polygon usage profile (5 min × 13 tickers
 *  × ~2 chain calls each = ~78/min comfortably under the rate cap). */
export const GEX_WATCHLIST = [
  // Indexes
  "SPY", "QQQ", "IWM",
  // Mega-cap tech
  "AAPL", "MSFT", "NVDA", "TSLA", "META", "AMZN", "GOOGL",
  // High-flow single names
  "AMD", "COIN", "PLTR",
] as const;

export type GexTicker = (typeof GEX_WATCHLIST)[number];

/** Computed snapshot ready for INSERT. */
export interface GexSnapshotResult {
  ticker: string;
  spot: number;
  totalGex: number;
  zeroGammaStrike: number | null;
  zeroGammaPct: number | null;
  gexByStrike: GexStrikeRow[];
  contractsScanned: number;
  expiriesScanned: number;
}

/**
 * Walk the chain, aggregate per-strike net dealer gamma, find the
 * zero-gamma flip, return the structured result.
 *
 * Two assumptions baked in:
 *   - Dealers long calls (positive gamma contribution)
 *   - Dealers short puts (negative gamma contribution)
 *
 * Each strike's GEX is converted to dollar terms via the contract
 * multiplier (100) and spot² so it's directly readable as "$ of
 * hedging per 1% move."
 *
 * Returns null if the chain came back empty or the underlying price
 * couldn't be extracted — caller should skip and log.
 */
export async function computeGexSnapshot(
  ticker: string,
): Promise<GexSnapshotResult | null> {
  const chain = await fetchOptionChain(ticker);
  if (chain.length === 0) return null;

  // Pull the underlying spot from the first contract that has it.
  // Polygon embeds spot in each chain entry's `underlying_asset.price`.
  let spot: number | null = null;
  for (const c of chain) {
    const p = c.underlying_asset?.price;
    if (typeof p === "number" && Number.isFinite(p) && p > 0) {
      spot = p;
      break;
    }
  }
  if (spot == null) return null;

  // Bucket per strike: sum callGex and putGex separately so we can
  // expose both in the JSONB and compute net per strike.
  const buckets = new Map<number, { callGex: number; putGex: number }>();
  const expirySet = new Set<string>();
  let contractsScanned = 0;

  const dollarScale = 100 * spot * spot; // contract multiplier × spot² → $-gamma

  for (const c of chain) {
    const gamma = c.greeks?.gamma;
    const oi = c.open_interest;
    if (
      typeof gamma !== "number" || !Number.isFinite(gamma) ||
      typeof oi !== "number" || !Number.isFinite(oi) || oi <= 0
    ) {
      continue;
    }
    const strike = c.details.strike_price;
    const type = c.details.contract_type;
    const expiry = c.details.expiration_date;
    if (!Number.isFinite(strike) || strike <= 0) continue;

    const dollarGamma = gamma * oi * dollarScale;
    const bucket = buckets.get(strike) ?? { callGex: 0, putGex: 0 };
    if (type === "call") {
      // Dealer long calls → positive contribution.
      bucket.callGex += dollarGamma;
    } else {
      // Dealer short puts → negative contribution.
      bucket.putGex -= dollarGamma;
    }
    buckets.set(strike, bucket);
    expirySet.add(expiry);
    contractsScanned++;
  }

  if (buckets.size === 0) return null;

  // Build the sorted profile + running cumulative sum.
  const strikes = [...buckets.keys()].sort((a, b) => a - b);
  const gexByStrike: GexStrikeRow[] = [];
  let running = 0;
  for (const strike of strikes) {
    const b = buckets.get(strike)!;
    const netGex = b.callGex + b.putGex;
    running += netGex;
    gexByStrike.push({
      strike,
      callGex: b.callGex,
      putGex: b.putGex,
      netGex,
      cumulativeGex: running,
    });
  }

  const totalGex = running;
  const zeroGammaStrike = findZeroGammaFlip(gexByStrike);
  const zeroGammaPct =
    zeroGammaStrike != null && spot > 0
      ? ((zeroGammaStrike - spot) / spot) * 100
      : null;

  return {
    ticker,
    spot,
    totalGex,
    zeroGammaStrike,
    zeroGammaPct,
    gexByStrike,
    contractsScanned,
    expiriesScanned: expirySet.size,
  };
}

/**
 * Find the strike at which cumulative GEX changes sign. Walks the
 * sorted profile, finds the FIRST pair of adjacent rows whose
 * cumulative values straddle zero, and linearly interpolates between
 * their strikes.
 *
 * Why linear interpolation: discrete strikes give a coarse answer
 * ("flip is between $580 and $585"). A linear blend by cumulative
 * magnitude is a defensible best-guess — exactly what most public
 * GEX platforms report.
 *
 * Returns null if cumulative GEX is monotonic (never crosses zero).
 * For very-deep-OTM-dominant profiles this can happen on quiet days.
 */
export function findZeroGammaFlip(rows: GexStrikeRow[]): number | null {
  if (rows.length < 2) return null;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (
      (a.cumulativeGex <= 0 && b.cumulativeGex >= 0) ||
      (a.cumulativeGex >= 0 && b.cumulativeGex <= 0)
    ) {
      // Avoid divide-by-zero on the (rare) exact-zero hit.
      const denom = b.cumulativeGex - a.cumulativeGex;
      if (Math.abs(denom) < 1e-9) return a.strike;
      const t = -a.cumulativeGex / denom;
      return a.strike + t * (b.strike - a.strike);
    }
  }
  return null;
}
