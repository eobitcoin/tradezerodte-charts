/**
 * Cheap LEAPs scanner.
 *
 * For each ticker in LEAP_WATCHLIST, compute three independent scores
 * (all 0-100, higher = better candidate):
 *
 *   1. IV-rank score — (100 - current IV's percentile in 1y range).
 *      Cheap vol = high score. Source: iv_snapshots history.
 *
 *   2. Quality score — from SEC EDGAR fundamentals (revenue growth,
 *      operating margin, FCF / cash buffer). Durable business = high
 *      score.
 *
 *   3. Setup score — price action: drawdown from 52w high (sweet spot
 *      -25% to -50%) AND price >= 200-day MA (not in free fall).
 *      Pullback within an uptrend = high score.
 *
 * Composite = 0.4·ivRank + 0.4·quality + 0.2·setup.
 *
 * For each ticker that clears MIN_COMPOSITE, walk the Polygon chain
 * and pick the 25-delta call with 14-20 month DTE. That contract is
 * the "pick" — recorded in leap_picks with all the per-leg market
 * data the page renders.
 */

import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  ivSnapshots,
  type LeapPickSummary,
} from "@/lib/db/schema";
import { fetchOptionChain, fetchUnderlyingDailyBars } from "@/lib/polygon";
import { fetchSecFundamentals, type SecFundamentals } from "@/lib/sec-edgar";

/** LEAP universe — quality names with iv_snapshots history backfilled.
 *  Tech-heavy by design; expand later by adding to OPTIONS_EDGE_WATCHLIST
 *  and re-running the backfill so IV rank is computable. */
export const LEAP_WATCHLIST = [
  // Mega-cap tech
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA",
  // Semis
  "AMD", "INTC", "MU", "AVGO", "MRVL",
  // Other quality
  "NFLX", "PLTR", "BAC",
] as const;

/** Minimum composite score for a candidate to make the published list. */
export const MIN_COMPOSITE = 55;

/** Sweet-spot DTE range for LEAPs — long enough to ride a cycle,
 *  short enough not to bleed vega forever. */
const MIN_DTE = 420;
const MAX_DTE = 600;
const TARGET_DTE = 540; // 18 months

/** Target delta for the picked contract. 25Δ = max convexity per dollar
 *  for LEAPs at the typical IV regime. */
const TARGET_DELTA = 0.25;
const DELTA_TOLERANCE = 0.12; // accept 13-37 delta if 25 isn't listed

/** Minimum liquidity bar — kill picks you can't actually exit. */
const MIN_OPEN_INTEREST = 200;
const MAX_SPREAD_PCT = 0.12; // bid-ask spread ≤ 12% of mid

// ----------------------------------------------------------------------------
// Score: IV rank
// ----------------------------------------------------------------------------

/**
 * Compute IV rank from iv_snapshots history. Returns a 0-100 score
 * where 100 = current IV is at its 1-year LOW (LEAP is cheapest).
 *
 *   ivRankScore = 100 - percentile(currentIv, 1y history)
 *
 * Returns null when history is too thin to be meaningful.
 */
export async function computeIvRankScore(ticker: string): Promise<{
  ivRank: number | null;
  score: number | null;
  currentIv: number | null;
}> {
  const oneYearAgo = new Date();
  oneYearAgo.setUTCDate(oneYearAgo.getUTCDate() - 365);
  const rows = await db
    .select({ atmIv30d: ivSnapshots.atmIv30d })
    .from(ivSnapshots)
    .where(
      and(
        eq(ivSnapshots.ticker, ticker),
        gte(ivSnapshots.snapshotDate, oneYearAgo.toISOString().slice(0, 10)),
      ),
    )
    .orderBy(desc(ivSnapshots.snapshotDate));

  const series = rows
    .map((r) => (r.atmIv30d ? Number(r.atmIv30d) : NaN))
    .filter((v) => Number.isFinite(v));

  if (series.length < 60) {
    return { ivRank: null, score: null, currentIv: null };
  }
  const currentIv = series[0]; // most recent
  const sorted = [...series].sort((a, b) => a - b);
  const rank =
    sorted.findIndex((v) => v >= currentIv) / (sorted.length - 1);
  const ivRank = Math.max(0, Math.min(100, rank * 100));
  const score = 100 - ivRank;
  return { ivRank, score, currentIv };
}

// ----------------------------------------------------------------------------
// Score: fundamental quality
// ----------------------------------------------------------------------------

/**
 * Compute a 0-100 quality score from SEC EDGAR fundamentals.
 *
 * Weighting (out of 100):
 *   - Revenue YoY growth (30 pts): >20% → 30, 10-20% → 20, 5-10% → 10
 *   - Operating income positive (20 pts): yes → 20, no → 0
 *   - Gross margin (20 pts): >50% → 20, 30-50% → 10, 15-30% → 5
 *   - Cash runway / no burn (20 pts): not burning OR >8 quarters runway → 20
 *   - Latest filing recency (10 pts): within last 120 days → 10
 *
 * Returns null when SEC EDGAR has no usable data (private subsidiary,
 * recent IPO, etc.) — caller skips the ticker.
 */
export function computeQualityScore(
  fund: SecFundamentals | null,
): { score: number | null; reasons: string[] } {
  if (!fund) return { score: null, reasons: [] };
  const reasons: string[] = [];
  let score = 0;

  // 1. Revenue growth YoY
  if (fund.revenueYoyPct != null) {
    if (fund.revenueYoyPct > 20) {
      score += 30;
      reasons.push(`revenue +${fund.revenueYoyPct.toFixed(0)}% YoY`);
    } else if (fund.revenueYoyPct > 10) {
      score += 20;
      reasons.push(`revenue +${fund.revenueYoyPct.toFixed(0)}% YoY`);
    } else if (fund.revenueYoyPct > 5) {
      score += 10;
      reasons.push(`revenue +${fund.revenueYoyPct.toFixed(0)}% YoY`);
    } else if (fund.revenueYoyPct > 0) {
      score += 5;
    } else {
      reasons.push(`revenue ${fund.revenueYoyPct.toFixed(0)}% YoY (declining)`);
    }
  }

  // 2. Operating income positive
  if (fund.operatingIncomeTtm != null) {
    if (fund.operatingIncomeTtm > 0) {
      score += 20;
      reasons.push(`profitable (op inc TTM)`);
    } else {
      reasons.push(`unprofitable`);
    }
  }

  // 3. Gross margin
  if (fund.grossMarginPct != null) {
    if (fund.grossMarginPct > 50) {
      score += 20;
      reasons.push(`${fund.grossMarginPct.toFixed(0)}% gross margin`);
    } else if (fund.grossMarginPct > 30) {
      score += 10;
      reasons.push(`${fund.grossMarginPct.toFixed(0)}% gross margin`);
    } else if (fund.grossMarginPct > 15) {
      score += 5;
    }
  }

  // 4. Cash runway / not burning
  if (fund.runwayQuarters == null) {
    // Not burning cash — best case
    score += 20;
    reasons.push(`cash positive`);
  } else if (fund.runwayQuarters > 8) {
    score += 20;
    reasons.push(`${fund.runwayQuarters.toFixed(0)}q runway`);
  } else if (fund.runwayQuarters > 4) {
    score += 10;
    reasons.push(`${fund.runwayQuarters.toFixed(0)}q runway`);
  } else {
    reasons.push(`only ${fund.runwayQuarters.toFixed(0)}q runway`);
  }

  // 5. Filing recency
  if (fund.asOf) {
    const ageDays = (Date.now() - new Date(fund.asOf).getTime()) / 86_400_000;
    if (ageDays < 120) {
      score += 10;
    } else if (ageDays > 200) {
      reasons.push(`stale filing (${Math.round(ageDays)}d old)`);
    }
  }

  return { score: Math.min(100, score), reasons };
}

// ----------------------------------------------------------------------------
// Score: technical setup
// ----------------------------------------------------------------------------

/**
 * Setup score from price action over the last 12 months.
 *
 * Two independent factors:
 *   - Pullback from 52w high (sweet spot -25% to -50%): 0-60 pts
 *   - Above 200-day MA (not in free fall): 0-40 pts
 *
 * Picks need BOTH: a meaningful pullback (otherwise valuation is
 * stretched and reward/risk is poor) AND a healthy underlying trend
 * (otherwise you're catching a falling knife).
 */
export async function computeSetupScore(ticker: string): Promise<{
  score: number | null;
  spot: number | null;
  high52w: number | null;
  pullbackPct: number | null;
  above200dma: boolean | null;
}> {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 380);
  const fromIso = from.toISOString().slice(0, 10);
  let bars: Map<string, number>;
  try {
    bars = await fetchUnderlyingDailyBars(ticker, fromIso, to);
  } catch {
    return {
      score: null,
      spot: null,
      high52w: null,
      pullbackPct: null,
      above200dma: null,
    };
  }
  const series = [...bars.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (series.length < 200) {
    return {
      score: null,
      spot: null,
      high52w: null,
      pullbackPct: null,
      above200dma: null,
    };
  }
  const closes = series.map(([, c]) => c);
  const spot = closes[closes.length - 1];
  const high52w = Math.max(...closes);
  const pullbackPct = ((spot - high52w) / high52w) * 100;
  // 200-day MA over the most recent 200 closes
  const last200 = closes.slice(-200);
  const ma200 = last200.reduce((a, b) => a + b, 0) / last200.length;
  const above200dma = spot >= ma200;

  let score = 0;
  // Pullback sweet spot: -25% to -50%
  if (pullbackPct <= -25 && pullbackPct >= -50) {
    score += 60;
  } else if (pullbackPct < -50) {
    score += 30; // too deep — may be terminal
  } else if (pullbackPct < -15) {
    score += 40;
  } else if (pullbackPct < -5) {
    score += 20;
  }
  // Above 200dma adds 40, below adds 0
  if (above200dma) score += 40;

  return {
    score: Math.min(100, score),
    spot,
    high52w,
    pullbackPct,
    above200dma,
  };
}

// ----------------------------------------------------------------------------
// Pick the LEAP contract from the chain.
// ----------------------------------------------------------------------------

/**
 * Walk the Polygon chain and pick the 25-delta call that best fits
 * the LEAP DTE window. Returns null if nothing in range clears the
 * liquidity bar.
 */
export async function pickLeapContract(
  ticker: string,
): Promise<{
  contractTicker: string;
  expirationDate: string;
  strike: number;
  dteDays: number;
  underlyingPrice: number;
  premiumMid: number | null;
  premiumBid: number | null;
  premiumAsk: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  openInterest: number | null;
} | null> {
  const chain = await fetchOptionChain(ticker);
  if (chain.length === 0) return null;

  // Spot from any chain entry.
  let spot: number | null = null;
  for (const c of chain) {
    const p = c.underlying_asset?.price;
    if (typeof p === "number" && Number.isFinite(p) && p > 0) {
      spot = p;
      break;
    }
  }
  if (spot == null) return null;

  const now = Date.now();
  // Calls only, in DTE window, with greeks + OI present.
  const candidates = chain
    .filter((c) => c.details.contract_type === "call")
    .map((c) => {
      const expiry = c.details.expiration_date;
      const dteDays = Math.round(
        (new Date(expiry).getTime() - now) / 86_400_000,
      );
      return { c, dteDays };
    })
    .filter(({ dteDays }) => dteDays >= MIN_DTE && dteDays <= MAX_DTE)
    .filter(({ c }) => {
      const d = c.greeks?.delta;
      if (typeof d !== "number" || !Number.isFinite(d)) return false;
      return Math.abs(d - TARGET_DELTA) <= DELTA_TOLERANCE;
    })
    .filter(({ c }) => (c.open_interest ?? 0) >= MIN_OPEN_INTEREST);

  if (candidates.length === 0) return null;

  // Score by: closeness to target delta + closeness to target DTE.
  // Cheap, transparent ranking — no need for a full optimizer.
  const scored = candidates.map(({ c, dteDays }) => {
    const d = c.greeks?.delta ?? TARGET_DELTA;
    const deltaErr = Math.abs(d - TARGET_DELTA);
    const dteErr = Math.abs(dteDays - TARGET_DTE) / 180;
    return { c, dteDays, score: deltaErr + dteErr * 0.5 };
  });
  scored.sort((a, b) => a.score - b.score);

  // Walk picks in order; first one that also passes the spread filter wins.
  for (const { c, dteDays } of scored) {
    const bid = c.last_quote?.bid;
    const ask = c.last_quote?.ask;
    if (
      typeof bid === "number" && bid > 0 &&
      typeof ask === "number" && ask > 0 &&
      ask > bid
    ) {
      const mid = (bid + ask) / 2;
      const spreadPct = (ask - bid) / mid;
      if (spreadPct > MAX_SPREAD_PCT) continue;
    }
    return {
      contractTicker: c.details.ticker,
      expirationDate: c.details.expiration_date,
      strike: c.details.strike_price,
      dteDays,
      underlyingPrice: spot,
      premiumMid:
        typeof bid === "number" && typeof ask === "number"
          ? (bid + ask) / 2
          : null,
      premiumBid: typeof bid === "number" ? bid : null,
      premiumAsk: typeof ask === "number" ? ask : null,
      iv: c.implied_volatility ?? null,
      delta: c.greeks?.delta ?? null,
      gamma: c.greeks?.gamma ?? null,
      theta: c.greeks?.theta ?? null,
      vega: c.greeks?.vega ?? null,
      openInterest: c.open_interest ?? null,
    };
  }
  return null;
}

// ----------------------------------------------------------------------------
// Top-level scan: assemble candidates → score → rank.
// ----------------------------------------------------------------------------

export interface LeapCandidateResult {
  ticker: string;
  ivRank: number | null;
  ivRankScore: number | null;
  qualityScore: number | null;
  qualityReasons: string[];
  setupScore: number | null;
  setup: {
    spot: number | null;
    high52w: number | null;
    pullbackPct: number | null;
    above200dma: boolean | null;
  };
  composite: number;
  contract: Awaited<ReturnType<typeof pickLeapContract>>;
  fundamentals: SecFundamentals | null;
  errors: string[];
}

/**
 * Run the full scan for one ticker. Each independent stage is wrapped
 * in try/catch so a single failure (SEC down, chain empty, etc.) doesn't
 * tank the whole scan — failed stages just contribute 0 to the composite.
 */
export async function scanLeapTicker(
  ticker: string,
): Promise<LeapCandidateResult> {
  const errors: string[] = [];

  const ivResult = await computeIvRankScore(ticker).catch((e) => {
    errors.push(`iv: ${e instanceof Error ? e.message : String(e)}`);
    return { ivRank: null, score: null, currentIv: null };
  });

  const fund = await fetchSecFundamentals(ticker).catch((e) => {
    errors.push(`sec: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  });
  const quality = computeQualityScore(fund);

  const setupResult = await computeSetupScore(ticker).catch((e) => {
    errors.push(`setup: ${e instanceof Error ? e.message : String(e)}`);
    return {
      score: null,
      spot: null,
      high52w: null,
      pullbackPct: null,
      above200dma: null,
    };
  });

  // Composite — weighted blend. Missing components contribute 0 (more
  // conservative than skipping them entirely).
  const composite =
    0.4 * (ivResult.score ?? 0) +
    0.4 * (quality.score ?? 0) +
    0.2 * (setupResult.score ?? 0);

  // Only fetch the contract if the composite cleared the bar — saves
  // a Polygon chain call per non-qualifying ticker. The chain pull is
  // by far the heaviest cost in this scan.
  let contract: Awaited<ReturnType<typeof pickLeapContract>> = null;
  if (composite >= MIN_COMPOSITE) {
    contract = await pickLeapContract(ticker).catch((e) => {
      errors.push(`chain: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
  }

  return {
    ticker,
    ivRank: ivResult.ivRank,
    ivRankScore: ivResult.score,
    qualityScore: quality.score,
    qualityReasons: quality.reasons,
    setupScore: setupResult.score,
    setup: {
      spot: setupResult.spot,
      high52w: setupResult.high52w,
      pullbackPct: setupResult.pullbackPct,
      above200dma: setupResult.above200dma,
    },
    composite,
    contract,
    fundamentals: fund,
    errors,
  };
}

/**
 * Run the scan across the watchlist. Returns the full result set so
 * the cron can persist + summarize.
 */
export async function scanLeapUniverse(opts: {
  perTickerDelayMs?: number;
} = {}): Promise<LeapCandidateResult[]> {
  const perTickerDelayMs = opts.perTickerDelayMs ?? 600;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const out: LeapCandidateResult[] = [];
  let first = true;
  for (const ticker of LEAP_WATCHLIST) {
    if (!first) await sleep(perTickerDelayMs);
    first = false;
    const result = await scanLeapTicker(ticker);
    out.push(result);
  }
  // Sort by composite descending (best candidate first).
  out.sort((a, b) => b.composite - a.composite);
  return out;
}

/**
 * Format a LeapCandidateResult + its contract as a LeapPickSummary for
 * the scan jsonb snapshot. Skips candidates that didn't pull a contract.
 */
export function toPickSummary(r: LeapCandidateResult): LeapPickSummary | null {
  if (!r.contract) return null;
  return {
    ticker: r.ticker,
    contractTicker: r.contract.contractTicker,
    expirationDate: r.contract.expirationDate,
    strike: r.contract.strike,
    dteDays: r.contract.dteDays,
    underlyingPrice: r.contract.underlyingPrice,
    premiumMid: r.contract.premiumMid,
    premiumBid: r.contract.premiumBid,
    premiumAsk: r.contract.premiumAsk,
    iv: r.contract.iv,
    delta: r.contract.delta,
    gamma: r.contract.gamma,
    theta: r.contract.theta,
    vega: r.contract.vega,
    openInterest: r.contract.openInterest,
    ivRank: r.ivRank,
    qualityScore: r.qualityScore,
    setupScore: r.setupScore,
    compositeScore: Number(r.composite.toFixed(2)),
    fundamentals: {
      revenueTtm: r.fundamentals?.revenueTtm ?? null,
      revenueYoyPct: r.fundamentals?.revenueYoyPct ?? null,
      grossMarginPct: r.fundamentals?.grossMarginPct ?? null,
      operatingIncomeTtm: r.fundamentals?.operatingIncomeTtm ?? null,
      cashAndSt: r.fundamentals?.cashAndSt ?? null,
      runwayQuarters: r.fundamentals?.runwayQuarters ?? null,
      qualityReasons: r.qualityReasons,
      setup: r.setup,
    },
  };
}
