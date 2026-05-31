/**
 * Earnings backtest engine (V3 phase 1: Straddle).
 *
 * For each past earnings date, simulate the strategy's entry and exit
 * against real Polygon historical option chains. Returns per-cycle
 * P&L plus aggregate stats (avg ROI %, win %, wins:losses).
 *
 * Why this matters: the V1 heuristic scores are smart guesses based
 * on comparing implied vs historical move. The backtest replaces those
 * guesses with HISTORICAL FACT — "this exact strategy, executed on
 * the last 6 earnings cycles for this ticker, returned X% on average
 * with a Y% win rate."
 *
 * Phase 1 covers Straddle only because (a) it's the simplest to
 * verify visually — buy ATM call + ATM put, hold through earnings,
 * exit at the next-day close — and (b) it's the most-traded earnings
 * strategy. Condor / Breakout / Rush in phases 2-4.
 */

import {
  fetchOptionChain,
  fetchOptionContractBars,
} from "@/lib/polygon";
import {
  fetchEarningsHistory,
  type FinnhubEarningsEvent,
} from "@/lib/finnhub";

export interface StraddleCyclePnl {
  earningsDate: string;       // YYYY-MM-DD
  hour: "bmo" | "amc" | "dmh";
  entryDate: string;           // 4 trading days before EE
  exitDate: string;            // 1 trading day after EE
  entryPrice: number | null;   // straddle mid at entry
  exitPrice: number | null;    // straddle mid at exit
  pnlDollar: number | null;    // per straddle (= 100 × (exit − entry))
  roiPct: number | null;       // pnl / entry × 100
  underlyingMove: number | null; // % stock move entry → exit
  /** Diagnostic: why we couldn't price this cycle (if applicable). */
  skipReason: string | null;
}

export interface StraddleBacktest {
  cycles: StraddleCyclePnl[];
  avgRoiPct: number | null;
  winRate: number | null;       // 0-1
  wins: number;
  losses: number;
  cyclesUsed: number;           // those with both prices priced
  totalCycles: number;          // input count
}

const ENTRY_DAYS_BEFORE = 4;     // buy 4 trading days before EE
const EXIT_DAYS_AFTER = 1;       // sell 1 trading day after EE
const MIN_EXPIRY_DAYS_AFTER_EE = 0;  // earliest acceptable expiry
const MAX_EXPIRY_DAYS_AFTER_EE = 30; // latest

/** Walk N trading days forward/backward from a date. Skips weekends
 *  only (holidays handled later by the bars-missing fallback). */
function shiftTradingDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  let remaining = days;
  const step = days > 0 ? 1 : -1;
  while (remaining !== 0) {
    d.setUTCDate(d.getUTCDate() + step);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= step;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Backtest the ATM-straddle-through-earnings strategy for one ticker.
 *
 *   For each past earnings event (up to `maxCycles`):
 *     1. Determine entry date (4 trading days pre-EE) and exit date
 *        (1 trading day post-EE, accounting for BMO/AMC).
 *     2. Find what contracts existed at entry date — pull the
 *        ticker's full chain ONCE (current snapshot, used only to
 *        identify likely strikes), then use Polygon's per-contract
 *        aggregates endpoint to fetch entry + exit prices.
 *     3. Pick ATM strike — strike closest to underlying close on entry date.
 *     4. Compute straddle mid at entry and exit.
 *     5. P&L = (exit − entry) × 100.
 *
 * Returns null if no cycles could be priced (most likely cause:
 * Polygon contract aggregates don't cover that date range, common for
 * very old earnings or thinly-traded names).
 */
export async function backtestStraddle(
  ticker: string,
  events: FinnhubEarningsEvent[],
  underlyingBars: Map<string, number>,
): Promise<StraddleBacktest> {
  // Fetch the chain ONCE per ticker — was previously fetched per
  // cycle, causing 6× the Polygon calls per ticker (and on a
  // 50-ticker scan, ~300 redundant chain fetches that pushed total
  // runtime past Railway's edge timeout).
  let expiries: string[] = [];
  try {
    const chain = await fetchOptionChain(ticker);
    expiries = [...new Set(chain.map((c) => c.details.expiration_date))].sort();
  } catch {
    // Whole-ticker chain failure — all cycles will skip with the
    // same reason. Cheaper than 6 redundant attempts.
  }

  const cycles: StraddleCyclePnl[] = [];
  for (const ev of events) {
    const cycle = await backtestStraddleOneCycle(
      ticker,
      ev,
      underlyingBars,
      expiries,
    );
    cycles.push(cycle);
  }

  const usable = cycles.filter((c) => c.pnlDollar != null && c.roiPct != null);
  const wins = usable.filter((c) => (c.pnlDollar ?? 0) > 0).length;
  const losses = usable.length - wins;
  const avgRoi =
    usable.length > 0
      ? usable.reduce((s, c) => s + (c.roiPct ?? 0), 0) / usable.length
      : null;
  const winRate = usable.length > 0 ? wins / usable.length : null;

  return {
    cycles,
    avgRoiPct: avgRoi,
    winRate,
    wins,
    losses,
    cyclesUsed: usable.length,
    totalCycles: cycles.length,
  };
}

async function backtestStraddleOneCycle(
  ticker: string,
  event: FinnhubEarningsEvent,
  underlyingBars: Map<string, number>,
  /** Sorted-ascending list of currently-listed expiries for this ticker.
   *  Pre-fetched once per ticker in the parent so cycles don't redo it. */
  currentExpiries: string[],
): Promise<StraddleCyclePnl> {
  const eeDate = event.date;
  const entryDate = shiftTradingDays(eeDate, -ENTRY_DAYS_BEFORE);
  // For BMO earnings, exit is end of the EE day (price reflects move).
  // For AMC / unknown, exit is the NEXT trading day's close.
  const exitDate =
    event.hour === "bmo" ? eeDate : shiftTradingDays(eeDate, EXIT_DAYS_AFTER);

  const baseline: StraddleCyclePnl = {
    earningsDate: eeDate,
    hour: event.hour,
    entryDate,
    exitDate,
    entryPrice: null,
    exitPrice: null,
    pnlDollar: null,
    roiPct: null,
    underlyingMove: null,
    skipReason: null,
  };

  // Underlying prices at entry + exit — used to (a) pick ATM strike
  // and (b) report the realized move.
  const allDates = [...underlyingBars.keys()].sort();
  const findClose = (target: string): number | null => {
    if (underlyingBars.has(target)) return underlyingBars.get(target)!;
    // Backtrack to nearest preceding trading day (handles holidays).
    let idx = allDates.length - 1;
    while (idx >= 0 && allDates[idx] > target) idx--;
    return idx >= 0 ? underlyingBars.get(allDates[idx]) ?? null : null;
  };
  const entrySpot = findClose(entryDate);
  const exitSpot = findClose(exitDate);
  if (entrySpot == null || exitSpot == null) {
    return { ...baseline, skipReason: "No underlying bars in window" };
  }
  baseline.underlyingMove = ((exitSpot - entrySpot) / entrySpot) * 100;

  // Pick an expiry. Project the current chain's cadence backwards to
  // construct a plausible historical contract symbol. Note: this uses
  // the CURRENT-listed expiry pattern only to find the right offset
  // from EE date (monthly/weekly cadences are sticky).
  if (currentExpiries.length === 0) {
    return { ...baseline, skipReason: "No current expiries" };
  }
  let pickExpiry: string | null = null;
  const todayMs = Date.now();
  for (const e of currentExpiries) {
    const t = new Date(`${e}T00:00:00Z`).getTime();
    const diffDays = (t - todayMs) / 86_400_000;
    if (diffDays >= MIN_EXPIRY_DAYS_AFTER_EE && diffDays <= MAX_EXPIRY_DAYS_AFTER_EE) {
      pickExpiry = e;
      break;
    }
  }
  if (!pickExpiry) {
    return { ...baseline, skipReason: "No expiry in 0-30d window" };
  }

  // Historical expiry heuristic: the next Friday at least 1 day AFTER
  // the past EE date. Weekly-expiry tickers (every major earnings
  // name) list a Friday-of-that-week expiry; if there is no Friday
  // listing that week, Polygon's contract aggregates will return empty
  // bars and we'll mark the cycle as missing-contract.
  //
  // The current-chain check above told us this ticker has SOMETHING in
  // the 0-30d window today — that's our confirmation the ticker DOES
  // list short-dated options. The projection back to the past EE uses
  // the weekly cadence.
  void pickExpiry; // currentExpiries was only used as the cadence check above
  const histExpiry = nextFridayAfter(eeDate);

  // ATM strike — closest to entry-day underlying close, snapped to
  // $1 grid (good enough for most names). High-priced stocks would
  // benefit from a $5 grid; we leave that nuance for V3.2.
  const atmStrike = Math.round(entrySpot);
  const callTicker = formatOpraTicker(ticker, histExpiry, "C", atmStrike);
  const putTicker = formatOpraTicker(ticker, histExpiry, "P", atmStrike);

  // Get entry + exit closes for both legs. One API call per leg per
  // date range — 2 calls total for the cycle (cheap).
  const fromIso = entryDate;
  const toIso = exitDate;
  let callBars: Map<string, number>;
  let putBars: Map<string, number>;
  try {
    [callBars, putBars] = await Promise.all([
      fetchOptionContractBars(callTicker, fromIso, toIso),
      fetchOptionContractBars(putTicker, fromIso, toIso),
    ]);
  } catch (err) {
    return {
      ...baseline,
      skipReason: `Contract bars: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const findContractClose = (
    bars: Map<string, number>,
    target: string,
    direction: "forward" | "backward",
  ): number | null => {
    if (bars.has(target)) return bars.get(target)!;
    const sorted = [...bars.keys()].sort();
    if (direction === "backward") {
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i] <= target) return bars.get(sorted[i])!;
      }
    } else {
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i] >= target) return bars.get(sorted[i])!;
      }
    }
    return null;
  };
  const callEntry = findContractClose(callBars, entryDate, "backward");
  const putEntry = findContractClose(putBars, entryDate, "backward");
  const callExit = findContractClose(callBars, exitDate, "forward");
  const putExit = findContractClose(putBars, exitDate, "forward");

  if (callEntry == null || putEntry == null) {
    return { ...baseline, skipReason: "Missing entry contract prices" };
  }
  if (callExit == null || putExit == null) {
    return { ...baseline, skipReason: "Missing exit contract prices" };
  }
  const entryPrice = callEntry + putEntry;
  const exitPrice = callExit + putExit;
  const pnlDollar = (exitPrice - entryPrice) * 100;
  const roiPct = entryPrice > 0 ? (pnlDollar / (entryPrice * 100)) * 100 : null;

  return {
    earningsDate: eeDate,
    hour: event.hour,
    entryDate,
    exitDate,
    entryPrice,
    exitPrice,
    pnlDollar,
    roiPct,
    underlyingMove: baseline.underlyingMove,
    skipReason: null,
  };
}

/** OPRA symbol formatter — matches Polygon's convention.
 *  e.g. AAPL 2025-01-17 C 150 → "O:AAPL250117C00150000".
 *  Strike is right-padded to 8 digits, last 3 are decimal places. */
function formatOpraTicker(
  underlying: string,
  expiry: string,
  type: "C" | "P",
  strike: number,
): string {
  const [y, m, d] = expiry.split("-");
  const yymmdd = `${y.slice(2)}${m}${d}`;
  const strikeStr = Math.round(strike * 1000)
    .toString()
    .padStart(8, "0");
  return `O:${underlying}${yymmdd}${type}${strikeStr}`;
}

/** Plain calendar-days shift (vs trading-days shift above). Kept for
 *  future strategy backtests (Condor/Breakout/Rush) that need
 *  multi-day windows. Marked void to silence the unused warning. */
function shiftCalendarDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
void shiftCalendarDays;

/** Next Friday strictly AFTER the given date. Weekly options expire
 *  on Fridays; for any past EE, this is the first listed weekly
 *  expiry available to trade through earnings. */
function nextFridayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon ... 5=Fri, 6=Sat
  let daysToAdd: number;
  if (dow < 5) daysToAdd = 5 - dow;
  else if (dow === 5) daysToAdd = 7;
  else daysToAdd = 6; // Saturday
  d.setUTCDate(d.getUTCDate() + daysToAdd);
  return d.toISOString().slice(0, 10);
}

/** Convenience wrapper for the cron — fetches everything we need
 *  (history + underlying bars), runs the backtest, returns the result. */
export async function backtestStraddleForTicker(
  ticker: string,
  maxCycles = 6,
): Promise<StraddleBacktest> {
  const events = await fetchEarningsHistory(ticker, maxCycles);
  if (events.length === 0) {
    return {
      cycles: [],
      avgRoiPct: null,
      winRate: null,
      wins: 0,
      losses: 0,
      cyclesUsed: 0,
      totalCycles: 0,
    };
  }
  const earliest = events[events.length - 1].date;
  const from = new Date(earliest);
  from.setUTCDate(from.getUTCDate() - 14);
  const today = new Date().toISOString().slice(0, 10);
  const { fetchUnderlyingDailyBars } = await import("@/lib/polygon");
  let bars = new Map<string, number>();
  try {
    bars = await fetchUnderlyingDailyBars(
      ticker,
      from.toISOString().slice(0, 10),
      today,
    );
  } catch {
    // Continue with empty bars — the cycle loop will mark each as skipped.
  }
  return backtestStraddle(ticker, events, bars);
}
