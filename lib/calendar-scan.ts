/**
 * Calendar Trades scanner.
 *
 * Walks the locked large-cap universe and identifies high-probability
 * long-calendar setups: sell a ~30 DTE front-month ATM call, buy a
 * ~90 DTE back-month ATM call at the same strike. Profit comes from
 * front decaying faster than back (theta differential) AND/OR back
 * gaining vega faster than front (vega differential) while the
 * underlying stays near the strike.
 *
 * Filter pipeline (each must pass for a pick to be tradeable):
 *   1. Chain available with both front (20-40 DTE) and back (60-120
 *      DTE) expiries.
 *   2. ATM strike listed in BOTH front and back chains with non-zero
 *      bid/ask.
 *   3. No earnings report in the next 30 days (front would IV-spike
 *      unpredictably). Earnings clearance via Finnhub upcoming calendar.
 *   4. Term structure favorable: front_iv ≥ back_iv (otherwise we'd
 *      be selling cheap vol and buying expensive — backwards).
 *   5. IV rank ≥ 60% when iv_snapshots data exists (front-month
 *      options are statistically expensive vs the ticker's 1y range).
 *
 * Ranking score (0..100):
 *   ivRankComponent       = ivRank × 0.35
 *     (higher rank = more expensive front premium to harvest)
 *   termStructureComponent = clamp((front_iv/back_iv − 1.0) × 100, 0, 25) × 0.30
 *     (steeper inversion = more theta differential to capture)
 *   postEarningsComponent = postEarningsBonus × 0.20
 *     (5-15 days post-EE: +20; 15-30 days: +10; else 0)
 *   dteQualityComponent   = dteQuality × 0.15
 *     (penalty for front DTE far from 30 or back DTE far from 90)
 *
 * Skip reasons are recorded for diagnostic visibility; only ok-tier
 * picks are rendered on the page.
 */

import { fetchOptionChain } from "@/lib/polygon";
import { fetchUpcomingEarnings } from "@/lib/finnhub";
import { fetchEarningsHistoryFromPolygon } from "@/lib/polygon";

type PolygonContract = Awaited<ReturnType<typeof fetchOptionChain>>[number];
import { db } from "@/lib/db";
import { ivSnapshots } from "@/lib/db/schema";
import type {
  CalendarPick,
  CalendarSkipReason,
} from "@/lib/db/schema";
import { SELL_PUTS_UNIVERSE } from "@/lib/sell-puts-universe";
import { and, desc, eq, sql } from "drizzle-orm";

// Strategy windows — same numbers as the help-page spec.
const FRONT_DTE_MIN = 20;
const FRONT_DTE_MAX = 40;
const FRONT_DTE_IDEAL = 30;
const BACK_DTE_MIN = 60;
const BACK_DTE_MAX = 120;
const BACK_DTE_IDEAL = 90;
const MIN_DTE_GAP = 30; // back must be at least 30d further out than front

// Filter thresholds.
const MIN_IV_RANK = 60;
const EARNINGS_CLEARANCE_DAYS = 30;
const POST_EE_SWEET_SPOT_MIN = 5;
const POST_EE_SWEET_SPOT_MAX = 15;
const POST_EE_OK_MAX = 30;

/** Days between two ISO dates (calendar). */
function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Look up the ticker's most recent 30d ATM IV percentile from the
 * iv_snapshots table. Returns null when the ticker isn't in the
 * watchlist or doesn't have 1y of history yet.
 *
 * Percentile = rank of the latest atm_iv_30d among the last 252
 * snapshots × 100. 100 means "highest IV in the past year."
 */
async function fetchIvRank(ticker: string): Promise<number | null> {
  // 252 trading days ≈ 1y. We pull more to handle missing days.
  const series = await db
    .select({
      iv: ivSnapshots.atmIv30d,
      date: ivSnapshots.snapshotDate,
    })
    .from(ivSnapshots)
    .where(eq(ivSnapshots.ticker, ticker))
    .orderBy(desc(ivSnapshots.snapshotDate))
    .limit(252);
  if (series.length < 30) return null; // not enough history
  const numericIvs = series
    .map((s) => (s.iv != null ? Number(s.iv) : null))
    .filter((x): x is number => x != null && Number.isFinite(x) && x > 0);
  if (numericIvs.length < 30) return null;
  const current = numericIvs[0];
  const sorted = [...numericIvs].sort((a, b) => a - b);
  // Percentile rank — fraction of values ≤ current.
  const lessOrEqual = sorted.filter((v) => v <= current).length;
  return Math.round((lessOrEqual / sorted.length) * 100);
}

/** Find the listed expiry closest to `targetDte` calendar days from
 *  today, within the (min, max) window. Returns null when no expiry
 *  falls in the window. */
function pickExpiry(
  expirations: string[],
  scanDay: string,
  targetDte: number,
  min: number,
  max: number,
): { expiration: string; dte: number } | null {
  const inWindow = expirations
    .map((e) => ({ expiration: e, dte: daysBetween(scanDay, e) }))
    .filter((x) => x.dte >= min && x.dte <= max);
  if (inWindow.length === 0) return null;
  inWindow.sort(
    (a, b) =>
      Math.abs(a.dte - targetDte) - Math.abs(b.dte - targetDte),
  );
  return inWindow[0];
}

/** Find the ATM strike that exists in BOTH front and back chains at
 *  the same numeric value. Falls back to closest-to-spot common strike. */
function pickCommonAtmStrike(
  frontStrikes: number[],
  backStrikes: number[],
  spot: number,
): number | null {
  const common = frontStrikes.filter((s) => backStrikes.includes(s));
  if (common.length === 0) return null;
  common.sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot));
  return common[0];
}

/** Polygon snapshot row → mid price, or null if quote missing. */
function contractMid(c: PolygonContract): number | null {
  const bid = c.last_quote?.bid;
  const ask = c.last_quote?.ask;
  if (bid && ask && bid > 0 && ask > 0) return (bid + ask) / 2;
  return null;
}

/** DTE quality score — 100 when both DTEs land on their ideals,
 *  fading linearly as you drift further from them. */
function dteQuality(frontDte: number, backDte: number): number {
  const frontPenalty = Math.abs(frontDte - FRONT_DTE_IDEAL) * 2;
  const backPenalty = Math.abs(backDte - BACK_DTE_IDEAL) * 0.5;
  return Math.max(0, 100 - frontPenalty - backPenalty);
}

/** Post-earnings timing bonus. Sweet spot 5-15 days post-EE = +20.
 *  15-30 days = +10. Otherwise 0. */
function postEarningsBonus(daysSince: number | null): number {
  if (daysSince == null) return 0;
  if (daysSince >= POST_EE_SWEET_SPOT_MIN && daysSince <= POST_EE_SWEET_SPOT_MAX) {
    return 20;
  }
  if (daysSince > POST_EE_SWEET_SPOT_MAX && daysSince <= POST_EE_OK_MAX) {
    return 10;
  }
  return 0;
}

/** Build the empty baseline pick used for skipped tickers. */
function emptyPick(
  ticker: string,
  reason: CalendarSkipReason,
  notes = "",
): CalendarPick {
  return {
    symbol: ticker,
    spot: null,
    strike: null,
    frontExpiration: null,
    frontDte: null,
    backExpiration: null,
    backDte: null,
    frontContractTicker: null,
    backContractTicker: null,
    frontMid: null,
    backMid: null,
    netDebit: null,
    frontIv: null,
    backIv: null,
    termStructureRatio: null,
    ivRank: null,
    daysSinceEarnings: null,
    daysToNextEarnings: null,
    compositeScore: null,
    skipReason: reason,
    notes,
  };
}

/** Score one ticker — pulls chain, computes filters, returns either
 *  an "ok" pick or a skip with reason. */
async function scanOneTicker(
  ticker: string,
  scanDay: string,
): Promise<CalendarPick> {
  let chain: PolygonContract[];
  try {
    chain = await fetchOptionChain(ticker);
  } catch (err) {
    return emptyPick(
      ticker,
      "scan_error",
      `Chain fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (chain.length === 0) return emptyPick(ticker, "no_chain");

  // Spot from any chain row.
  let spot: number | null = null;
  for (const c of chain) {
    const p = c.underlying_asset?.price;
    if (typeof p === "number" && Number.isFinite(p) && p > 0) {
      spot = p;
      break;
    }
  }
  if (spot == null) return emptyPick(ticker, "no_chain");

  // Available expiries, sorted ascending.
  const expirations = [...new Set(chain.map((c) => c.details.expiration_date))]
    .sort();
  const front = pickExpiry(
    expirations,
    scanDay,
    FRONT_DTE_IDEAL,
    FRONT_DTE_MIN,
    FRONT_DTE_MAX,
  );
  if (!front) return emptyPick(ticker, "no_front_expiry");
  const back = pickExpiry(
    expirations,
    scanDay,
    BACK_DTE_IDEAL,
    BACK_DTE_MIN,
    BACK_DTE_MAX,
  );
  if (!back) return emptyPick(ticker, "no_back_expiry");
  // Enforce minimum gap so we don't pick adjacent monthlies.
  if (back.dte - front.dte < MIN_DTE_GAP) {
    return emptyPick(ticker, "no_back_expiry", "Back-front DTE gap < 30");
  }

  // Earnings clearance — check upcoming Finnhub calendar for any EE
  // inside the next 30 days. If any, skip.
  const today = new Date(scanDay);
  const earningsHorizon = new Date(today);
  earningsHorizon.setUTCDate(
    today.getUTCDate() + EARNINGS_CLEARANCE_DAYS,
  );
  let daysToNextEarnings: number | null = null;
  try {
    const upcoming = await fetchUpcomingEarnings({
      symbol: ticker,
      from: scanDay,
      to: earningsHorizon.toISOString().slice(0, 10),
    });
    if (upcoming.length > 0) {
      const next = upcoming
        .map((e) => daysBetween(scanDay, e.date))
        .filter((d) => d >= 0)
        .sort((a, b) => a - b)[0];
      if (next != null) {
        daysToNextEarnings = next;
        return emptyPick(
          ticker,
          "earnings_in_window",
          `Earnings in ${next}d — skip`,
        );
      }
    }
  } catch {
    // Finnhub down — don't block the scan; calendars are weekly so a
    // one-cycle miss isn't critical.
  }

  // Days since last earnings — feeds the post-EE timing bonus.
  let daysSinceEarnings: number | null = null;
  try {
    const past = await fetchEarningsHistoryFromPolygon(ticker, 2);
    if (past.length > 0) {
      const d = daysBetween(past[0].earningsDate, scanDay);
      if (d >= 0) daysSinceEarnings = d;
    }
  } catch {
    // Same fall-back posture as upcoming earnings.
  }

  // Filter call contracts to our two expiries.
  const frontCalls = chain.filter(
    (c) =>
      c.details.expiration_date === front.expiration &&
      c.details.contract_type === "call",
  );
  const backCalls = chain.filter(
    (c) =>
      c.details.expiration_date === back.expiration &&
      c.details.contract_type === "call",
  );
  const frontStrikes = frontCalls.map((c) => c.details.strike_price);
  const backStrikes = backCalls.map((c) => c.details.strike_price);
  const strike = pickCommonAtmStrike(frontStrikes, backStrikes, spot);
  if (strike == null) return emptyPick(ticker, "no_strikes");

  const frontCall = frontCalls.find(
    (c) => c.details.strike_price === strike,
  );
  const backCall = backCalls.find(
    (c) => c.details.strike_price === strike,
  );
  if (!frontCall || !backCall) return emptyPick(ticker, "no_strikes");

  const frontMid = contractMid(frontCall);
  const backMid = contractMid(backCall);
  if (frontMid == null || backMid == null) {
    return emptyPick(ticker, "no_strikes", "Missing bid/ask on a leg");
  }

  const frontIv = frontCall.implied_volatility ?? null;
  const backIv = backCall.implied_volatility ?? null;
  if (!frontIv || !backIv || frontIv <= 0 || backIv <= 0) {
    return emptyPick(ticker, "no_strikes", "Missing IV on a leg");
  }

  const termStructureRatio = frontIv / backIv;
  if (termStructureRatio < 1.0) {
    return emptyPick(
      ticker,
      "term_structure_unfavorable",
      `Front IV ${(frontIv * 100).toFixed(0)}% < back IV ${(backIv * 100).toFixed(0)}%`,
    );
  }

  // IV rank — soft filter. If iv_snapshots doesn't have data, skip
  // because we have no way to know if these expensive-looking options
  // are actually expensive vs the ticker's history.
  const ivRank = await fetchIvRank(ticker);
  if (ivRank == null) return emptyPick(ticker, "no_iv_rank");
  if (ivRank < MIN_IV_RANK) {
    return emptyPick(
      ticker,
      "iv_rank_too_low",
      `IV rank ${ivRank}% < ${MIN_IV_RANK}% threshold`,
    );
  }

  // Composite score — weighted blend of the four signals.
  const ivRankComponent = ivRank * 0.35;
  const termStructureComponent =
    Math.min(25, Math.max(0, (termStructureRatio - 1) * 100)) * 0.3;
  const postEeComponent = postEarningsBonus(daysSinceEarnings) * 0.2;
  const dteComponent = dteQuality(front.dte, back.dte) * 0.15;
  const composite = Math.round(
    ivRankComponent + termStructureComponent + postEeComponent + dteComponent,
  );

  return {
    symbol: ticker,
    spot,
    strike,
    frontExpiration: front.expiration,
    frontDte: front.dte,
    backExpiration: back.expiration,
    backDte: back.dte,
    frontContractTicker: frontCall.details.ticker,
    backContractTicker: backCall.details.ticker,
    frontMid,
    backMid,
    netDebit: Math.max(0, backMid - frontMid),
    frontIv,
    backIv,
    termStructureRatio,
    ivRank,
    daysSinceEarnings,
    daysToNextEarnings,
    compositeScore: composite,
    skipReason: "ok",
    notes:
      daysSinceEarnings != null && daysSinceEarnings <= POST_EE_OK_MAX
        ? `Post-earnings (${daysSinceEarnings}d ago)`
        : "",
  };
}

export interface CalendarScanOptions {
  perTickerDelayMs?: number;
}

export interface CalendarScanResult {
  scanDay: string;
  picks: CalendarPick[];
  universeSize: number;
  computedSize: number;
}

/** Walks the universe, returns sorted picks (ok-tier sorted by
 *  composite score desc, skipped appended). */
export async function runCalendarScan(
  scanDay: string,
  opts: CalendarScanOptions = {},
): Promise<CalendarScanResult> {
  const delay = opts.perTickerDelayMs ?? 600;
  const all: CalendarPick[] = [];
  for (const ticker of SELL_PUTS_UNIVERSE) {
    try {
      const pick = await scanOneTicker(ticker, scanDay);
      all.push(pick);
    } catch (err) {
      all.push(
        emptyPick(
          ticker,
          "scan_error",
          `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }

  const tradeable = all
    .filter((p) => p.skipReason === "ok" && p.compositeScore != null)
    .sort(
      (a, b) =>
        (b.compositeScore ?? -Infinity) - (a.compositeScore ?? -Infinity),
    );
  const skipped = all.filter(
    (p) => p.skipReason !== "ok" || p.compositeScore == null,
  );

  return {
    scanDay,
    picks: [...tradeable, ...skipped],
    universeSize: SELL_PUTS_UNIVERSE.length,
    computedSize: tradeable.length,
  };
}

// Silence unused-import warnings for `sql` and `and` — kept for
// potential filtering in future iterations.
void sql;
void and;
