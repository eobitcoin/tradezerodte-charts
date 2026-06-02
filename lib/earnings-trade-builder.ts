/**
 * Build proposed option trades for each strategy from a ticker's
 * current snapshot. The math mirrors the backtest's strike-picking
 * rules so the "proposed trade" you see on the page matches what the
 * backtest actually simulated historically.
 *
 * Prices are ESTIMATES via Black-Scholes from the current ATM IV. They
 * approximate broker quotes well enough to plan position size and
 * expected cost; verify against the real chain (via BUILD → Risk Graph)
 * before sending an order.
 *
 * Inputs all come from EarningsTickerEntry, which is already on the page:
 *   - spot, atmIv, impliedMovePct (from the live snapshot)
 *   - earningsDate (drives expiry pick)
 *   - For Breakout: directional bias derived from the backtest's most
 *     recent decision (the last cycle's `direction` field).
 *
 * The expiry heuristic — first Friday strictly after the earnings date —
 * matches the backtest's historical expiry picker (`nextFridayAfter`).
 * In practice that's the weekly that covers the move and decays out a
 * few days post-EE.
 */

import { bsPriceGreeks } from "@/lib/black-scholes";
import type {
  EarningsBacktestStats,
  EarningsTickerEntry,
} from "@/lib/db/schema";

export interface ProposedTradeLeg {
  side: "buy" | "sell";
  type: "call" | "put";
  strike: number;
  /** Single-contract estimated mid price (per share — multiply by 100
   *  for per-contract dollars). */
  estPrice: number;
}

export interface ProposedTrade {
  strategy: "straddle" | "condor" | "breakout" | "rush";
  expiry: string;            // YYYY-MM-DD
  legs: ProposedTradeLeg[];
  /** Net debit (positive = pay) or credit (negative = collect), per
   *  spread, in dollars (= 100 × per-share net). */
  netDollar: number;
  /** Per-spread max loss in dollars. Only meaningful for defined-risk
   *  structures (condor); equals net debit for long single-leg/straddle. */
  maxLossDollar: number;
  /** One-line human description shown above the legs. */
  summary: string;
  /** Caveat string — always shown so users don't trust these prices
   *  blindly. */
  estimateCaveat: string;
}

const RISK_FREE_RATE = 0.04;
const RANGE_DTE_MIN = 0;
const RANGE_DTE_MAX = 30;

/** First Friday strictly after the given date — matches the backtest's
 *  historical expiry projection so the proposed trade can be compared
 *  apples-to-apples with the simulated cycles. */
function nextFridayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay();
  let add: number;
  if (dow < 5) add = 5 - dow;
  else if (dow === 5) add = 7;
  else add = 6;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

/** Days between two ISO dates (calendar, not trading). */
function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Snap to a plausible listed-strike grid by price tier — same logic
 *  the Condor backtest uses. */
function strikeStep(spot: number): number {
  if (spot < 25) return 0.5;
  if (spot < 100) return 1;
  if (spot < 250) return 2.5;
  return 5;
}
function snapStrike(target: number, step: number): number {
  return Math.round(target / step) * step;
}

/** BS price for one leg given today's date, expiry, strike, type, IV.
 *  We treat IV as already in decimal form (0.30 = 30%). */
function priceLeg(
  spot: number,
  strike: number,
  type: "call" | "put",
  ivDecimal: number,
  dteCalendarDays: number,
): number {
  const T = Math.max(1, dteCalendarDays) / 365;
  const out = bsPriceGreeks(type, {
    S: spot,
    K: strike,
    T,
    sigma: ivDecimal,
    r: RISK_FREE_RATE,
  });
  return Math.max(0.01, out.price);
}

const ESTIMATE_CAVEAT =
  "Prices are Black-Scholes estimates from current ATM IV. Verify in your broker before trading.";

// ---------------------------------------------------------------------------
// Straddle
// ---------------------------------------------------------------------------

export function proposeStraddleTrade(
  entry: EarningsTickerEntry,
): ProposedTrade | null {
  if (entry.spot == null || entry.atmIv == null) return null;
  const expiry = nextFridayAfter(entry.earningsDate);
  const today = new Date().toISOString().slice(0, 10);
  const dte = daysBetween(today, expiry);
  if (dte < RANGE_DTE_MIN || dte > RANGE_DTE_MAX) return null;

  const step = strikeStep(entry.spot);
  const atmStrike = snapStrike(entry.spot, step);
  const iv = entry.atmIv;

  const callPx = priceLeg(entry.spot, atmStrike, "call", iv, dte);
  const putPx = priceLeg(entry.spot, atmStrike, "put", iv, dte);
  const netPerShare = callPx + putPx;

  return {
    strategy: "straddle",
    expiry,
    legs: [
      { side: "buy", type: "call", strike: atmStrike, estPrice: callPx },
      { side: "buy", type: "put", strike: atmStrike, estPrice: putPx },
    ],
    netDollar: netPerShare * 100,
    maxLossDollar: netPerShare * 100,
    summary: `Long ${atmStrike} straddle · ${expiry} (${dte}d)`,
    estimateCaveat: ESTIMATE_CAVEAT,
  };
}

// ---------------------------------------------------------------------------
// Condor
// ---------------------------------------------------------------------------

export function proposeCondorTrade(
  entry: EarningsTickerEntry,
): ProposedTrade | null {
  if (entry.spot == null || entry.atmIv == null || entry.impliedMovePct == null)
    return null;
  const expiry = nextFridayAfter(entry.earningsDate);
  const today = new Date().toISOString().slice(0, 10);
  const dte = daysBetween(today, expiry);
  if (dte < RANGE_DTE_MIN || dte > RANGE_DTE_MAX) return null;

  const step = strikeStep(entry.spot);
  const ivWidth = entry.spot * (entry.impliedMovePct / 100);
  const wingWidth = Math.max(ivWidth * 0.5, step * 2);

  const shortPutK = snapStrike(entry.spot - ivWidth, step);
  const longPutK = snapStrike(shortPutK - wingWidth, step);
  const shortCallK = snapStrike(entry.spot + ivWidth, step);
  const longCallK = snapStrike(shortCallK + wingWidth, step);

  if (
    shortPutK <= longPutK ||
    longCallK <= shortCallK ||
    longPutK <= 0
  ) {
    return null;
  }

  const iv = entry.atmIv;
  const shortPutPx = priceLeg(entry.spot, shortPutK, "put", iv, dte);
  const longPutPx = priceLeg(entry.spot, longPutK, "put", iv, dte);
  const shortCallPx = priceLeg(entry.spot, shortCallK, "call", iv, dte);
  const longCallPx = priceLeg(entry.spot, longCallK, "call", iv, dte);

  const creditPerShare =
    shortPutPx + shortCallPx - longPutPx - longCallPx;
  if (creditPerShare <= 0) return null;
  const realWingWidth = Math.max(
    shortPutK - longPutK,
    longCallK - shortCallK,
  );
  const maxLossPerShare = realWingWidth - creditPerShare;
  if (maxLossPerShare <= 0) return null;

  return {
    strategy: "condor",
    expiry,
    legs: [
      { side: "buy", type: "put", strike: longPutK, estPrice: longPutPx },
      { side: "sell", type: "put", strike: shortPutK, estPrice: shortPutPx },
      { side: "sell", type: "call", strike: shortCallK, estPrice: shortCallPx },
      { side: "buy", type: "call", strike: longCallK, estPrice: longCallPx },
    ],
    netDollar: -creditPerShare * 100,
    maxLossDollar: maxLossPerShare * 100,
    summary: `Short iron condor ${longPutK}/${shortPutK} – ${shortCallK}/${longCallK} · ${expiry} (${dte}d)`,
    estimateCaveat: ESTIMATE_CAVEAT,
  };
}

// ---------------------------------------------------------------------------
// Breakout
// ---------------------------------------------------------------------------

/**
 * Determine which direction to bet on the upcoming earnings using the
 * SAME rolling-window logic the backtest used. We re-derive from the
 * cycles' historical pricePctChange — but for the upcoming (not-yet-
 * occurred) EE, that means ALL cycles in the history.
 *
 * Returns null if the prior mean falls in the neutral band — the
 * backtest's "no clear bias" skip condition. In that case there is
 * no Breakout trade to propose.
 */
function breakoutDirection(
  stats: EarningsBacktestStats | undefined,
): "bullish" | "bearish" | null {
  if (!stats || stats.cycles.length === 0) return null;
  const moves = stats.cycles
    .map((c) => c.underlyingMove)
    .filter((m): m is number => typeof m === "number");
  if (moves.length < 2) return null;
  const mean = moves.reduce((s, x) => s + x, 0) / moves.length;
  if (Math.abs(mean) < 0.5) return null;
  return mean > 0 ? "bullish" : "bearish";
}

export function proposeBreakoutTrade(
  entry: EarningsTickerEntry,
): ProposedTrade | null {
  if (entry.spot == null || entry.atmIv == null) return null;
  const dir = breakoutDirection(entry.backtests?.breakout);
  if (dir == null) return null;
  const expiry = nextFridayAfter(entry.earningsDate);
  const today = new Date().toISOString().slice(0, 10);
  const dte = daysBetween(today, expiry);
  if (dte < RANGE_DTE_MIN || dte > RANGE_DTE_MAX) return null;

  const step = strikeStep(entry.spot);
  const atmStrike = snapStrike(entry.spot, step);
  const type: "call" | "put" = dir === "bullish" ? "call" : "put";
  const px = priceLeg(entry.spot, atmStrike, type, entry.atmIv, dte);

  return {
    strategy: "breakout",
    expiry,
    legs: [{ side: "buy", type, strike: atmStrike, estPrice: px }],
    netDollar: px * 100,
    maxLossDollar: px * 100,
    summary: `Long ${atmStrike} ${type} (${dir}) · ${expiry} (${dte}d)`,
    estimateCaveat: ESTIMATE_CAVEAT,
  };
}

// ---------------------------------------------------------------------------
// Rush — long ATM straddle, longer-dated expiry, EXIT BEFORE EE
// ---------------------------------------------------------------------------
//
// Same leg structure as Straddle (ATM call + put) but with a key
// difference: the expiry is the first Friday at least 21 calendar days
// after the earnings date. Short-dated weeklies have tiny vega — Rush
// needs a longer-dated contract for the IV ramp to outweigh theta.
//
// The "exit before EE" rule isn't encoded in the proposed-trade card
// itself (the card is just the structure to enter). The summary text
// reminds the trader to exit before the announcement.

function fridayAtLeastAfter(iso: string, minDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + minDays);
  const dow = d.getUTCDay();
  const add = dow <= 5 ? 5 - dow : 6;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

const RUSH_MIN_DAYS_TO_EXPIRY = 21;
const RUSH_DTE_MIN = 7;     // would skip if EE is too close (no room for ramp)
const RUSH_DTE_MAX = 90;

export function proposeRushTrade(
  entry: EarningsTickerEntry,
): ProposedTrade | null {
  if (entry.spot == null || entry.atmIv == null) return null;
  const expiry = fridayAtLeastAfter(entry.earningsDate, RUSH_MIN_DAYS_TO_EXPIRY);
  const today = new Date().toISOString().slice(0, 10);
  const dte = daysBetween(today, expiry);
  if (dte < RUSH_DTE_MIN || dte > RUSH_DTE_MAX) return null;

  const step = strikeStep(entry.spot);
  const atmStrike = snapStrike(entry.spot, step);
  const iv = entry.atmIv;

  const callPx = priceLeg(entry.spot, atmStrike, "call", iv, dte);
  const putPx = priceLeg(entry.spot, atmStrike, "put", iv, dte);
  const netPerShare = callPx + putPx;

  return {
    strategy: "rush",
    expiry,
    legs: [
      { side: "buy", type: "call", strike: atmStrike, estPrice: callPx },
      { side: "buy", type: "put", strike: atmStrike, estPrice: putPx },
    ],
    netDollar: netPerShare * 100,
    maxLossDollar: netPerShare * 100,
    summary: `Long ${atmStrike} straddle · ${expiry} (${dte}d) — EXIT BEFORE EE on ${entry.earningsDate}`,
    estimateCaveat: ESTIMATE_CAVEAT,
  };
}

// ---------------------------------------------------------------------------
// URL encoding for Risk Graph hand-off
// ---------------------------------------------------------------------------
//
// The Earnings Scans BUILD button drops the user into Risk Graph with
// the proposed trade pre-loaded. We encode the trade as URL query
// params so the destination page can rebuild the position once it
// fetches the live chain.
//
// Format:
//   ?ticker=AAPL
//    &prefillStrategy=condor
//    &prefillExpiry=2026-06-06
//    &prefillLegs=L-P-420,S-P-430,S-C-450,L-C-460
//
// Each leg is `side-type-strike` where:
//   side  = L (buy / long) | S (sell / short)
//   type  = C (call) | P (put)
//   strike = decimal number
//
// Compact enough for clean URLs, readable enough to debug from the
// browser bar, and forward-compatible (extra params are ignored).

export interface PrefillLeg {
  side: "buy" | "sell";
  type: "call" | "put";
  strike: number;
  /** Per-leg expiry override. Used by calendar/diagonal spreads where
   *  legs sit on DIFFERENT expiries. When undefined, the leg uses the
   *  payload's top-level `expiry`. Format: YYYY-MM-DD. */
  expiry?: string;
}

export interface PrefillPayload {
  /** Free-form label for the banner ("condor", "leap", "iv-anomaly",
   *  etc). Display-only — no behavior keyed off it. */
  strategy: string;
  expiry: string;
  legs: PrefillLeg[];
}

/** Generic encoder used by every source that hands off to Risk Graph
 *  (earnings scans, LEAPs, options edge anomalies, calendars, future
 *  surfaces). Returns a query-string fragment (no leading "?").
 *
 *  Leg format: `<side>-<type>-<strike>` (uses payload `expiry`) or
 *  `<side>-<type>-<strike>@<expiry>` (per-leg override). Calendars and
 *  diagonals use the per-leg form so the sell + buy legs land on
 *  different months. */
export function legsToUrlParams(opts: {
  ticker: string;
  strategy: string;
  expiry: string;
  legs: PrefillLeg[];
}): string {
  const legsStr = opts.legs
    .map((l) => {
      const side = l.side === "buy" ? "L" : "S";
      const type = l.type === "call" ? "C" : "P";
      const base = `${side}-${type}-${l.strike}`;
      return l.expiry ? `${base}@${l.expiry}` : base;
    })
    .join(",");
  const qs = new URLSearchParams({
    ticker: opts.ticker,
    prefillStrategy: opts.strategy,
    prefillExpiry: opts.expiry,
    prefillLegs: legsStr,
  });
  return qs.toString();
}

/** Convenience: encode a full ProposedTrade for the Risk Graph BUILD
 *  link. Thin wrapper over `legsToUrlParams`. */
export function tradeToUrlParams(
  trade: ProposedTrade,
  ticker: string,
): string {
  return legsToUrlParams({
    ticker,
    strategy: trade.strategy,
    expiry: trade.expiry,
    legs: trade.legs,
  });
}

/** Parse the URL-encoded prefill payload. Returns null if the params
 *  are missing or malformed (no error — caller proceeds with a blank
 *  builder). Strategy is accepted as any non-empty string. */
export function urlParamsToPrefill(
  searchParams: URLSearchParams,
): PrefillPayload | null {
  const strategy = searchParams.get("prefillStrategy");
  const expiry = searchParams.get("prefillExpiry");
  const legsStr = searchParams.get("prefillLegs");
  if (!strategy || !expiry || !legsStr) return null;
  const legs: PrefillLeg[] = [];
  for (const part of legsStr.split(",")) {
    // Parse optional `@expiry` suffix. e.g. `S-C-320@2026-07-02`.
    let core = part;
    let legExpiry: string | undefined;
    const atIdx = part.indexOf("@");
    if (atIdx > -1) {
      core = part.slice(0, atIdx);
      legExpiry = part.slice(atIdx + 1);
    }
    const [sideS, typeS, strikeS] = core.split("-");
    if (!sideS || !typeS || !strikeS) return null;
    const side = sideS === "L" ? "buy" : sideS === "S" ? "sell" : null;
    const type = typeS === "C" ? "call" : typeS === "P" ? "put" : null;
    const strike = Number(strikeS);
    if (!side || !type || !Number.isFinite(strike)) return null;
    legs.push({ side, type, strike, expiry: legExpiry });
  }
  if (legs.length === 0) return null;
  return { strategy, expiry, legs };
}

// ---------------------------------------------------------------------------
// Generic dispatcher
// ---------------------------------------------------------------------------

export function proposeTrade(
  entry: EarningsTickerEntry,
  strategy: "straddle" | "condor" | "breakout" | "rush",
): ProposedTrade | null {
  switch (strategy) {
    case "straddle":
      return proposeStraddleTrade(entry);
    case "condor":
      return proposeCondorTrade(entry);
    case "breakout":
      return proposeBreakoutTrade(entry);
    case "rush":
      return proposeRushTrade(entry);
  }
}
