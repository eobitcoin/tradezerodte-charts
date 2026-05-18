/**
 * Build a `MarketState` (the same shape the sandbox uses) from live Tradier
 * data — quote + intraday bars.
 *
 * Phase 3a scope: underlying-only. Option mid (needed for premium_pct_*
 * predicates and the §6.5 live-mid risk re-check) waits for Phase 3b.
 *
 * Bar-pattern detection (VWAP rejection, etc.) is conservative: we only mark
 * a flag true when the bar's signal is unambiguous, so the bot never fires
 * on a "maybe." False > false-positive every time when there's money at
 * stake. The exact heuristics live in `detectVwapRejection*()` and are
 * intentionally simple — refine after we've seen them run against real
 * intraday data for a few days.
 */

import type { BotMode } from "@/lib/db/schema";
import { getQuotes, getTimesales, type TradierBar } from "./tradier-adapter";
import type { MarketState } from "./evaluator";

/** America/New_York "YYYY-MM-DD HH:MM" using Intl — no extra deps. */
function nowInEt(): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * Session VWAP from intraday bars. Tradier already provides per-bar VWAP on
 * timesales, so the session value is just the volume-weighted average of
 * those bar VWAPs (or typical price as fallback). Returns null if there's
 * no usable data (e.g. pre-market with zero bars).
 */
function sessionVwap(bars: TradierBar[]): number | null {
  let pv = 0;
  let v = 0;
  for (const b of bars) {
    const px = b.vwap ?? (b.high + b.low + b.close) / 3;
    if (!Number.isFinite(px) || !Number.isFinite(b.volume) || b.volume <= 0) continue;
    pv += px * b.volume;
    v += b.volume;
  }
  return v > 0 ? pv / v : null;
}

/**
 * "Did the most recent closed bar tag VWAP from above, then close below it?"
 *
 *   - bar.high >= sessionVwap                 (touched the line)
 *   - bar.close < sessionVwap                 (closed back below)
 *   - close < open (just to be conservative — direction agrees)
 *
 * Same logic mirrored for the long side.
 */
function detectVwapRejectionShort(latest: TradierBar | undefined, vwap: number | null): boolean {
  if (!latest || vwap == null) return false;
  return latest.high >= vwap && latest.close < vwap && latest.close < latest.open;
}

function detectVwapRejectionLong(latest: TradierBar | undefined, vwap: number | null): boolean {
  if (!latest || vwap == null) return false;
  return latest.low <= vwap && latest.close > vwap && latest.close > latest.open;
}

export type BuildMarketStateResult =
  | { ok: true; state: MarketState; barCount: number; sessionPhase: SessionPhase }
  | { ok: false; code: string; reason: string };

/** Where we are in the trading day. Drives whether we fetch bars. */
export type SessionPhase = "pre_market" | "rth" | "after_hours";

function classifySession(nowEt: string): SessionPhase {
  if (nowEt < "09:30") return "pre_market";
  if (nowEt > "16:00") return "after_hours";
  return "rth";
}

export async function buildMarketState(args: {
  mode: BotMode;
  ticker: string;
}): Promise<BuildMarketStateResult> {
  const { mode, ticker } = args;

  // Quote → last price (and ultimately bid/ask once we add live-mid checks).
  const quoteRes = await getQuotes(mode, [ticker]);
  if (!quoteRes.ok) return { ok: false, code: quoteRes.code, reason: quoteRes.reason };
  const q = quoteRes.data[0];
  if (!q || q.last == null) {
    return { ok: false, code: "no_quote", reason: `Tradier returned no quote for ${ticker}` };
  }

  const { date, time } = nowInEt();
  const sessionPhase = classifySession(time);

  // Bar fetch is only meaningful during/after RTH. Before 9:30 ET the
  // request would be inverted (start > end) → Tradier 400. We short-circuit
  // and return a quote-only state; the evaluator's `bar_close_*` predicates
  // will surface "no 5min bar yet" and no signal will fire, which is the
  // correct behavior for pre-market.
  let bars: TradierBar[] = [];
  if (sessionPhase !== "pre_market") {
    const startEt = `${date} 09:30`;
    const endEt = `${date} ${time}`;
    const barsRes = await getTimesales(mode, {
      symbol: ticker,
      interval: "5min",
      startEt,
      endEt,
    });
    if (!barsRes.ok) return { ok: false, code: barsRes.code, reason: barsRes.reason };
    bars = barsRes.data;
  }

  // The most recent bar may be the *open* bar (still ticking). Tradier
  // includes it; we exclude it from "lastBars" because the predicates ask
  // for closed bars. Heuristic: if the bar's time string equals current ET
  // minute floor-to-5, drop it.
  const closedBars = dropOpenBar(bars, time);
  const last5 = closedBars[closedBars.length - 1];

  const vwap = sessionVwap(closedBars);

  const state: MarketState = {
    ticker: ticker.toUpperCase(),
    lastPrice: q.last,
    sessionVwap: vwap,
    lastBars: last5
      ? { "5min": { close: last5.close, high: last5.high, low: last5.low } }
      : {},
    vwapRejectionShort: detectVwapRejectionShort(last5, vwap),
    vwapRejectionLong: detectVwapRejectionLong(last5, vwap),
    nowEt: time,
    // entryFill / currentMid intentionally undefined here — Phase 3b adds
    // option quotes; until then the exit predicates that need them stay
    // indeterminate (which the evaluator handles).
  };

  return { ok: true, state, barCount: closedBars.length, sessionPhase };
}

/**
 * Tradier's 5-min timesales includes a bar whose `time` is the *start* of
 * the current minute window. If "now" is 10:32, the 10:30 bar is still open
 * (closes at 10:35). Drop it conservatively: any bar whose start is within
 * `tf` minutes of `now` is treated as "open."
 */
function dropOpenBar(bars: TradierBar[], nowHHMM: string): TradierBar[] {
  if (bars.length === 0) return bars;
  const last = bars[bars.length - 1];
  if (!last.time) return bars;
  const lastHHMM = last.time.slice(-5); // "YYYY-MM-DD HH:MM" → "HH:MM"
  const [lh, lm] = lastHHMM.split(":").map(Number);
  const [nh, nm] = nowHHMM.split(":").map(Number);
  const lastMin = lh * 60 + lm;
  const nowMin = nh * 60 + nm;
  return nowMin - lastMin < 5 ? bars.slice(0, -1) : bars;
}
