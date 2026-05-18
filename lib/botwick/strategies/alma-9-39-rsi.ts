/**
 * ALMA 9/39 RSI Strategy — Option 2 (Phase 1).
 *
 * Ports the PineScript "ALMA 9/39 RSI Strategy" entry rules + non-trailing
 * exits. Lives alongside Option 1 (ALMA × VWAP) — completely independent
 * module. Phase 2 adds trailing stops and TP1–TP5 scale-out.
 *
 * Entry (all must be true on the LATEST CLOSED 5-min bar):
 *   LONG:  ALMA9 crosses ABOVE ALMA39 on this bar
 *          AND RSI ∈ [longRsiMin, longRsiMax]
 *          AND choppiness within configured side of threshold
 *          AND close (or HL2) above session VWAP
 *          AND inside the configured NY entry session
 *          AND before the configured force-close time
 *          AND no existing open/working trade for this ticker
 *   SHORT: ALMA9 crosses BELOW ALMA39, RSI ∈ [shortRsiMin, shortRsiMax],
 *          close below VWAP, otherwise symmetric.
 *
 * Direction → option:
 *   LONG signal  → buy nearest OTM CALL (long_call)
 *   SHORT signal → buy nearest OTM PUT  (long_put)
 *
 * Exits (full close, MARKET — see checkAlma939Exits):
 *   Force-close is BotWick's existing 15:55 ET sweep — not duplicated here.
 *   1. ALMA exits (when alma939UseAlmaSignalExits is true):
 *      LONG  → close < ALMA39 OR ALMA9 crosses below ALMA39 this bar
 *      SHORT → close > ALMA39 OR ALMA9 crosses above ALMA39 this bar
 *   2. VWAP exits (when alma939UseVwapExitRules is true):
 *      LONG  → close < VWAP OR (ALMA9 just crossed below VWAP AND close < VWAP)
 *      SHORT → close > VWAP OR (ALMA9 just crossed above VWAP AND close > VWAP)
 *   3. Underlying-priced stop / target (Phase 1: fixed % only).
 *      LONG  stop  → underlying ≤ entry × (1 − slPct/100)
 *      LONG  TP1   → underlying ≥ entry × (1 + tp1Pct/100)
 *      LONG  TP2   → underlying ≥ entry × (1 + tp2Pct/100)
 *      SHORT symmetric.
 *
 * On signal fire: inserts bot_trades(status='signal_fired') with
 * plan.source = "alma_9_39_rsi" + a snapshot of the strategy config.
 * submitAllFired (Phase C of the tick) picks it up like any other entry.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { botActions, botTrades, type BotConfig } from "@/lib/db/schema";
import { computeAlmaAt, detectCross } from "../alma";
import { getOptionChain, getQuotes, getTimesales, type TradierBar } from "../tradier-adapter";
import { pickNearestOtm } from "../strike-picker";
import { maxOpenPositionsGate } from "../risk";
import { todayEt, nowEtTime, sessionVwap, dropOpenBar } from "../util/bars";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export type Alma939TickerOutcome = {
  ticker: string;
  outcome:
    | "no_bars"
    | "skipped"           // some filter rejected the signal
    | "alma_skipped"
    | "long_entry_fired"
    | "short_entry_fired"
    | "entry_blocked_existing_position"
    | "entry_blocked_no_chain"
    | "entry_blocked_no_otm"
    | "entry_blocked_illiquid"
    | "entry_blocked_size_zero"
    | "error";
  reason?: string;
  detail?: Record<string, unknown>;
};

export type Alma939RunSummary = {
  watchlist: string[];
  perTicker: Alma939TickerOutcome[];
};

// ---------------------------------------------------------------------------
// Per-strategy snapshot — recorded onto each trade's plan for exit evaluation
// ---------------------------------------------------------------------------

export type Alma939ExitConfig = {
  useAlmaSignalExits: boolean;
  useLongCloseBelowAlma39Exit: boolean;
  useLongAlmaCrossDownExit: boolean;
  useShortCloseAboveAlma39Exit: boolean;
  useShortAlmaCrossUpExit: boolean;
  useVwapExitRules: boolean;
  useLongCloseBelowVwapExit: boolean;
  useShortCloseAboveVwapExit: boolean;
  useLongAlma9CrossBelowVwapExit: boolean;
  useShortAlma9CrossAboveVwapExit: boolean;
  useStopLoss: boolean;
  slMode: "fixed" | "trailing";
  fixedSlPct: number;
  trailSlPct: number;
  trailUpdateMode: "prev_extreme" | "curr_extreme" | "close";
  useProfitTargets: boolean;
  // Per-level enable/pct/qty. Each level is a % move on the underlying from
  // entry. Qty is a % of the original position size scaled out at that level.
  tps: Array<{ level: 1 | 2 | 3 | 4 | 5; enabled: boolean; pct: number; qtyPct: number }>;
  fastLen: number;
  slowLen: number;
  offset: number;
  sigma: number;
};

// Per-trade runtime state for Phase 2 partial closes + trailing stop.
// Stored in `plan.runtime` and mutated as exits/TPs fire over the life of the
// trade. Kept narrow on purpose so we can persist via plan-jsonb writes.
export type Alma939Runtime = {
  // Captured at fill so partial-close qty calcs are stable even if the leg
  // gets reduced by earlier TP fills.
  originalQty: number;
  entryUnderlying: number;
  // Trailing stop in underlying-price units. Initialized lazily on first
  // favorable move past the fixed-stop level. Long: highest stop seen.
  // Short: lowest stop seen. Only moves in the favorable direction.
  trailingStop?: number;
  // Per-level record of TPs that have already fired (to avoid duplicates and
  // for the activity tape).
  tpsFiredAt?: Array<{
    level: 1 | 2 | 3 | 4 | 5;
    triggerUnderlying: number;
    qty: number;
    firedAt: string;
  }>;
};

// ---------------------------------------------------------------------------
// Helpers — most live in lib/botwick/util/bars.ts. Imported via the import
// block at the top of this file.
// ---------------------------------------------------------------------------

/**
 * Wilder's RSI on `closes` at a given index, computed the way TradingView's
 * `ta.rsi(length)` does it: first bar uses a simple average of N gains/losses,
 * subsequent bars apply the Wilder smoothing `RMA: avg = (prevAvg*(n−1) + curr) / n`.
 *
 * The previous (broken) implementation just used a simple average at every
 * index, which matches Pine only at the first computed bar and diverges
 * meaningfully afterward. Threshold-based filters (50/72/28/50) won't fire
 * at the same spots TradingView shows; this fix aligns live + backtest.
 *
 * Returns null if not enough data to seed the average.
 */
export function computeRsi(closes: number[], length: number, idx: number): number | null {
  if (idx < length || closes.length < length + 1) return null;

  // Seed: simple average over the first `length` deltas (closes[1..length]).
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += -diff;
  }
  avgGain /= length;
  avgLoss /= length;

  // Apply Wilder smoothing for every bar from `length+1` up to `idx`.
  for (let i = length + 1; i <= idx; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (length - 1) + gain) / length;
    avgLoss = (avgLoss * (length - 1) + loss) / length;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Choppiness Index over a window ending at idx. 0 = strong trend, 100 = chop. */
export function computeChoppiness(
  highs: number[],
  lows: number[],
  closes: number[],
  length: number,
  idx: number,
): number | null {
  if (idx < length) return null;
  let highestHigh = -Infinity;
  let lowestLow = Infinity;
  let trSum = 0;
  for (let i = idx - length + 1; i <= idx; i++) {
    if (highs[i] > highestHigh) highestHigh = highs[i];
    if (lows[i] < lowestLow) lowestLow = lows[i];
    const prevClose = i > 0 ? closes[i - 1] : closes[i];
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - prevClose),
      Math.abs(lows[i] - prevClose),
    );
    trSum += tr;
  }
  const range = highestHigh - lowestLow;
  if (range <= 0) return 100;
  return (100 * Math.log10(trSum / range)) / Math.log10(length);
}

/** Is the most recent bar's CLOSE time within [sessionStart, sessionEnd) ET? */
function inEntrySession(barCloseHHMM: string, start: string, end: string): boolean {
  return barCloseHHMM >= start && barCloseHHMM < end;
}

/** Returns true while we're still BEFORE the configured force-close minute
 *  in ET — i.e., it's still OK to open new entries. */
function beforeForceClose(nowHHMM: string, useForce: boolean, hh: number, mm: number): boolean {
  if (!useForce) return true;
  const force = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  return nowHHMM < force;
}

async function logTape(opts: {
  kind: typeof botActions.$inferInsert.kind;
  severity: string;
  message: string;
  tradeId?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(botActions).values({
    kind: opts.kind,
    severity: opts.severity,
    message: opts.message,
    tradeId: opts.tradeId,
    data: opts.data ?? {},
  });
}

// ---------------------------------------------------------------------------
// ENTRY — per ticker
// ---------------------------------------------------------------------------

async function processAlma939RsiTicker(args: {
  config: BotConfig;
  ticker: string;
}): Promise<Alma939TickerOutcome> {
  const { config, ticker } = args;
  const sym = ticker.toUpperCase();

  // Block new entries when there's already an in-flight trade for this ticker
  // (open / working / closing / submitting / signal_fired). Mirrors the
  // PineScript `isFlat` gate.
  const inflight = await db
    .select({ id: botTrades.id, status: botTrades.status })
    .from(botTrades)
    .where(
      and(
        eq(botTrades.sourceTicker, sym),
        inArray(botTrades.status, [
          "signal_fired",
          "submitting",
          "working",
          "open",
          "closing",
        ]),
      ),
    )
    .limit(1);
  if (inflight.length > 0) {
    return {
      ticker: sym,
      outcome: "entry_blocked_existing_position",
      reason: `existing ${inflight[0].status} trade`,
    };
  }

  // B1: maxOpenPositions race-safe gate. Count across ALL tickers.
  const inFlightGate = await maxOpenPositionsGate(config);
  if (!inFlightGate.ok) {
    await logTape({
      kind: "risk_block",
      severity: "warn",
      message: `${sym} — entry blocked: ${inFlightGate.reason}`,
      data: { ticker: sym, source: "alma_9_39_rsi", reason: inFlightGate.reason },
    });
    return { ticker: sym, outcome: "skipped", reason: inFlightGate.reason };
  }

  // Time gates first — cheaper than pulling bars.
  const date = todayEt();
  const time = nowEtTime();
  if (config.alma939UseSessionFilter) {
    const inSession = inEntrySession(time, config.alma939SessionStart, config.alma939SessionEnd);
    if (!inSession) {
      return { ticker: sym, outcome: "skipped", reason: `outside session ${config.alma939SessionStart}-${config.alma939SessionEnd}` };
    }
  }
  if (!beforeForceClose(time, config.alma939UseForceClose, config.alma939ForceCloseHour, config.alma939ForceCloseMinute)) {
    return { ticker: sym, outcome: "skipped", reason: "past force-close cutoff" };
  }

  // Pull session bars.
  const barsRes = await getTimesales(config.mode, {
    symbol: sym,
    interval: "5min",
    startEt: `${date} 09:30`,
    endEt: `${date} ${time}`,
  });
  if (!barsRes.ok) return { ticker: sym, outcome: "error", reason: `bars: ${barsRes.reason}` };
  const bars = dropOpenBar(barsRes.data, time);

  const fastLen = config.alma939FastLen;
  const slowLen = config.alma939SlowLen;
  const offset = Number(config.alma939Offset);
  const sigma = Number(config.alma939Sigma);
  const rsiLen = config.alma939RsiLen;
  const chopLen = config.alma939ChopLen;
  // Need enough bars for the slowest indicator + previous-bar comparison.
  const requiredBars = Math.max(slowLen, rsiLen, chopLen) + 1;
  if (bars.length < requiredBars) {
    return { ticker: sym, outcome: "no_bars", reason: `only ${bars.length} bars, need ${requiredBars}` };
  }

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const currIdx = closes.length - 1;
  const prevIdx = currIdx - 1;
  const lastBar = bars[currIdx];

  // Compute ALMA9 / ALMA39 at current + previous bars for cross detection.
  const fastParams = { length: fastLen, offset, sigma };
  const slowParams = { length: slowLen, offset, sigma };
  const fastCurr = computeAlmaAt(closes, currIdx, fastParams);
  const fastPrev = computeAlmaAt(closes, prevIdx, fastParams);
  const slowCurr = computeAlmaAt(closes, currIdx, slowParams);
  const slowPrev = computeAlmaAt(closes, prevIdx, slowParams);
  if (fastCurr == null || fastPrev == null || slowCurr == null || slowPrev == null) {
    return { ticker: sym, outcome: "alma_skipped", reason: "ALMA undefined" };
  }

  // ALMA9 × ALMA39 cross on this bar.
  const cross = detectCross(fastPrev, slowPrev, fastCurr, slowCurr);
  if (!cross) {
    return { ticker: sym, outcome: "skipped", reason: "no ALMA9/ALMA39 cross this bar" };
  }
  const side: "long" | "short" = cross === "above" ? "long" : "short";

  // Session VWAP for the entry-side filter.
  const vwapCurr = sessionVwap(bars);
  if (vwapCurr == null) {
    return { ticker: sym, outcome: "skipped", reason: "no VWAP" };
  }
  if (config.alma939UseVwapEntryFilter) {
    const mode = side === "long" ? config.alma939VwapLongMode : config.alma939VwapShortMode;
    const ref = mode === "hl2" ? (lastBar.high + lastBar.low) / 2 : lastBar.close;
    const ok = side === "long" ? ref > vwapCurr : ref < vwapCurr;
    if (!ok) {
      return { ticker: sym, outcome: "skipped", reason: `VWAP filter rejected (${mode}=${ref.toFixed(2)} vs vwap=${vwapCurr.toFixed(2)})` };
    }
  }

  // RSI band filter.
  if (config.alma939UseRsiFilter) {
    const rsi = computeRsi(closes, rsiLen, currIdx);
    if (rsi == null) {
      return { ticker: sym, outcome: "skipped", reason: "RSI undefined" };
    }
    const lo = Number(side === "long" ? config.alma939LongRsiMin : config.alma939ShortRsiMin);
    const hi = Number(side === "long" ? config.alma939LongRsiMax : config.alma939ShortRsiMax);
    if (rsi < lo || rsi > hi) {
      return { ticker: sym, outcome: "skipped", reason: `RSI ${rsi.toFixed(1)} outside [${lo}, ${hi}]`, detail: { rsi, side } };
    }
  }

  // Choppiness filter.
  if (config.alma939UseChopFilter) {
    const chop = computeChoppiness(highs, lows, closes, chopLen, currIdx);
    if (chop == null) {
      return { ticker: sym, outcome: "skipped", reason: "Choppiness undefined" };
    }
    const threshold = Number(config.alma939ChopThreshold);
    const ok = config.alma939ChopMode === "below" ? chop <= threshold : chop >= threshold;
    if (!ok) {
      return { ticker: sym, outcome: "skipped", reason: `Choppiness ${chop.toFixed(1)} on wrong side of ${threshold} (mode=${config.alma939ChopMode})`, detail: { chop } };
    }
  }

  // -----------------------------------------------------------------
  // Entry fires. Pick option contract and size the order.
  // -----------------------------------------------------------------
  await logTape({
    kind: "signal_armed",
    severity: "success",
    message: `${sym} ALMA 9/39 RSI — ${side.toUpperCase()} entry: ALMA9 crossed ${cross} ALMA39 (${fastCurr.toFixed(2)}/${slowCurr.toFixed(2)}), close ${lastBar.close.toFixed(2)} vs VWAP ${vwapCurr.toFixed(2)}`,
    data: { ticker: sym, side, fastCurr, slowCurr, vwapCurr, close: lastBar.close, source: "alma_9_39_rsi" },
  });

  const instrument = config.alma939InstrumentMode ?? "options";

  // Stock-mode gating:
  //   stock_long  → LONG fires, SHORT skip-with-warning
  //   stock_short → SHORT fires, LONG skip-with-warning
  //   stock_both  → both fire
  if (instrument === "stock_long" && side === "short") {
    await logTape({
      kind: "risk_block",
      severity: "warn",
      message: `${sym} — SHORT signal skipped: instrument_mode=stock_long does not fire short signals.`,
      data: { ticker: sym, side, source: "alma_9_39_rsi" },
    });
    return { ticker: sym, outcome: "skipped", reason: "stock_long mode + short signal" };
  }
  if (instrument === "stock_short" && side === "long") {
    await logTape({
      kind: "risk_block",
      severity: "warn",
      message: `${sym} — LONG signal skipped: instrument_mode=stock_short does not fire long signals.`,
      data: { ticker: sym, side, source: "alma_9_39_rsi" },
    });
    return { ticker: sym, outcome: "skipped", reason: "stock_short mode + long signal" };
  }
  const isStockMode = instrument === "stock_long" || instrument === "stock_short" || instrument === "stock_both";

  // Latest live underlying price — used by both modes.
  const quoteRes = await getQuotes(config.mode, [sym]);
  if (!quoteRes.ok) {
    return { ticker: sym, outcome: "error", reason: `quote: ${quoteRes.reason}` };
  }
  const underlyingPrice = quoteRes.data[0]?.last ?? lastBar.close;
  if (!Number.isFinite(underlyingPrice)) {
    return { ticker: sym, outcome: "error", reason: "no underlying price" };
  }

  // Mode-specific: pick the asset to buy + size the order.
  // - `options`: existing path — pick OTM contract, size by mid × 100.
  // - `stock_long`: skip chain entirely, size by underlying last price
  //   capped at maxStockNotionalUsd (BP check happens at submit time in OMS).
  type AssetPick =
    | {
        instrument: "option";
        optionType: "call" | "put";
        occSymbol: string;
        strike: number;
        expiry: string;
        mid: number;
        qty: number;
      }
    | {
        instrument: "stock";
        qty: number;
        priceAtSignal: number;
      };

  let assetPick: AssetPick;
  if (isStockMode) {
    const stockCap = Number(config.maxStockNotionalUsd);
    if (!(stockCap > 0)) {
      return { ticker: sym, outcome: "error", reason: `maxStockNotionalUsd not set` };
    }
    const stockQty = Math.floor(stockCap / underlyingPrice);
    if (stockQty <= 0) {
      await logTape({
        kind: "risk_block",
        severity: "warn",
        message: `${sym} — stock_long entry sized to 0 (last $${underlyingPrice.toFixed(2)}, cap $${stockCap})`,
        data: { ticker: sym, last: underlyingPrice, cap: stockCap, source: "alma_9_39_rsi" },
      });
      return { ticker: sym, outcome: "entry_blocked_size_zero", reason: `last $${underlyingPrice} too large for $${stockCap} cap` };
    }
    assetPick = { instrument: "stock", qty: stockQty, priceAtSignal: underlyingPrice };
  } else {
    // Options path (default).
    const optionType: "call" | "put" = side === "long" ? "call" : "put";
    const chainRes = await getOptionChain(config.mode, { symbol: sym, expiration: date });
    if (!chainRes.ok) {
      return { ticker: sym, outcome: "entry_blocked_no_chain", reason: chainRes.reason };
    }
    const pick = pickNearestOtm({ chain: chainRes.data, side: optionType, currentPrice: underlyingPrice });
    if (!pick.ok) {
      return {
        ticker: sym,
        outcome:
          pick.code === "no_chain"
            ? "entry_blocked_no_chain"
            : pick.code === "no_otm"
              ? "entry_blocked_no_otm"
              : "entry_blocked_illiquid",
        reason: pick.reason,
      };
    }
    const { contract, mid } = pick;
    if (mid == null) {
      return { ticker: sym, outcome: "entry_blocked_illiquid", reason: "no live mid on picked contract" };
    }
    const positionSize = Number(config.positionSizeUsd);
    const maxPerTrade = Number(config.maxRiskPerTradeUsd);
    const effectiveBudget = Math.min(positionSize, maxPerTrade);
    const qty = Math.floor(effectiveBudget / (mid * 100));
    if (qty <= 0) {
      await logTape({
        kind: "risk_block",
        severity: "warn",
        message: `${sym} ${contract.symbol} — ${side} entry sized to 0 (mid $${mid.toFixed(2)}, budget $${effectiveBudget})`,
        data: { ticker: sym, mid, positionSize, maxPerTrade, qty, source: "alma_9_39_rsi" },
      });
      return { ticker: sym, outcome: "entry_blocked_size_zero", reason: `mid $${mid} too large for $${effectiveBudget} budget` };
    }
    assetPick = {
      instrument: "option",
      optionType,
      occSymbol: contract.symbol,
      strike: contract.strike,
      expiry: contract.expiration_date,
      mid,
      qty,
    };
  }

  // Snapshot of exit config — the OMS reads this from plan.runtime so a
  // mid-trade config change doesn't quietly retroactively change exit
  // behavior on a position already in flight.
  const exitConfig: Alma939ExitConfig = {
    useAlmaSignalExits: config.alma939UseAlmaSignalExits,
    useLongCloseBelowAlma39Exit: config.alma939UseLongCloseBelowAlma39Exit,
    useLongAlmaCrossDownExit: config.alma939UseLongAlmaCrossDownExit,
    useShortCloseAboveAlma39Exit: config.alma939UseShortCloseAboveAlma39Exit,
    useShortAlmaCrossUpExit: config.alma939UseShortAlmaCrossUpExit,
    useVwapExitRules: config.alma939UseVwapExitRules,
    useLongCloseBelowVwapExit: config.alma939UseLongCloseBelowVwapExit,
    useShortCloseAboveVwapExit: config.alma939UseShortCloseAboveVwapExit,
    useLongAlma9CrossBelowVwapExit: config.alma939UseLongAlma9CrossBelowVwapExit,
    useShortAlma9CrossAboveVwapExit: config.alma939UseShortAlma9CrossAboveVwapExit,
    useStopLoss: config.alma939UseStopLoss,
    slMode: config.alma939SlMode,
    fixedSlPct: Number(config.alma939FixedSlPct),
    trailSlPct: Number(config.alma939TrailSlPct),
    trailUpdateMode: config.alma939TrailUpdateMode,
    useProfitTargets: config.alma939UseProfitTargets,
    tps: [
      { level: 1, enabled: config.alma939UseTp1, pct: Number(config.alma939Tp1Pct), qtyPct: Number(config.alma939Tp1Qty) },
      { level: 2, enabled: config.alma939UseTp2, pct: Number(config.alma939Tp2Pct), qtyPct: Number(config.alma939Tp2Qty) },
      { level: 3, enabled: config.alma939UseTp3, pct: Number(config.alma939Tp3Pct), qtyPct: Number(config.alma939Tp3Qty) },
      { level: 4, enabled: config.alma939UseTp4, pct: Number(config.alma939Tp4Pct), qtyPct: Number(config.alma939Tp4Qty) },
      { level: 5, enabled: config.alma939UseTp5, pct: Number(config.alma939Tp5Pct), qtyPct: Number(config.alma939Tp5Qty) },
    ],
    fastLen,
    slowLen,
    offset,
    sigma,
  };

  // Insert at signal_fired so submitAllFired picks it up this same tick.
  // Trade `strategy` + `legs` shape differs by instrument; everything else
  // (plan, exit snapshot, runtime) is identical.
  const tradeStrategy =
    assetPick.instrument === "stock"
      ? side === "long" ? "long_stock" : "short_stock"
      : side === "long"
        ? "long_call"
        : "long_put";

  const stockEntrySide: "buy" | "sell_short" = side === "long" ? "buy" : "sell_short";
  const leg =
    assetPick.instrument === "stock"
      ? {
          instrument: "stock" as const,
          side: stockEntrySide,
          symbol: sym,
          qty: assetPick.qty,
        }
      : {
          instrument: "option" as const,
          side: "buy_to_open" as const,
          option_type: assetPick.optionType,
          strike: assetPick.strike,
          expiry: assetPick.expiry,
          occ_symbol: assetPick.occSymbol,
          qty: assetPick.qty,
        };

  const planContract =
    assetPick.instrument === "stock"
      ? { instrument: "stock", symbol: sym }
      : {
          instrument: "option",
          optionType: assetPick.optionType,
          strike: assetPick.strike,
          expiry: assetPick.expiry,
          occSymbol: assetPick.occSymbol,
        };

  const entryMidEstimate =
    assetPick.instrument === "stock" ? assetPick.priceAtSignal : assetPick.mid;
  const qty = assetPick.qty;

  const [inserted] = await db
    .insert(botTrades)
    .values({
      sourcePostDay: date,
      sourceTicker: sym,
      sourceGrade: null,
      strategy: tradeStrategy,
      legs: [leg],
      plan: {
        source: "alma_9_39_rsi",
        side,
        instrument: assetPick.instrument,
        contract: planContract,
        entryMidEstimate,
        entryUnderlying: underlyingPrice,   // ← used by exit stop / TP %
        entryAt: {
          fastCurr,
          slowCurr,
          vwapCurr,
          close: lastBar.close,
        },
        // Strategy-specific exit rules — read by checkAlma939Exits.
        strategyExits: exitConfig,
        // Phase 2 runtime state (mutated through the life of the trade).
        // originalQty is locked in here on signal so partial-close qty math
        // is stable even after earlier TPs reduce the leg qty.
        runtime: {
          originalQty: qty,
          entryUnderlying: underlyingPrice,
          tpsFiredAt: [],
        },
        // No AST — exits are handled entirely by the strategy module.
        ast: null,
      },
      mode: config.mode,
      status: "signal_fired",
      entrySignaledAt: new Date(),
    })
    .returning({ id: botTrades.id });

  const fillNote =
    assetPick.instrument === "stock"
      ? `${side === "long" ? "buy" : "sell_short"} ${qty} sh @ ~$${entryMidEstimate.toFixed(2)} (last)`
      : `buy_to_open ${qty}× @ ~$${entryMidEstimate.toFixed(2)} (mid)`;
  const assetLabel =
    assetPick.instrument === "stock" ? `${sym} STOCK` : `${sym} ${assetPick.occSymbol}`;
  await logTape({
    kind: "signal_fired",
    severity: "success",
    message: `${assetLabel} — ALMA 9/39 RSI ${side.toUpperCase()} fired, ${fillNote}. Underlying ${underlyingPrice.toFixed(2)}.`,
    tradeId: inserted.id,
    data: {
      ticker: sym,
      side,
      instrument: assetPick.instrument,
      qty,
      entryMidEstimate,
      entryUnderlying: underlyingPrice,
      source: "alma_9_39_rsi",
      ...(assetPick.instrument === "option" && {
        optionType: assetPick.optionType,
        strike: assetPick.strike,
        occSymbol: assetPick.occSymbol,
      }),
    },
  });

  return {
    ticker: sym,
    outcome: side === "long" ? "long_entry_fired" : "short_entry_fired",
    detail: {
      side,
      instrument: assetPick.instrument,
      qty,
      mid: entryMidEstimate,
      underlying: underlyingPrice,
      ...(assetPick.instrument === "option" && { strike: assetPick.strike }),
    },
  };
}

// ---------------------------------------------------------------------------
// EXIT — called from OMS for trades whose plan.source = "alma_9_39_rsi"
// ---------------------------------------------------------------------------

export type Alma939ExitDecision =
  | { fire: false; reason?: string; runtimePatch?: Partial<Alma939Runtime> }
  | {
      fire: true;
      kind: "full_close";
      reason: string;
      detail: Record<string, unknown>;
      runtimePatch?: Partial<Alma939Runtime>;
    }
  | {
      fire: true;
      kind: "partial";
      level: 1 | 2 | 3 | 4 | 5;
      qtyToClose: number;
      reason: string;
      detail: Record<string, unknown>;
      runtimePatch?: Partial<Alma939Runtime>;
    };

/**
 * Recompute the trailing stop level given the latest bars. Returns the new
 * stop value (or null if not yet initialized). Trailing stop only moves in
 * the favorable direction.
 *
 *  - prev_extreme: anchor = highest high (long) / lowest low (short) over
 *                  closed bars BEFORE the current bar (Pine's "[1]" semantic).
 *  - curr_extreme: anchor = same but including the current closed bar.
 *  - close:        anchor = max/min close over closed bars.
 *
 * Then stop = anchor × (1 - pct/100) for long, anchor × (1 + pct/100) for short.
 * Existing trailing stop is only replaced if the new candidate is more
 * favorable (higher for long, lower for short).
 */
function computeTrailingStop(
  bars: Array<{ high: number; low: number; close: number }>,
  side: "long" | "short",
  currentStop: number | undefined,
  exits: Alma939ExitConfig,
): number | undefined {
  if (bars.length < 2) return currentStop;
  const pct = exits.trailSlPct;
  if (!(pct > 0)) return currentStop;
  const mode = exits.trailUpdateMode;
  const last = bars.length - 1;
  // "prev_extreme" looks at closed bars EXCEPT the most recent one (the one
  // we're currently evaluating against). curr_extreme/close include it.
  const upTo = mode === "prev_extreme" ? last : last + 1;
  if (upTo < 1) return currentStop;
  let anchor: number;
  if (mode === "close") {
    anchor = side === "long" ? -Infinity : Infinity;
    for (let i = 0; i < upTo; i++) {
      anchor = side === "long" ? Math.max(anchor, bars[i].close) : Math.min(anchor, bars[i].close);
    }
  } else {
    anchor = side === "long" ? -Infinity : Infinity;
    for (let i = 0; i < upTo; i++) {
      anchor = side === "long" ? Math.max(anchor, bars[i].high) : Math.min(anchor, bars[i].low);
    }
  }
  if (!Number.isFinite(anchor)) return currentStop;
  const candidate = side === "long" ? anchor * (1 - pct / 100) : anchor * (1 + pct / 100);
  if (currentStop == null) return candidate;
  // Only move in favorable direction.
  return side === "long" ? Math.max(currentStop, candidate) : Math.min(currentStop, candidate);
}

export async function checkAlma939Exits(args: {
  cfg: BotConfig;
  trade: { id: string; sourceTicker: string; plan: Record<string, unknown> };
  side: "long" | "short";
  /** Live underlying mid/last for stop/TP checks. */
  underlyingNow: number | null;
  /** Remaining qty on the long leg (after any earlier partial closes). */
  remainingQty: number;
}): Promise<Alma939ExitDecision> {
  const { cfg, trade, side, underlyingNow, remainingQty } = args;
  const plan = trade.plan ?? {};
  const exits = (plan.strategyExits ?? null) as Alma939ExitConfig | null;
  const runtime = ((plan as Record<string, unknown>).runtime ?? {}) as Partial<Alma939Runtime>;
  if (!exits) {
    return { fire: false, reason: "missing strategyExits on plan — trade may pre-date Option 2 deploy" };
  }
  // Phase 1 trades won't have the `tps` array. Fall back to legacy tp1/tp2
  // shape if present so in-flight trades from pre-Phase-2 still exit cleanly.
  const tps: Alma939ExitConfig["tps"] = Array.isArray(exits.tps)
    ? exits.tps
    : (() => {
        const legacy = exits as unknown as { tp1Pct?: number; tp2Pct?: number };
        return [
          { level: 1, enabled: legacy.tp1Pct != null && legacy.tp1Pct > 0, pct: legacy.tp1Pct ?? 0, qtyPct: 100 },
          { level: 2, enabled: legacy.tp2Pct != null && legacy.tp2Pct > 0, pct: legacy.tp2Pct ?? 0, qtyPct: 100 },
        ];
      })();

  // Resolve entry underlying — runtime takes precedence (Phase 2), fall back
  // to top-level plan.entryUnderlying for in-flight Phase 1 trades.
  const entryUnderlyingRaw =
    typeof runtime.entryUnderlying === "number"
      ? runtime.entryUnderlying
      : ((plan as Record<string, unknown>).entryUnderlying as number | undefined);
  const entryUnderlying = typeof entryUnderlyingRaw === "number" ? entryUnderlyingRaw : null;
  const originalQty = typeof runtime.originalQty === "number" ? runtime.originalQty : remainingQty;
  const tpsFired = Array.isArray(runtime.tpsFiredAt) ? runtime.tpsFiredAt : [];
  const firedLevels = new Set(tpsFired.map((t) => t.level));

  // M6: Pre-fetch bars + recompute trailing stop BEFORE the tick-priced
  // stop check. The old order was tick-check → bar-check, which meant the
  // tick check used yesterday's (or last bar's) `runtime.trailingStop` even
  // if a new bar would have ratcheted the trail further. In a fast move
  // that lag is the difference between a profitable trail exit and a stop
  // that fires on a worse fill.
  //
  // Pre-fetched bars are reused later for ALMA/VWAP exits (no double Tradier hit).
  const trailingNeedsBars = exits.useStopLoss && exits.slMode === "trailing" && exits.trailSlPct > 0;
  const needBarsForExits =
    (exits.useAlmaSignalExits &&
      (exits.useLongCloseBelowAlma39Exit ||
        exits.useLongAlmaCrossDownExit ||
        exits.useShortCloseAboveAlma39Exit ||
        exits.useShortAlmaCrossUpExit)) ||
    (exits.useVwapExitRules &&
      (exits.useLongCloseBelowVwapExit ||
        exits.useShortCloseAboveVwapExit ||
        exits.useLongAlma9CrossBelowVwapExit ||
        exits.useShortAlma9CrossAboveVwapExit));
  const needBars = trailingNeedsBars || needBarsForExits;

  // Bars + runtimePatch are populated either by the early trailing fetch
  // below OR by the late ALMA/VWAP section. Either way the trailing-stop
  // recompute happens BEFORE the tick stop check.
  let prefetchedBars: TradierBar[] | null = null;
  let runtimePatch: Partial<Alma939Runtime> | undefined;
  let effectiveTrailingStop: number | undefined =
    typeof runtime.trailingStop === "number" ? runtime.trailingStop : undefined;

  if (trailingNeedsBars) {
    const date = todayEt();
    const time = nowEtTime();
    if (time >= "09:30") {
      const barsRes = await getTimesales(cfg.mode, {
        symbol: trade.sourceTicker.toUpperCase(),
        interval: "5min",
        startEt: `${date} 09:30`,
        endEt: `${date} ${time}`,
      });
      if (barsRes.ok) {
        const bars = dropOpenBar(barsRes.data, time);
        const minBars = Math.max(exits.slowLen, exits.fastLen) + 1;
        if (bars.length >= minBars) {
          prefetchedBars = bars;
          const newTrail = computeTrailingStop(bars, side, runtime.trailingStop, exits);
          if (newTrail != null && newTrail !== runtime.trailingStop) {
            effectiveTrailingStop = newTrail;
            runtimePatch = { trailingStop: newTrail };
          }
        }
      }
    }
  }

  // ---- Underlying-priced stop / TP (cheapest check first) -----------------
  if (entryUnderlying != null && underlyingNow != null && Number.isFinite(underlyingNow)) {
    // STOP — trailing if configured, otherwise fixed.
    if (exits.useStopLoss) {
      if (exits.slMode === "trailing") {
        // Tick-priced check uses the FRESH trail level from the recompute
        // above. Floored at the fixed-stop distance from entry until price
        // has moved past that floor.
        const trailing =
          typeof effectiveTrailingStop === "number" ? effectiveTrailingStop : null;
        const fixedFloor =
          exits.fixedSlPct > 0
            ? side === "long"
              ? entryUnderlying * (1 - exits.fixedSlPct / 100)
              : entryUnderlying * (1 + exits.fixedSlPct / 100)
            : null;
        let stopLevel: number | null = trailing;
        if (fixedFloor != null) {
          stopLevel =
            stopLevel == null
              ? fixedFloor
              : side === "long"
                ? Math.max(stopLevel, fixedFloor)
                : Math.min(stopLevel, fixedFloor);
        }
        if (stopLevel != null) {
          const breached = side === "long" ? underlyingNow <= stopLevel : underlyingNow >= stopLevel;
          if (breached) {
            return {
              fire: true,
              kind: "full_close",
              reason: "stop",
              detail: {
                side,
                entryUnderlying,
                underlyingNow,
                stopLevel,
                trailing,
                slMode: exits.slMode,
                source: "alma_9_39_rsi.stop",
              },
            };
          }
        }
      } else if (Number.isFinite(exits.fixedSlPct) && exits.fixedSlPct > 0) {
        const stopLevel =
          side === "long"
            ? entryUnderlying * (1 - exits.fixedSlPct / 100)
            : entryUnderlying * (1 + exits.fixedSlPct / 100);
        const breached = side === "long" ? underlyingNow <= stopLevel : underlyingNow >= stopLevel;
        if (breached) {
          return {
            fire: true,
            kind: "full_close",
            reason: "stop",
            detail: {
              side,
              entryUnderlying,
              underlyingNow,
              stopLevel,
              fixedSlPct: exits.fixedSlPct,
              slMode: "fixed",
              source: "alma_9_39_rsi.stop",
            },
          };
        }
      }
    }
    // PROFIT TARGETS — scan in order; fire the first unfired level that hits.
    // Each TP closes a slice of originalQty. The final selected level (or any
    // single level if it's the only one enabled) full-closes the remainder.
    if (exits.useProfitTargets) {
      const enabledLevels = tps.filter((t) => t.enabled && t.pct > 0).map((t) => t.level);
      const lastEnabledLevel = enabledLevels.length > 0 ? enabledLevels[enabledLevels.length - 1] : null;
      // Iterate ascending so we always fire the smallest unfired hit first
      // (avoids skipping levels if price gaps past two at once).
      for (const tp of tps) {
        if (!tp.enabled || tp.pct <= 0) continue;
        if (firedLevels.has(tp.level)) continue;
        const target =
          side === "long"
            ? entryUnderlying * (1 + tp.pct / 100)
            : entryUnderlying * (1 - tp.pct / 100);
        const hit = side === "long" ? underlyingNow >= target : underlyingNow <= target;
        if (!hit) continue;

        const isLast = tp.level === lastEnabledLevel;
        const sliceQty = Math.max(1, Math.ceil((originalQty * tp.qtyPct) / 100));
        // If this is the final enabled TP, just full-close whatever remains.
        if (isLast || sliceQty >= remainingQty) {
          return {
            fire: true,
            kind: "full_close",
            reason: `target${tp.level}`,
            detail: {
              side,
              level: tp.level,
              entryUnderlying,
              underlyingNow,
              target,
              tpPct: tp.pct,
              qtyClosed: remainingQty,
              source: `alma_9_39_rsi.tp${tp.level}`,
            },
            runtimePatch: {
              tpsFiredAt: [
                ...tpsFired,
                {
                  level: tp.level,
                  triggerUnderlying: underlyingNow,
                  qty: remainingQty,
                  firedAt: new Date().toISOString(),
                },
              ],
            },
          };
        }
        return {
          fire: true,
          kind: "partial",
          level: tp.level,
          qtyToClose: sliceQty,
          reason: `target${tp.level}`,
          detail: {
            side,
            level: tp.level,
            entryUnderlying,
            underlyingNow,
            target,
            tpPct: tp.pct,
            tpQtyPct: tp.qtyPct,
            qtyClosed: sliceQty,
            remainingQty,
            originalQty,
            source: `alma_9_39_rsi.tp${tp.level}`,
          },
          runtimePatch: {
            tpsFiredAt: [
              ...tpsFired,
              {
                level: tp.level,
                triggerUnderlying: underlyingNow,
                qty: sliceQty,
                firedAt: new Date().toISOString(),
              },
            ],
          },
        };
      }
    }
  }

  // ---- ALMA + VWAP exits (need bars) -------------------------------------
  // If we already pre-fetched bars for trailing-stop maintenance, reuse them.
  // Otherwise (fixed-mode + ALMA/VWAP exits on), fetch now. If neither is
  // needed, we're done — return any runtimePatch we accumulated.
  if (!needBars) return { fire: false, runtimePatch };

  let bars: TradierBar[];
  if (prefetchedBars) {
    bars = prefetchedBars;
  } else {
    const date = todayEt();
    const time = nowEtTime();
    if (time < "09:30") return { fire: false, reason: "pre-market", runtimePatch };
    const barsRes = await getTimesales(cfg.mode, {
      symbol: trade.sourceTicker.toUpperCase(),
      interval: "5min",
      startEt: `${date} 09:30`,
      endEt: `${date} ${time}`,
    });
    if (!barsRes.ok) return { fire: false, reason: `bars: ${barsRes.reason}`, runtimePatch };
    bars = dropOpenBar(barsRes.data, time);
    const requiredBars = Math.max(exits.slowLen, exits.fastLen) + 1;
    if (bars.length < requiredBars) {
      return { fire: false, reason: `only ${bars.length} bars`, runtimePatch };
    }
  }

  // ---- Bar-close trailing-stop breach check ------------------------------
  // The tick-priced check above used the fresh trail level. This check
  // catches a bar that closed beyond the trail between tick samples.
  if (trailingNeedsBars && effectiveTrailingStop != null) {
    const lastBarClose = bars[bars.length - 1].close;
    const breached =
      side === "long" ? lastBarClose <= effectiveTrailingStop : lastBarClose >= effectiveTrailingStop;
    if (breached) {
      return {
        fire: true,
        kind: "full_close",
        reason: "stop",
        detail: {
          side,
          close: lastBarClose,
          trailingStop: effectiveTrailingStop,
          slMode: "trailing",
          trailUpdateMode: exits.trailUpdateMode,
          source: "alma_9_39_rsi.trailing_stop",
        },
        runtimePatch,
      };
    }
  }

  const closes = bars.map((b) => b.close);
  const currIdx = closes.length - 1;
  const prevIdx = currIdx - 1;
  const lastBar = bars[currIdx];
  const fastParams = { length: exits.fastLen, offset: exits.offset, sigma: exits.sigma };
  const slowParams = { length: exits.slowLen, offset: exits.offset, sigma: exits.sigma };
  const fastCurr = computeAlmaAt(closes, currIdx, fastParams);
  const fastPrev = computeAlmaAt(closes, prevIdx, fastParams);
  const slowCurr = computeAlmaAt(closes, currIdx, slowParams);
  const slowPrev = computeAlmaAt(closes, prevIdx, slowParams);
  if (fastCurr == null || fastPrev == null || slowCurr == null || slowPrev == null) {
    return { fire: false, reason: "ALMA undefined", runtimePatch };
  }
  const vwapCurr = sessionVwap(bars);
  const vwapPrev = sessionVwap(bars.slice(0, -1));
  if (vwapCurr == null || vwapPrev == null) return { fire: false, reason: "VWAP undefined", runtimePatch };

  // ---- ALMA exits ---------------------------------------------------------
  if (exits.useAlmaSignalExits) {
    const cross = detectCross(fastPrev, slowPrev, fastCurr, slowCurr);
    const almaCrossDown = cross === "below";
    const almaCrossUp = cross === "above";
    if (side === "long") {
      if (exits.useLongCloseBelowAlma39Exit && lastBar.close < slowCurr) {
        return {
          fire: true,
          kind: "full_close",
          reason: "alma_close_below_alma39",
          detail: { close: lastBar.close, alma39: slowCurr, source: "alma_9_39_rsi.alma_exit" },
          runtimePatch,
        };
      }
      if (exits.useLongAlmaCrossDownExit && almaCrossDown) {
        return {
          fire: true,
          kind: "full_close",
          reason: "alma_cross_down",
          detail: { fastCurr, slowCurr, fastPrev, slowPrev, source: "alma_9_39_rsi.alma_exit" },
          runtimePatch,
        };
      }
    } else {
      if (exits.useShortCloseAboveAlma39Exit && lastBar.close > slowCurr) {
        return {
          fire: true,
          kind: "full_close",
          reason: "alma_close_above_alma39",
          detail: { close: lastBar.close, alma39: slowCurr, source: "alma_9_39_rsi.alma_exit" },
          runtimePatch,
        };
      }
      if (exits.useShortAlmaCrossUpExit && almaCrossUp) {
        return {
          fire: true,
          kind: "full_close",
          reason: "alma_cross_up",
          detail: { fastCurr, slowCurr, fastPrev, slowPrev, source: "alma_9_39_rsi.alma_exit" },
          runtimePatch,
        };
      }
    }
  }

  // ---- VWAP exits ---------------------------------------------------------
  if (exits.useVwapExitRules) {
    const vwapCross = detectCross(fastPrev, vwapPrev, fastCurr, vwapCurr);
    const alma9CrossDownVwap = vwapCross === "below";
    const alma9CrossUpVwap = vwapCross === "above";
    if (side === "long") {
      if (exits.useLongCloseBelowVwapExit && lastBar.close < vwapCurr) {
        return {
          fire: true,
          kind: "full_close",
          reason: "vwap_close_below",
          detail: { close: lastBar.close, vwap: vwapCurr, source: "alma_9_39_rsi.vwap_exit" },
          runtimePatch,
        };
      }
      if (exits.useLongAlma9CrossBelowVwapExit && alma9CrossDownVwap && lastBar.close < vwapCurr) {
        return {
          fire: true,
          kind: "full_close",
          reason: "vwap_alma9_cross_down_confirmed",
          detail: { close: lastBar.close, vwap: vwapCurr, fastCurr, source: "alma_9_39_rsi.vwap_exit" },
          runtimePatch,
        };
      }
    } else {
      if (exits.useShortCloseAboveVwapExit && lastBar.close > vwapCurr) {
        return {
          fire: true,
          kind: "full_close",
          reason: "vwap_close_above",
          detail: { close: lastBar.close, vwap: vwapCurr, source: "alma_9_39_rsi.vwap_exit" },
          runtimePatch,
        };
      }
      if (exits.useShortAlma9CrossAboveVwapExit && alma9CrossUpVwap && lastBar.close > vwapCurr) {
        return {
          fire: true,
          kind: "full_close",
          reason: "vwap_alma9_cross_up_confirmed",
          detail: { close: lastBar.close, vwap: vwapCurr, fastCurr, source: "alma_9_39_rsi.vwap_exit" },
          runtimePatch,
        };
      }
    }
  }

  return { fire: false, runtimePatch };
}

// ---------------------------------------------------------------------------
// Top-level runner
// ---------------------------------------------------------------------------

export async function runAlma939Rsi(cfg: BotConfig): Promise<Alma939RunSummary> {
  const watchlist = (cfg.alma939Watchlist ?? []).filter(Boolean).map((t) => t.toUpperCase());
  const perTicker: Alma939TickerOutcome[] = [];
  for (const ticker of watchlist) {
    try {
      perTicker.push(await processAlma939RsiTicker({ config: cfg, ticker }));
    } catch (e) {
      perTicker.push({ ticker, outcome: "error", reason: `unexpected: ${String(e)}` });
    }
  }
  return { watchlist, perTicker };
}
