/**
 * ALMA × VWAP backtest replay engine.
 *
 * For each ticker × trading day in the requested date range:
 *
 *   1. Pull historical 5-min bars (RTH only) via Tradier timesales.
 *   2. Walk bars in order. For each closed bar i (≥ 10 bars deep so ALMA is
 *      defined for i and i-1), compute:
 *        - ALMA(9, 6, 0.85) at i and i-1
 *        - Session VWAP at i and i-1 (volume-weighted, same logic as live)
 *        - Cross detection
 *        - Steepness vs threshold
 *      → If both: emit "armed" event for that bar (READY state begins).
 *   3. Subsequent bars (while READY): check pullback condition. On first
 *      pullback, emit "signal" event with:
 *        - signalAt time, side, underlyingAtSignal (bar close)
 *        - nearest OTM strike from a synthetic grid (5/2.5/1-dollar steps
 *          depending on price magnitude)
 *   4. After signal fires, look forward at remaining bars in the same day:
 *        - touched = did any bar's high/low cross the OTM strike?
 *        - maxFavorablePct / maxAdversePct in underlying terms
 *        - timeToTouchMin = minutes until first strike-touch
 *      Outcome attributed to the option: "touched" ≈ option had intrinsic
 *      value at expiry; "not touched" ≈ option expired worthless.
 *   5. Move to next bar (re-check for fresh crosses). Each ticker emits at
 *      most a few signals per day.
 *
 * Synthetic OTM grid is used because we don't have historical option chain
 * data. Reasonable grid sizing:
 *   - $1 step for prices < $50
 *   - $2.50 step for prices < $200
 *   - $5 step for prices ≥ $200
 * That mirrors how SPY/QQQ/large-cap chains actually look.
 *
 * Output: one row per detected signal, plus enough context to reconstruct
 * the decision later. The metrics module aggregates these into the summary.
 */

import { getTimesales, type TradierBar } from "../tradier-adapter";
import type { BotMode } from "@/lib/db/schema";
import {
  computeAlmaAt,
  detectCross,
  isPullback,
  isSteepInDirection,
  slopePctPerBar,
} from "../alma";
import { simulatePolicy, type PolicyParams, type PolicyResult } from "./policy";

const ALMA_LENGTH = 9;
const REQUIRED_BARS = ALMA_LENGTH + 1;

export type BacktestSignal = {
  ticker: string;
  day: string; // YYYY-MM-DD
  side: "long" | "short";
  /** ET timestamp the signal fired (5-min bar close). */
  signalAt: string;
  /** "HH:MM" ET helper for UI density. */
  signalEt: string;
  /** ALMA and VWAP at the bar that triggered the cross. */
  almaAtCross: number;
  vwapAtCross: number;
  slopePctAtCross: number;
  /** Underlying close at the signal bar. */
  underlyingAtSignal: number;
  /** Strike chosen — nearest OTM rounded to the synthetic grid step. */
  otmStrike: number;
  /** Did underlying ever cross the strike before close? */
  touched: boolean;
  /** Best move (% of underlying) in the favourable direction after signal. */
  maxFavorablePct: number;
  /** Worst move (% of underlying) in the adverse direction after signal. */
  maxAdversePct: number;
  /** Minutes from signal to the bar that first touched the strike (or null). */
  timeToTouchMin: number | null;
  /** How many forward bars we looked at (RTH bars remaining in day). */
  forwardBars: number;
  /** Exit policy simulation (option P&L estimate). null only on legacy rows. */
  policy: PolicyResult | null;
};

export type ReplayArgs = {
  mode: BotMode;
  tickers: string[];
  fromDay: string; // YYYY-MM-DD inclusive
  toDay: string; // YYYY-MM-DD inclusive
  slopePct: number;
  /** Exit policy applied to each fired signal to estimate option P&L. */
  policy: PolicyParams;
  /** Cool-down window (bars) where close-below-VWAP doesn't clear READY. */
  coolDownBars: number;
  /** Max wick depth beyond ALMA (% of ALMA) that still counts as a pullback. */
  pullbackThresholdPct: number;
};

export type ReplayResult = {
  ok: true;
  signals: BacktestSignal[];
  perTickerErrors: { ticker: string; day: string; reason: string }[];
};

// ---------------------------------------------------------------------------
// OTM grid + VWAP utilities
// ---------------------------------------------------------------------------

function gridStep(price: number): number {
  if (price < 50) return 1;
  if (price < 200) return 2.5;
  return 5;
}

function nearestOtm(price: number, side: "long" | "short"): number {
  const step = gridStep(price);
  if (side === "long") {
    // Calls — strike above current price
    return Math.ceil((price + 0.0001) / step) * step;
  }
  // Puts — strike below current price
  return Math.floor((price - 0.0001) / step) * step;
}

function vwapUpTo(bars: TradierBar[], endIdx: number): number | null {
  let pv = 0;
  let v = 0;
  for (let i = 0; i <= endIdx; i++) {
    const b = bars[i];
    const px = b.vwap ?? (b.high + b.low + b.close) / 3;
    if (!Number.isFinite(px) || !Number.isFinite(b.volume) || b.volume <= 0) continue;
    pv += px * b.volume;
    v += b.volume;
  }
  return v > 0 ? pv / v : null;
}

function etDateList(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  const from = new Date(`${fromDay}T12:00:00Z`);
  const to = new Date(`${toDay}T12:00:00Z`);
  for (let d = from.getTime(); d <= to.getTime(); d += 24 * 60 * 60 * 1000) {
    const day = new Date(d);
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

/** "YYYY-MM-DD" + "HH:MM" in America/New_York for "now". */
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

function barEtTime(bar: TradierBar): string {
  // Tradier returns "YYYY-MM-DD HH:MM" in ET.
  if (!bar.time) return "";
  return bar.time.slice(-5);
}

// ---------------------------------------------------------------------------
// Per-day single-ticker replay
// ---------------------------------------------------------------------------

async function replayDay(args: {
  mode: BotMode;
  ticker: string;
  day: string;
  slopePct: number;
  policy: PolicyParams;
  coolDownBars: number;
  pullbackThresholdPct: number;
}): Promise<{ signals: BacktestSignal[]; error?: string }> {
  const { mode, ticker, day, slopePct, policy, coolDownBars, pullbackThresholdPct } = args;

  // Tradier rejects `end > now` with 400. Cap endEt at the current ET time
  // when `day` is today, and skip days that are either in the future or
  // pre-market on today.
  const { date: todayDate, time: nowTime } = nowInEt();
  let endHHMM = "16:00";
  if (day > todayDate) {
    return { signals: [], error: "future date — no bars yet" };
  }
  if (day === todayDate) {
    if (nowTime < "09:30") {
      return { signals: [], error: "today is pre-market — no bars yet" };
    }
    endHHMM = nowTime < "16:00" ? nowTime : "16:00";
  }

  const barsRes = await getTimesales(mode, {
    symbol: ticker,
    interval: "5min",
    startEt: `${day} 09:30`,
    endEt: `${day} ${endHHMM}`,
  });
  if (!barsRes.ok) return { signals: [], error: barsRes.reason };
  const bars = barsRes.data;
  if (bars.length < REQUIRED_BARS) return { signals: [] }; // not enough bars (holiday / new listing)

  const closes = bars.map((b) => b.close);
  const signals: BacktestSignal[] = [];

  // Track READY per side as we walk forward. Mirrors live strategy:
  //   - cross sets READY + records the cross bar index for cool-down accounting
  //   - during cool-down (first N bars after arm), close re-cross is tolerated
  //   - after cool-down, close re-cross clears READY
  //   - pullback fires once per day, with band tolerance for wick depth
  let ready:
    | { side: "long" | "short"; almaAtCross: number; vwapAtCross: number; slopeAt: number; armedAtIdx: number }
    | null = null;
  let firedThisDay = false; // one signal per ticker per day — simplifies metrics

  for (let i = ALMA_LENGTH; i < bars.length; i++) {
    const currAlma = computeAlmaAt(closes, i);
    const prevAlma = computeAlmaAt(closes, i - 1);
    if (currAlma == null || prevAlma == null) continue;
    const vwapCurr = vwapUpTo(bars, i);
    const vwapPrev = vwapUpTo(bars, i - 1);
    if (vwapCurr == null || vwapPrev == null) continue;

    // 1. Cross detection on this bar.
    const cross = detectCross(prevAlma, vwapPrev, currAlma, vwapCurr);
    const slope = slopePctPerBar(prevAlma, currAlma);

    if (cross) {
      const steep = isSteepInDirection(slope, cross, slopePct);
      const side: "long" | "short" = cross === "above" ? "long" : "short";
      if (steep) {
        ready = { side, almaAtCross: currAlma, vwapAtCross: vwapCurr, slopeAt: slope, armedAtIdx: i };
        // INTENTIONAL: do NOT `continue` here. Fall through to the pullback
        // check so a single bar that crosses VWAP and also wicks down to
        // ALMA fires entry on the same bar.
      } else if (ready && ready.side !== side) {
        // Wrong-side or non-steep cross clears any opposite READY.
        ready = null;
      }
    }

    // 2. Pullback check (only when armed and not yet fired this day).
    if (ready && !firedThisDay) {
      const bar = bars[i];
      const elapsed = i - ready.armedAtIdx;
      const inCoolDown = elapsed <= coolDownBars;
      // Close-still-holds: only enforced AFTER cool-down.
      const closeStillHolds =
        ready.side === "long" ? bar.close > vwapCurr : bar.close < vwapCurr;
      if (!inCoolDown && !closeStillHolds) {
        ready = null;
        continue;
      }
      const pull = isPullback({
        side: ready.side,
        bar: { high: bar.high, low: bar.low, close: bar.close },
        alma: currAlma,
        vwap: vwapCurr,
        thresholdPct: pullbackThresholdPct,
        requireCloseHolds: !inCoolDown,
      });
      if (!pull) continue;

      // Fire — compute forward outcome.
      const otmStrike = nearestOtm(bar.close, ready.side);
      const forwardBars = bars.slice(i + 1);
      let touched = false;
      let timeToTouchMin: number | null = null;
      let maxFav = 0;
      let maxAdv = 0;
      for (let j = 0; j < forwardBars.length; j++) {
        const f = forwardBars[j];
        // Excursions in underlying %, signed in the favourable direction.
        if (ready.side === "long") {
          const favPct = ((f.high - bar.close) / bar.close) * 100;
          const advPct = ((f.low - bar.close) / bar.close) * 100;
          if (favPct > maxFav) maxFav = favPct;
          if (advPct < maxAdv) maxAdv = advPct;
          if (!touched && f.high >= otmStrike) {
            touched = true;
            timeToTouchMin = (j + 1) * 5;
          }
        } else {
          const favPct = ((bar.close - f.low) / bar.close) * 100;
          const advPct = ((bar.close - f.high) / bar.close) * 100;
          if (favPct > maxFav) maxFav = favPct;
          if (advPct < maxAdv) maxAdv = advPct;
          if (!touched && f.low <= otmStrike) {
            touched = true;
            timeToTouchMin = (j + 1) * 5;
          }
        }
      }

      // Apply configured exit policy to the forward window to estimate option P&L.
      const policySim = simulatePolicy(
        { entryPrice: bar.close, side: ready.side, forwardBars },
        policy,
      );

      signals.push({
        ticker,
        day,
        side: ready.side,
        signalAt: bar.time ?? `${day} ?`,
        signalEt: barEtTime(bar),
        almaAtCross: round(ready.almaAtCross, 4),
        vwapAtCross: round(ready.vwapAtCross, 4),
        slopePctAtCross: round(ready.slopeAt, 4),
        underlyingAtSignal: round(bar.close, 4),
        otmStrike,
        touched,
        maxFavorablePct: round(maxFav, 3),
        maxAdversePct: round(maxAdv, 3),
        timeToTouchMin,
        forwardBars: forwardBars.length,
        policy: policySim,
      });
      firedThisDay = true;
      ready = null;
    }
  }

  return { signals };
}

function round(x: number, places: number): number {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}

// ---------------------------------------------------------------------------
// Top-level replay
// ---------------------------------------------------------------------------

export async function runReplay(args: ReplayArgs): Promise<ReplayResult> {
  const days = etDateList(args.fromDay, args.toDay);
  const signals: BacktestSignal[] = [];
  const perTickerErrors: ReplayResult["perTickerErrors"] = [];

  for (const ticker of args.tickers) {
    const sym = ticker.toUpperCase().trim();
    if (!sym) continue;
    for (const day of days) {
      const dayRes = await replayDay({
        mode: args.mode,
        ticker: sym,
        day,
        slopePct: args.slopePct,
        policy: args.policy,
        coolDownBars: args.coolDownBars,
        pullbackThresholdPct: args.pullbackThresholdPct,
      });
      if (dayRes.error) perTickerErrors.push({ ticker: sym, day, reason: dayRes.error });
      signals.push(...dayRes.signals);
    }
  }

  return { ok: true, signals, perTickerErrors };
}
