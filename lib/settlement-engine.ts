/**
 * Post-close settlement engine. Given a trade plan and intraday option
 * premium bars, walk through the day and produce a deterministic outcome
 * verdict: filled? target hit? stopped? no-fill? time-stopped?
 *
 * Data source: Tradier `timesales` on the OCC option symbol (5-minute bars).
 *
 * Scope: this is for option trades (call / put) where the entry/target/stop
 * levels are expressed in option premium dollars. Equity (long/short) trades
 * are out of scope for v1 — they'd need underlying-bar walking with a
 * different parser for entry_zone (which would be in share prices).
 */

import type { Trade, TradeOutcome } from "@/lib/db/schema";
import { buildOccSymbol, getIntradayBars, type TradierBar } from "@/lib/tradier";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SettlementVerdict {
  ticker: string;
  /** Determined outcome. `null` when the engine couldn't run (missing data,
   *  unparseable plan, etc.) — the caller decides how to handle. */
  outcome: TradeOutcome | null;
  /** P&L percentage based on premium move from actual_entry to actual_exit.
   *  Null when no fill or insufficient data. */
  pnl_pct: number | null;
  /** Option premium at which the engine considers the trade filled. */
  actual_entry: number | null;
  /** Option premium at which the engine considers the trade exited. */
  actual_exit: number | null;
  /** Confidence in the verdict.
   *   high   — clear single exit event, ample bars
   *   medium — close call (multiple events same bar, sparse data)
   *   low    — data was insufficient or plan unparseable */
  confidence: "high" | "medium" | "low";
  /** Human-readable trace of what the engine saw. Stored on the post in
   *  `meta.settlement_log` so the LLM commentary (and the user) can audit. */
  log: string[];
  /** Whether the engine ran end-to-end. False means the verdict is a
   *  best-effort fallback or "unknown". */
  ran: boolean;
}

// ---------------------------------------------------------------------------
// Plan parsing
// ---------------------------------------------------------------------------

function firstDollar(s: string): number | null {
  const m = s.match(/\$?\s*(\d{1,5}(?:\.\d{1,4})?)/);
  return m ? Number(m[1]) : null;
}

function priceRange(s: string): [number, number] | null {
  const m = s.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:[‐-―\-]|to)\s*\$?\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return lo <= hi ? [lo, hi] : [hi, lo];
}

interface ParsedPlan {
  entryLo: number;
  entryHi: number;
  entryMid: number;
  target1: number | null;
  target2: number | null;
  stop: number | null;
  /** Time-stop in ET as "HH:MM" 24h, or null when none/unparseable. */
  timeStopEt: string | null;
}

function parseTimeStopEt(s: string | undefined): string | null {
  if (!s) return null;
  // Accept "2:00 PM", "14:00", "2:00 PM ET", "2pm", "2 PM"
  const ampm = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = ampm[2] ? Number(ampm[2]) : 0;
    const isPm = ampm[3].toLowerCase() === "pm";
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const hh = s.match(/(\d{1,2}):(\d{2})/);
  if (hh) return `${hh[1].padStart(2, "0")}:${hh[2]}`;
  return null;
}

function asNum(x: number | string | undefined): number | null {
  if (x == null) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  const n = firstDollar(x);
  return n != null && Number.isFinite(n) ? n : null;
}

/**
 * Parse a target/stop field that may be one of:
 *   - "$0.10"               → 0.10  (explicit dollar value)
 *   - "$0.10 (-45%)"        → 0.10  (dollar value wins, percent ignored)
 *   - "-45%" / "-45% from entry" → entryMid * (1 - 0.45)  (percentage-only)
 *   - "+50%"                → entryMid * 1.50
 *   - "0.10"                → 0.10  (bare number, treat as dollars)
 *
 * The bug we're guarding against: when the premarket routine writes a
 * stop as `"-45%"` (no $ prefix) and we use `firstDollar`, we extract
 * `45` and treat it as a dollar value, which trivially "stops" every
 * sub-$1 option on the next bar. Percentage-only fields must be
 * resolved against `entryMid` to recover the actual premium level.
 */
function parsePremiumLevel(
  x: number | string | undefined,
  entryMid: number,
): number | null {
  if (x == null) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  const s = x;
  // Prefer percentage when present — it's premium-relative and unambiguous.
  // Stop strings like `"-45% on reclaim of $580"` contain BOTH a premium-%
  // stop AND an underlying-$ invalidation level. Taking the % avoids
  // confusing the two: `firstDollar` would extract the leading `45` and
  // treat it as a $45 premium stop, which is what blew up SPY/QQQ.
  const pctMatch = s.match(/([+\-−])?\s*(\d{1,3}(?:\.\d+)?)\s*%/);
  if (pctMatch) {
    const sign = pctMatch[1] === "-" || pctMatch[1] === "−" ? -1 : 1;
    const pct = sign * Number(pctMatch[2]);
    if (Number.isFinite(pct) && Number.isFinite(entryMid) && entryMid > 0) {
      return entryMid * (1 + pct / 100);
    }
  }
  // No percentage — look for an explicit $-prefixed value.
  const dollarMatch = s.match(/\$\s*(\d{1,5}(?:\.\d{1,4})?)/);
  if (dollarMatch) {
    const n = Number(dollarMatch[1]);
    if (Number.isFinite(n)) return n;
  }
  // Bare number fallback (e.g. "0.10" with no decoration).
  return asNum(s);
}

function parsePlan(trade: Trade): ParsedPlan | null {
  if (!trade.entry_zone) return null;
  const range = priceRange(trade.entry_zone);
  let entryLo: number;
  let entryHi: number;
  if (range) {
    [entryLo, entryHi] = range;
  } else {
    const single = firstDollar(trade.entry_zone);
    if (single == null) return null;
    // Treat a single number as a tight ±$0.02 band around it.
    entryLo = single - 0.02;
    entryHi = single + 0.02;
  }
  const midMatch = trade.entry_zone.match(/mid\s*\$?\s*(\d+(?:\.\d+)?)/i);
  const entryMid = midMatch ? Number(midMatch[1]) : (entryLo + entryHi) / 2;
  return {
    entryLo,
    entryHi,
    entryMid,
    target1: parsePremiumLevel(trade.target1, entryMid),
    target2: parsePremiumLevel(trade.target2, entryMid),
    stop: parsePremiumLevel(trade.stop, entryMid),
    timeStopEt: parseTimeStopEt(trade.time_stop),
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/** ET-clock "HH:MM" parsed from a Tradier timesales bar's `time` field
 *  (which Tradier emits in market-local — i.e. America/New_York — clock).
 *  Handles both observed formats:
 *    "YYYY-MM-DD HH:MM"          — space separator
 *    "YYYY-MM-DDTHH:MM:SS"       — ISO-8601 with T separator (also includes seconds)
 *  Falls back to converting `bar.timestamp` (epoch seconds) into ET when the
 *  string form isn't present.
 *
 *  Previous bug: regex `(\d{2}):(\d{2})$` was anchored to end-of-string. On
 *  ISO-8601 inputs like `"2026-05-15T09:35:00"` it matched the MM:SS suffix
 *  (`"35:00"`) instead of HH:MM, then `"35:00" >= "11:30"` is true
 *  lexicographically — so the time-stop fired immediately after entry on
 *  every trade. */
function barEtHHMM(bar: TradierBar): string | null {
  if (bar.time) {
    // Match HH:MM right after a date separator (T or space), tolerating
    // either zero-padded or single-digit hours.
    const m = bar.time.match(/[T\s](\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  }
  if (typeof bar.timestamp === "number" && Number.isFinite(bar.timestamp)) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(bar.timestamp * 1000)).map((p) => [p.type, p.value]),
    );
    const hh = parts.hour === "24" ? "00" : (parts.hour ?? "00");
    return `${hh}:${parts.minute ?? "00"}`;
  }
  return null;
}

/** Round to 2 decimals for premium dollars; preserves sign. */
function r2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Find the actual entry price within `[entryLo, entryHi]` that the bar
 *  touched. Returns the closest-to-mid price within the bar's [low, high]
 *  range, clamped to the entry zone. */
function fillPriceIn(bar: TradierBar, lo: number, hi: number, mid: number): number {
  const overlap_lo = Math.max(bar.low, lo);
  const overlap_hi = Math.min(bar.high, hi);
  // overlap should exist when this is called
  if (overlap_lo > overlap_hi) return mid; // safety
  // Snap to mid if mid is in the overlap; otherwise pick the overlap edge closest to mid.
  if (mid >= overlap_lo && mid <= overlap_hi) return r2(mid);
  return r2(Math.abs(overlap_lo - mid) < Math.abs(overlap_hi - mid) ? overlap_lo : overlap_hi);
}

function pnlPct(entry: number, exit: number): number {
  if (entry <= 0) return 0;
  return ((exit - entry) / entry) * 100;
}

/**
 * Run the deterministic settlement on one trade.
 * Falls back to an "unknown" verdict (outcome=null, ran=false) when:
 *   - the trade has no option-symbol-ish fields (no strike/expiry/direction)
 *   - the entry_zone can't be parsed
 *   - Tradier returns no bars for the day
 */
export async function settleTrade(
  trade: Trade,
  tradingDay: string,
): Promise<SettlementVerdict> {
  const log: string[] = [];
  const baseFail = (reason: string): SettlementVerdict => {
    log.push(`fallback: ${reason}`);
    return {
      ticker: trade.ticker,
      outcome: null,
      pnl_pct: null,
      actual_entry: null,
      actual_exit: null,
      confidence: "low",
      log,
      ran: false,
    };
  };

  if (trade.direction !== "call" && trade.direction !== "put") {
    return baseFail(
      `direction=${trade.direction ?? "—"} (equity trades not supported in v1)`,
    );
  }
  const strike = asNum(trade.strike);
  if (strike == null) return baseFail("missing/unparseable strike");
  // Resolve expiry. The parseTradesFromMarkdown pipeline doesn't populate
  // `trade.expiry` as a separate field — it leaves it embedded in the strike
  // string (e.g. "$430 PUT (2026-05-15)"). For 0DTE the expiry equals the
  // trading day, so default to that. We also try to extract a YYYY-MM-DD
  // from the strike string as a safety net for non-0DTE plans.
  const expiry =
    trade.expiry ??
    (typeof trade.strike === "string"
      ? trade.strike.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1]
      : undefined) ??
    tradingDay;
  log.push(
    `expiry=${expiry}${trade.expiry ? "" : " (defaulted from trading_day — 0DTE assumption)"}`,
  );
  const plan = parsePlan(trade);
  if (!plan) return baseFail("could not parse entry_zone / targets / stop");
  if (plan.target1 == null && plan.target2 == null && plan.stop == null) {
    return baseFail("no targets and no stop — nothing to test");
  }

  const occ = buildOccSymbol({
    root: trade.ticker,
    expiry,
    right: trade.direction,
    strike,
  });
  log.push(`occ=${occ}`);

  const start = `${tradingDay} 09:30`;
  const end = `${tradingDay} 16:00`;
  let bars: TradierBar[] = [];
  try {
    bars = await getIntradayBars(occ, "5min", start, end);
  } catch (err) {
    return baseFail(
      `tradier error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!bars.length) return baseFail("no intraday bars from tradier");
  log.push(`bars=${bars.length}`);

  // Find entry fill — first bar whose [low, high] overlaps [entryLo, entryHi].
  let entryIdx = -1;
  let actualEntry = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.high >= plan.entryLo && b.low <= plan.entryHi) {
      entryIdx = i;
      actualEntry = fillPriceIn(b, plan.entryLo, plan.entryHi, plan.entryMid);
      log.push(
        `entry: bar ${b.time} low=${b.low} high=${b.high} → fill @ ${actualEntry}`,
      );
      break;
    }
  }
  if (entryIdx < 0) {
    log.push(
      `no_fill: option never traded in entry zone ${plan.entryLo}-${plan.entryHi}`,
    );
    return {
      ticker: trade.ticker,
      outcome: "no_fill",
      pnl_pct: null,
      actual_entry: null,
      actual_exit: null,
      confidence: "high",
      log,
      ran: true,
    };
  }

  // Walk subsequent bars; first event wins. If a single bar hits BOTH a
  // target and the stop, prefer the worse outcome (stop) — conservative.
  let outcome: TradeOutcome = "manual_exit"; // tentative; overridden below
  let exitPrice: number = bars[bars.length - 1]?.close ?? actualEntry;
  let confidence: "high" | "medium" | "low" = "high";
  let resolvedBarIdx = bars.length - 1;
  let resolved = false;

  for (let i = entryIdx + 1; i < bars.length; i++) {
    const b = bars[i];
    const hitT2 = plan.target2 != null && b.high >= plan.target2;
    const hitT1 = plan.target1 != null && b.high >= plan.target1;
    const hitStop = plan.stop != null && b.low <= plan.stop;
    const hitTimeStop =
      plan.timeStopEt != null && (barEtHHMM(b) ?? "00:00") >= plan.timeStopEt;

    if (hitStop && (hitT1 || hitT2)) {
      // Same-bar collision — prefer stop, mark medium confidence.
      outcome = "stopped";
      exitPrice = plan.stop!;
      confidence = "medium";
      log.push(`bar ${b.time}: both stop and target in range — prefer stop`);
      resolvedBarIdx = i;
      resolved = true;
      break;
    }
    if (hitT2) {
      outcome = "target2_hit";
      exitPrice = plan.target2!;
      log.push(`bar ${b.time}: target2 hit @ ${plan.target2}`);
      resolvedBarIdx = i;
      resolved = true;
      break;
    }
    if (hitT1) {
      // Don't break yet — peek forward to see if target2 is still reachable
      // without hitting the stop. For a single-bar T1 we still want to take T1
      // as the resolution unless a later bar takes T2 first.
      outcome = "target1_hit";
      exitPrice = plan.target1!;
      log.push(`bar ${b.time}: target1 hit @ ${plan.target1} (may upgrade to T2)`);
      // Search forward for T2 without hitting stop
      let upgraded = false;
      for (let j = i + 1; j < bars.length; j++) {
        const bj = bars[j];
        if (plan.stop != null && bj.low <= plan.stop) {
          log.push(`bar ${bj.time}: stop hit after T1 — keep T1 as outcome`);
          break;
        }
        if (plan.target2 != null && bj.high >= plan.target2) {
          outcome = "target2_hit";
          exitPrice = plan.target2;
          log.push(`bar ${bj.time}: upgraded T1 → T2 @ ${plan.target2}`);
          resolvedBarIdx = j;
          upgraded = true;
          break;
        }
      }
      if (!upgraded) resolvedBarIdx = i;
      resolved = true;
      break;
    }
    if (hitStop) {
      outcome = "stopped";
      exitPrice = plan.stop!;
      log.push(`bar ${b.time}: stop hit @ ${plan.stop}`);
      resolvedBarIdx = i;
      resolved = true;
      break;
    }
    if (hitTimeStop) {
      outcome = "time_stopped";
      exitPrice = b.close;
      log.push(
        `bar ${b.time}: time-stop ${plan.timeStopEt} reached, close=${b.close}`,
      );
      resolvedBarIdx = i;
      resolved = true;
      break;
    }
  }

  if (!resolved) {
    // Trade still open at the final bar → close-of-day manual exit.
    const last = bars[bars.length - 1];
    outcome = "manual_exit";
    exitPrice = last.close;
    log.push(`end-of-day: manual_exit @ close=${last.close}`);
    resolvedBarIdx = bars.length - 1;
  }
  void resolvedBarIdx; // reserved for richer log output / time-of-day stamp

  // Sanity clamp — defense against bad bar prints and any future parser
  // miss. A long option exit shouldn't be >10× or <1/10 of entry for a
  // same-day trade. When we exceed either bound, fall back to a sensible
  // value and demote confidence to "low" so the LLM commentary surfaces
  // the anomaly.
  const SANITY_HI = actualEntry * 10;
  const SANITY_LO = actualEntry / 10;
  if (
    Number.isFinite(actualEntry) &&
    actualEntry > 0 &&
    (exitPrice > SANITY_HI || exitPrice < SANITY_LO)
  ) {
    const lastClose = bars[bars.length - 1]?.close;
    const clampedClose =
      typeof lastClose === "number" &&
      Number.isFinite(lastClose) &&
      lastClose <= SANITY_HI &&
      lastClose >= SANITY_LO
        ? lastClose
        : null;
    log.push(
      `sanity: exit=${exitPrice} outside [${r2(SANITY_LO)}, ${r2(SANITY_HI)}] for entry=${actualEntry} — clamping`,
    );
    if (clampedClose != null) {
      exitPrice = clampedClose;
      log.push(`sanity: substituted last-bar close=${clampedClose}`);
    } else {
      exitPrice = actualEntry; // scratch — neither lose nor gain
      log.push(`sanity: no usable last close, substituting entry (scratch)`);
    }
    confidence = "low";
  }

  return {
    ticker: trade.ticker,
    outcome,
    pnl_pct: r2(pnlPct(actualEntry, exitPrice)),
    actual_entry: actualEntry,
    actual_exit: r2(exitPrice),
    confidence,
    log,
    ran: true,
  };
}

/**
 * Run the engine across all trades in a plan. Returns an array indexed by
 * input order. Calls are made in parallel for throughput; if Tradier rate-
 * limits, we fall back to single-trade verdicts (the engine never throws).
 */
export async function settleAllTrades(
  trades: Trade[],
  tradingDay: string,
): Promise<SettlementVerdict[]> {
  return Promise.all(trades.map((t) => settleTrade(t, tradingDay)));
}
