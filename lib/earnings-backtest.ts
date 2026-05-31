/**
 * Earnings backtest engine.
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
 * Phase coverage:
 *   V3.1 — Straddle      (shipped)
 *   V3.2 — Iron Condor   (this file)
 *   V3.3 — Breakout      (pending)
 *   V3.4 — Earnings Rush (pending)
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

// ---------------------------------------------------------------------------
// V3.2 — Iron Condor backtest
// ---------------------------------------------------------------------------
//
// Strategy: short an iron condor sized to current implied move.
//   short put  at 1.0× implied move OTM
//   long  put  at 1.5× implied move OTM (the put-side wing)
//   short call at 1.0× implied move OTM
//   long  call at 1.5× implied move OTM (the call-side wing)
//
// Entry: same as straddle (4 trading days pre-EE — sell into IV ramp).
// Exit:  same as straddle (1 trading day post-EE — close after IV crush).
//
// ROI denominator is MAX LOSS, not entry credit. A credit-spread's ROI
// is meaningful only against capital at risk:
//   max_loss = wing_width − net_credit
//   roi      = (entry_credit − exit_debit) / max_loss
//
// Wing width assumption: we force PUT-side and CALL-side wing widths to
// be equal — that's the standard iron-condor construction and keeps the
// max-loss math symmetric.

export interface CondorCyclePnl {
  earningsDate: string;
  hour: "bmo" | "amc" | "dmh";
  entryDate: string;
  exitDate: string;
  /** Net credit received per spread (per share). */
  entryPrice: number | null;
  /** Net debit paid to close per spread (per share). */
  exitPrice: number | null;
  /** Per-spread P&L in dollars (= 100 × (credit − debit)). */
  pnlDollar: number | null;
  /** P&L / max loss × 100. Negative if losing. */
  roiPct: number | null;
  underlyingMove: number | null;
  skipReason: string | null;
}

export interface CondorBacktest {
  cycles: CondorCyclePnl[];
  avgRoiPct: number | null;
  winRate: number | null;
  wins: number;
  losses: number;
  cyclesUsed: number;
  totalCycles: number;
}

/** Strike grid step inferred from underlying price. Matches what
 *  Polygon's chain typically lists for each price tier. Used to snap
 *  computed strikes to plausible listed strikes. */
function strikeStep(spot: number): number {
  if (spot < 25) return 0.5;
  if (spot < 100) return 1;
  if (spot < 250) return 2.5;
  return 5;
}

function snapStrike(target: number, step: number): number {
  return Math.round(target / step) * step;
}

export async function backtestCondor(
  ticker: string,
  events: FinnhubEarningsEvent[],
  underlyingBars: Map<string, number>,
  impliedMovePct: number | null,
): Promise<CondorBacktest> {
  // Without current implied move we can't size strikes — bail early so
  // we don't waste API calls fetching contracts we'd then skip.
  if (impliedMovePct == null || impliedMovePct <= 0) {
    return {
      cycles: events.map((ev) => ({
        earningsDate: ev.date,
        hour: ev.hour,
        entryDate: "",
        exitDate: "",
        entryPrice: null,
        exitPrice: null,
        pnlDollar: null,
        roiPct: null,
        underlyingMove: null,
        skipReason: "No implied move — can't size condor strikes",
      })),
      avgRoiPct: null,
      winRate: null,
      wins: 0,
      losses: 0,
      cyclesUsed: 0,
      totalCycles: events.length,
    };
  }

  let expiries: string[] = [];
  try {
    const chain = await fetchOptionChain(ticker);
    expiries = [...new Set(chain.map((c) => c.details.expiration_date))].sort();
  } catch {
    // Same fallback path as straddle — empty expiries → cycles all skip.
  }

  const cycles: CondorCyclePnl[] = [];
  for (const ev of events) {
    const cycle = await backtestCondorOneCycle(
      ticker,
      ev,
      underlyingBars,
      expiries,
      impliedMovePct,
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

async function backtestCondorOneCycle(
  ticker: string,
  event: FinnhubEarningsEvent,
  underlyingBars: Map<string, number>,
  currentExpiries: string[],
  impliedMovePct: number,
): Promise<CondorCyclePnl> {
  const eeDate = event.date;
  const entryDate = shiftTradingDays(eeDate, -ENTRY_DAYS_BEFORE);
  const exitDate =
    event.hour === "bmo" ? eeDate : shiftTradingDays(eeDate, EXIT_DAYS_AFTER);

  const baseline: CondorCyclePnl = {
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

  const allDates = [...underlyingBars.keys()].sort();
  const findClose = (target: string): number | null => {
    if (underlyingBars.has(target)) return underlyingBars.get(target)!;
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

  if (currentExpiries.length === 0) {
    return { ...baseline, skipReason: "No current expiries" };
  }
  const histExpiry = nextFridayAfter(eeDate);

  // Strike sizing: implied move width × spot. Inner shorts at 1.0×,
  // outer longs at 1.5× — i.e. wing width = 0.5× implied move.
  // Enforce minimum 2-step wings so tight strike grids don't collapse.
  const step = strikeStep(entrySpot);
  const ivWidth = entrySpot * (impliedMovePct / 100);
  const wingWidthDollars = Math.max(ivWidth * 0.5, step * 2);

  const shortPutStrike = snapStrike(entrySpot - ivWidth, step);
  const longPutStrike = snapStrike(shortPutStrike - wingWidthDollars, step);
  const shortCallStrike = snapStrike(entrySpot + ivWidth, step);
  const longCallStrike = snapStrike(shortCallStrike + wingWidthDollars, step);

  // Sanity: ensure short < long on call side, short > long on put side
  // after snapping (rounding can collapse them on cheap stocks).
  if (
    shortPutStrike <= longPutStrike ||
    longCallStrike <= shortCallStrike ||
    shortPutStrike <= 0 ||
    longPutStrike <= 0
  ) {
    return { ...baseline, skipReason: "Strikes collapsed after snap" };
  }

  const tickers = {
    shortPut: formatOpraTicker(ticker, histExpiry, "P", shortPutStrike),
    longPut: formatOpraTicker(ticker, histExpiry, "P", longPutStrike),
    shortCall: formatOpraTicker(ticker, histExpiry, "C", shortCallStrike),
    longCall: formatOpraTicker(ticker, histExpiry, "C", longCallStrike),
  };

  let bars: Record<keyof typeof tickers, Map<string, number>>;
  try {
    const [sp, lp, sc, lc] = await Promise.all([
      fetchOptionContractBars(tickers.shortPut, entryDate, exitDate),
      fetchOptionContractBars(tickers.longPut, entryDate, exitDate),
      fetchOptionContractBars(tickers.shortCall, entryDate, exitDate),
      fetchOptionContractBars(tickers.longCall, entryDate, exitDate),
    ]);
    bars = { shortPut: sp, longPut: lp, shortCall: sc, longCall: lc };
  } catch (err) {
    return {
      ...baseline,
      skipReason: `Contract bars: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const findContractClose = (
    barMap: Map<string, number>,
    target: string,
    direction: "forward" | "backward",
  ): number | null => {
    if (barMap.has(target)) return barMap.get(target)!;
    const sorted = [...barMap.keys()].sort();
    if (direction === "backward") {
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i] <= target) return barMap.get(sorted[i])!;
      }
    } else {
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i] >= target) return barMap.get(sorted[i])!;
      }
    }
    return null;
  };

  const entryPrices = {
    shortPut: findContractClose(bars.shortPut, entryDate, "backward"),
    longPut: findContractClose(bars.longPut, entryDate, "backward"),
    shortCall: findContractClose(bars.shortCall, entryDate, "backward"),
    longCall: findContractClose(bars.longCall, entryDate, "backward"),
  };
  const exitPrices = {
    shortPut: findContractClose(bars.shortPut, exitDate, "forward"),
    longPut: findContractClose(bars.longPut, exitDate, "forward"),
    shortCall: findContractClose(bars.shortCall, exitDate, "forward"),
    longCall: findContractClose(bars.longCall, exitDate, "forward"),
  };

  if (
    Object.values(entryPrices).some((p) => p == null) ||
    Object.values(exitPrices).some((p) => p == null)
  ) {
    return { ...baseline, skipReason: "Missing some leg prices" };
  }

  // Credit at entry: sell shorts, buy longs.
  const entryCredit =
    (entryPrices.shortPut! + entryPrices.shortCall!) -
    (entryPrices.longPut! + entryPrices.longCall!);
  const exitDebit =
    (exitPrices.shortPut! + exitPrices.shortCall!) -
    (exitPrices.longPut! + exitPrices.longCall!);

  if (entryCredit <= 0) {
    return { ...baseline, skipReason: "Entry credit ≤ 0 (degenerate condor)" };
  }
  const realWingWidth = Math.max(
    shortPutStrike - longPutStrike,
    longCallStrike - shortCallStrike,
  );
  const maxLoss = realWingWidth - entryCredit;
  if (maxLoss <= 0) {
    return { ...baseline, skipReason: "Credit > wing width (impossible)" };
  }

  const pnlDollar = (entryCredit - exitDebit) * 100;
  const roiPct = (pnlDollar / (maxLoss * 100)) * 100;

  return {
    earningsDate: eeDate,
    hour: event.hour,
    entryDate,
    exitDate,
    entryPrice: entryCredit,
    exitPrice: exitDebit,
    pnlDollar,
    roiPct,
    underlyingMove: baseline.underlyingMove,
    skipReason: null,
  };
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
