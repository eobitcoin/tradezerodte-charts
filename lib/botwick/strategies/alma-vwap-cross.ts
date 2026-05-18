/**
 * ALMA × VWAP Cross — Option 1 signal strategy.
 *
 * Per-tick, per-ticker flow:
 *
 *   1. Pull 5-min bars + session VWAP (already in MarketState).
 *   2. Compute ALMA(9, 6, 0.85) for the current closed bar AND the previous
 *      closed bar (we need both to detect a cross).
 *   3. If a cross just happened with steep slope → upsert bot_alma_state
 *      with side (long/short). Tape `signal_armed`-equivalent event.
 *   4. If we're already in READY state for this ticker → check pullback on
 *      the current bar. If pullback fires:
 *        a. Pull option chain for today's expiry (0DTE).
 *        b. Pick nearest OTM call/put.
 *        c. Compute mid; size contracts = floor(positionSizeUsd / (mid×100));
 *           clamp by maxRiskPerTradeUsd.
 *        d. Insert bot_trades(status=signal_fired) with the OCC.
 *        e. Delete bot_alma_state row (one-shot — won't refire today).
 *        f. submitAllFired in the monitor's Phase C picks it up.
 *
 * State lifecycle:
 *   - READY persists across ticks until: pullback fires, ALMA crosses back,
 *     or force-exit wipes everything at 15:55 ET.
 *   - We sweep stale rows (>1 day old) defensively at the top of each run.
 */

import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  botActions,
  botAlmaState,
  botTrades,
  type BotConfig,
} from "@/lib/db/schema";
import {
  computeAlmaAt,
  detectCross,
  isAlmaReversal,
  isPullback,
  isSteepInDirection,
  slopePctPerBar,
} from "../alma";
import {
  getOptionChain,
  getQuotes,
  getTimesales,
} from "../tradier-adapter";
import { pickNearestOtm } from "../strike-picker";
import { buildDefaultExits } from "../default-exits";
import { maxOpenPositionsGate } from "../risk";
import { todayEt, nowEtTime, sessionVwap, dropOpenBar } from "../util/bars";

const ALMA_LENGTH = 9;
const REQUIRED_BARS = ALMA_LENGTH + 1; // need 2 ALMA values → 10 bars min

/**
 * Wipe ALMA state from prior trading sessions. Cheap defensive sweep at the
 * start of each ALMA strategy run, so a forgotten row from yesterday can't
 * drive today's behavior.
 *
 * H6: Anchored to TODAY's 09:30 ET session open, not a 24h rolling window.
 * The old 24h window left Friday's last-bar READY state intact for
 * Monday's pre-market — opening tick of the new session would fire on
 * stale data. Now we sweep anything armed BEFORE today's 09:30 ET.
 */
async function sweepStaleAlmaState(): Promise<number> {
  const cutoff = todaySessionOpenUtc();
  const out = await db
    .delete(botAlmaState)
    .where(lt(botAlmaState.readyAt, cutoff))
    .returning({ ticker: botAlmaState.ticker });
  return out.length;
}

/** Returns today's 09:30 ET as a UTC Date. ET = UTC-5 (EST) or UTC-4 (EDT);
 *  Intl handles the DST math. */
function todaySessionOpenUtc(): Date {
  // Format today's date in ET to anchor the session-open instant.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const ymd = fmt.format(new Date()); // "YYYY-MM-DD"
  // 09:30 ET → use a parse that respects DST by going through Date with a
  // fixed offset string. ET is UTC-5 in winter, UTC-4 in summer; we let
  // Intl compute the offset by re-formatting back.
  // Trick: build a tagged ISO with no zone, then ask Intl for the offset.
  // Simpler: use Date.parse with explicit ET offset by approximation —
  // 09:30 ET is always one of these two UTC times: 13:30 (DST) or 14:30 (EST).
  // We can detect DST by checking whether 09:30 ET parses ahead or behind.
  const dstDate = new Date(`${ymd}T09:30:00-04:00`);
  const estDate = new Date(`${ymd}T09:30:00-05:00`);
  // Find which one round-trips to 09:30 in ET (i.e., which is correct today).
  const checkFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return checkFmt.format(dstDate) === "09:30" ? dstDate : estDate;
}

export type AlmaTickerOutcome = {
  ticker: string;
  outcome:
    | "no_bars"
    | "alma_skipped"
    | "cross_armed"
    | "cross_lost"
    | "ready_idle"
    | "pullback_fired"
    | "pullback_no_chain"
    | "pullback_no_otm"
    | "pullback_illiquid"
    | "pullback_size_zero"
    | "pullback_observed_only" // Option 3 mode: pullback detected but ALMA is a gate, not a trader
    | "skipped"                // e.g. stock_long mode + short signal
    | "error";
  reason?: string;
  detail?: Record<string, unknown>;
};


/**
 * Process ONE ticker for ALMA × VWAP. Pulls its own data (separate from
 * the monitor's buildMarketState path because we need 5-min bar closes
 * specifically and we want to be explicit about what we use).
 */
export async function processAlmaTicker(args: {
  config: BotConfig;
  ticker: string;
}): Promise<AlmaTickerOutcome> {
  const { config, ticker } = args;
  const sym = ticker.toUpperCase();

  // 1. Pull bars (today, 5-min, RTH).
  const date = todayEt();
  const time = nowEtTime();
  if (time < "09:30") {
    return { ticker: sym, outcome: "no_bars", reason: "pre-market" };
  }
  const barsRes = await getTimesales(config.mode, {
    symbol: sym,
    interval: "5min",
    startEt: `${date} 09:30`,
    endEt: `${date} ${time}`,
  });
  if (!barsRes.ok) {
    return { ticker: sym, outcome: "error", reason: `bars: ${barsRes.reason}` };
  }
  // Drop in-progress current bar — same logic as buildMarketState.
  const bars = dropOpenBar(barsRes.data, time);
  if (bars.length < REQUIRED_BARS) {
    return {
      ticker: sym,
      outcome: "alma_skipped",
      reason: `only ${bars.length} closed bars, need ${REQUIRED_BARS}`,
    };
  }

  // 2. Compute ALMA for current + previous closed bars.
  const closes = bars.map((b) => b.close);
  const currIdx = closes.length - 1;
  const prevIdx = closes.length - 2;
  const currAlma = computeAlmaAt(closes, currIdx);
  const prevAlma = computeAlmaAt(closes, prevIdx);
  if (currAlma == null || prevAlma == null) {
    return { ticker: sym, outcome: "alma_skipped", reason: "ALMA could not be computed" };
  }

  // VWAP at current and prior bar's close — bar-aligned, not instantaneous.
  const vwapCurr = sessionVwap(bars);
  const vwapPrev = sessionVwap(bars.slice(0, -1));
  if (vwapCurr == null || vwapPrev == null) {
    return { ticker: sym, outcome: "alma_skipped", reason: "no VWAP" };
  }

  // 3. Cross detection.
  const cross = detectCross(prevAlma, vwapPrev, currAlma, vwapCurr);
  const slope = slopePctPerBar(prevAlma, currAlma);

  // Read current READY state for this ticker.
  const [existing] = await db
    .select()
    .from(botAlmaState)
    .where(eq(botAlmaState.ticker, sym))
    .limit(1);

  // `armState` is the source of truth for "are we armed?" for the rest of
  // this function. Starts at whatever the DB said; gets replaced if a fresh
  // cross arms this tick (so the same tick can also evaluate same-bar
  // pullback without bouncing through another cron iteration).
  let armState: typeof existing | null = existing ?? null;

  if (cross) {
    // Cross fired this bar. If steep enough, ARM (upsert). If not, log and
    // do nothing — the next steep cross will eventually arm.
    const steep = isSteepInDirection(slope, cross, Number(config.almaSteepSlopePct));
    const side: "long" | "short" = cross === "above" ? "long" : "short";

    // If we had a READY in the OPPOSITE direction, that's a cross-back —
    // wipe it. A new steep cross in this direction installs READY here.
    if (existing && existing.side !== side) {
      await db.delete(botAlmaState).where(eq(botAlmaState.ticker, sym));
      armState = null;
    }

    if (!steep) {
      await logTape({
        kind: "signal_armed", // closest existing kind
        severity: "info",
        message: `${sym} ALMA × VWAP cross ${cross} but slope ${slope.toFixed(3)}% < threshold ${config.almaSteepSlopePct}% — not arming`,
        data: { ticker: sym, cross, slope, almaCurr: currAlma, almaPrev: prevAlma, vwapCurr },
      });
      return { ticker: sym, outcome: "cross_lost", reason: "slope below threshold", detail: { slope } };
    }

    const readyAt = new Date();
    await db
      .insert(botAlmaState)
      .values({
        ticker: sym,
        side,
        readyAt,
        almaAtCross: String(currAlma),
        vwapAtCross: String(vwapCurr),
        slopePctAtCross: String(slope),
      })
      .onConflictDoUpdate({
        target: botAlmaState.ticker,
        set: {
          side,
          readyAt,
          almaAtCross: String(currAlma),
          vwapAtCross: String(vwapCurr),
          slopePctAtCross: String(slope),
        },
      });

    await logTape({
      kind: "signal_armed",
      severity: "success",
      message: `${sym} ALMA × VWAP — READY (${side}). ALMA ${currAlma.toFixed(2)} crossed ${cross} VWAP ${vwapCurr.toFixed(2)}, slope ${slope.toFixed(3)}%. Awaiting pullback.`,
      data: { ticker: sym, side, currAlma, vwapCurr, slope, source: "alma_vwap_cross" },
    });

    armState = {
      ticker: sym,
      side,
      readyAt,
      almaAtCross: String(currAlma),
      vwapAtCross: String(vwapCurr),
      slopePctAtCross: String(slope),
    } as typeof existing;
    // INTENTIONAL: do NOT return here. Fall through to the pullback walk so
    // a single bar that BOTH crosses VWAP and wicks down to ALMA can fire
    // entry in the same tick (matches typical TradingView confirmation).
  }

  // No prior READY and no fresh arm → nothing to evaluate.
  if (!armState) {
    return { ticker: sym, outcome: "ready_idle", reason: "no cross and no prior READY" };
  }

  // 4. Pullback evaluation. Walk back through bars since READY (or up to
  //    LOOKBACK_BARS, whichever is larger) using each bar's own ALMA/VWAP.
  //    Cool-down semantics:
  //      - Within the cool-down window (N bars from armed bar), a close that
  //        crossed back through VWAP does NOT clear READY. We tolerate
  //        whippy bars and only fire on the first qualifying pullback.
  //      - Each bar's pullback check skips the close-still-holds guard
  //        during cool-down. After cool-down it's enforced again.
  //      - Pullback band: wick must reach ALMA but not go deeper than
  //        `almaPullbackThresholdPct`% beyond it (cap on "real reversal" depth).
  const lastBar = bars[bars.length - 1];
  const coolDownBars = Number(config.almaPullbackCoolDownBars ?? 5);
  const thresholdPct = Number(config.almaPullbackThresholdPct ?? 0.1);
  // Bars elapsed since the cross bar. Use bar timestamps so it survives
  // process restarts (no in-memory counter).
  const readyAtMs =
    armState.readyAt instanceof Date
      ? armState.readyAt.getTime()
      : new Date(armState.readyAt as string).getTime();
  const barsSinceReady = (b: (typeof bars)[number]): number => {
    if (b.timestamp == null) return Number.MAX_SAFE_INTEGER;
    // Tradier bar.timestamp is the bar's START (Unix seconds). Cross bar's
    // close ≈ readyAt, so a bar started after readyAt has elapsed >= 0.
    const diffMin = (b.timestamp * 1000 - readyAtMs) / 60_000;
    return Math.max(0, Math.floor(diffMin / 5));
  };

  const LOOKBACK_BARS = Math.max(6, coolDownBars + 1);
  const startIdx = Math.max(REQUIRED_BARS - 1, bars.length - LOOKBACK_BARS);

  let pullbackBar: (typeof bars)[number] | null = null;
  let pullbackBarTime: string | null = null;
  let pullbackBarElapsed = -1;
  for (let i = startIdx; i < bars.length; i++) {
    const b = bars[i];
    const almaAtI = computeAlmaAt(closes, i);
    if (almaAtI == null) continue;
    const vwapAtI = sessionVwap(bars.slice(0, i + 1));
    if (vwapAtI == null) continue;
    const elapsed = barsSinceReady(b);
    const inCoolDown = elapsed <= coolDownBars;
    if (
      isPullback({
        side: armState.side as "long" | "short",
        bar: { high: b.high, low: b.low, close: b.close },
        alma: almaAtI,
        vwap: vwapAtI,
        thresholdPct,
        // Inside cool-down we tolerate close on the wrong side of VWAP.
        // Outside cool-down, fall back to standard close-holds requirement.
        requireCloseHolds: !inCoolDown,
      })
    ) {
      pullbackBar = b;
      pullbackBarTime = (b as { time?: string }).time ?? null;
      pullbackBarElapsed = elapsed;
      break;
    }
  }

  // Close-still-holds guard. Only applies AFTER the cool-down window has
  // expired (during cool-down we deliberately ride out close re-crosses).
  const lastBarElapsed = barsSinceReady(lastBar);
  const pastCoolDown = lastBarElapsed > coolDownBars;
  if (pastCoolDown && !pullbackBar) {
    const closeStillHolds =
      armState.side === "long" ? lastBar.close > vwapCurr : lastBar.close < vwapCurr;
    if (!closeStillHolds) {
      await db.delete(botAlmaState).where(eq(botAlmaState.ticker, sym));
      await logTape({
        kind: "signal_armed",
        severity: "warn",
        message: `${sym} ALMA × VWAP — READY (${armState.side}) cleared post-cool-down, last close ${lastBar.close.toFixed(2)} re-crossed VWAP ${vwapCurr.toFixed(2)} (cool-down was ${coolDownBars} bars)`,
        data: { ticker: sym, side: armState.side, closeAt: lastBar.close, vwapCurr, coolDownBars, lastBarElapsed },
      });
      return { ticker: sym, outcome: "cross_lost", reason: "close re-crossed VWAP post-cool-down" };
    }
  }

  if (!pullbackBar) {
    const stillCoolingDown = lastBarElapsed <= coolDownBars;
    return {
      ticker: sym,
      outcome: "ready_idle",
      reason: stillCoolingDown
        ? `armed, in cool-down (${lastBarElapsed}/${coolDownBars} bars), waiting for pullback`
        : "armed but no pullback within window yet",
    };
  }

  // Option 3 mode: ALMA is a confirmation gate, not an independent trader.
  // Plan-based logic in processTrade reads bot_alma_state directly to decide
  // whether to promote armed→fired. We keep READY alive (do NOT delete it
  // on pullback) so subsequent plan-based ticks still see ALMA agreement.
  // The state's natural exit is force-exit at 15:55 or a contrary close.
  if (config.activeSignalStrategy === "alma_plus_plan") {
    await logTape({
      kind: "signal_armed",
      severity: "info",
      message: `${sym} ALMA pullback observed (${armState.side}) — gating plan-based trades, not firing standalone`,
      data: { ticker: sym, side: armState.side, almaPullbackObserved: true, pullbackBarTime },
    });
    return { ticker: sym, outcome: "pullback_observed_only", detail: { side: armState.side as "long" | "short" } };
  }

  // 5. Pullback fired — branch on instrument mode.
  const armSide = armState.side as "long" | "short";
  const instrument = config.almaInstrumentMode ?? "options";

  // B1: maxOpenPositions race-safe gate. Cheaper to check here before we
  // pull a chain + size the order. If we're already at cap, drop READY so
  // we re-arm cleanly on the next cross instead of looping on stale state.
  const inFlightGate = await maxOpenPositionsGate(config);
  if (!inFlightGate.ok) {
    await logTape({
      kind: "risk_block",
      severity: "warn",
      message: `${sym} — pullback fired but ${inFlightGate.reason}`,
      data: { ticker: sym, side: armSide, source: "alma_vwap_cross", reason: inFlightGate.reason },
    });
    await db.delete(botAlmaState).where(eq(botAlmaState.ticker, sym));
    return { ticker: sym, outcome: "skipped", reason: inFlightGate.reason };
  }

  // Stock-mode gating (matches Option 2):
  //   stock_long  → LONG fires, SHORT skip
  //   stock_short → SHORT fires, LONG skip
  //   stock_both  → both fire
  if (instrument === "stock_long" && armSide === "short") {
    await logTape({
      kind: "risk_block",
      severity: "warn",
      message: `${sym} — SHORT pullback skipped: instrument_mode=stock_long does not fire short signals.`,
      data: { ticker: sym, side: armSide, source: "alma_vwap_cross" },
    });
    await db.delete(botAlmaState).where(eq(botAlmaState.ticker, sym));
    return { ticker: sym, outcome: "skipped", reason: "stock_long mode + short signal" };
  }
  if (instrument === "stock_short" && armSide === "long") {
    await logTape({
      kind: "risk_block",
      severity: "warn",
      message: `${sym} — LONG pullback skipped: instrument_mode=stock_short does not fire long signals.`,
      data: { ticker: sym, side: armSide, source: "alma_vwap_cross" },
    });
    await db.delete(botAlmaState).where(eq(botAlmaState.ticker, sym));
    return { ticker: sym, outcome: "skipped", reason: "stock_short mode + long signal" };
  }
  const isStockMode = instrument === "stock_long" || instrument === "stock_short" || instrument === "stock_both";

  // Latest underlying price — both modes need it.
  const quoteRes = await getQuotes(config.mode, [sym]);
  if (!quoteRes.ok) {
    return { ticker: sym, outcome: "error", reason: `quote: ${quoteRes.reason}` };
  }
  const underlyingPrice = quoteRes.data[0]?.last ?? lastBar.close;
  if (!Number.isFinite(underlyingPrice)) {
    return { ticker: sym, outcome: "error", reason: "no underlying price" };
  }

  // Asset selection + sizing — diverges by instrument.
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
      return { ticker: sym, outcome: "error", reason: "maxStockNotionalUsd not set" };
    }
    const stockQty = Math.floor(stockCap / underlyingPrice);
    if (stockQty <= 0) {
      await logTape({
        kind: "risk_block",
        severity: "warn",
        message: `${sym} — pullback hit but stock size=0 (last $${underlyingPrice.toFixed(2)}, cap $${stockCap})`,
        data: { ticker: sym, last: underlyingPrice, cap: stockCap },
      });
      return { ticker: sym, outcome: "pullback_size_zero", reason: `last $${underlyingPrice} too large for $${stockCap} cap` };
    }
    assetPick = { instrument: "stock", qty: stockQty, priceAtSignal: underlyingPrice };
  } else {
    const optionType: "call" | "put" = armSide === "long" ? "call" : "put";
    const chainRes = await getOptionChain(config.mode, { symbol: sym, expiration: date });
    if (!chainRes.ok) {
      return { ticker: sym, outcome: "pullback_no_chain", reason: chainRes.reason };
    }
    const pick = pickNearestOtm({
      chain: chainRes.data,
      side: optionType,
      currentPrice: underlyingPrice,
    });
    if (!pick.ok) {
      return {
        ticker: sym,
        outcome:
          pick.code === "no_chain"
            ? "pullback_no_chain"
            : pick.code === "no_otm"
              ? "pullback_no_otm"
              : "pullback_illiquid",
        reason: pick.reason,
      };
    }
    const { contract, mid } = pick;
    if (mid == null) {
      return { ticker: sym, outcome: "pullback_illiquid", reason: "no live mid on picked contract" };
    }
    const positionSize = Number(config.positionSizeUsd);
    const maxPerTrade = Number(config.maxRiskPerTradeUsd);
    const effectiveBudget = Math.min(positionSize, maxPerTrade);
    const qty = Math.floor(effectiveBudget / (mid * 100));
    if (qty <= 0) {
      await logTape({
        kind: "risk_block",
        severity: "warn",
        message: `${sym} ${contract.symbol} — pullback hit but size=0 (mid $${mid.toFixed(2)}, budget $${effectiveBudget})`,
        data: { ticker: sym, mid, positionSize, maxPerTrade, qty },
      });
      return { ticker: sym, outcome: "pullback_size_zero", reason: `mid $${mid} too large for $${effectiveBudget} budget` };
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

  // 6. Insert the trade — strategy + legs shape differ by instrument.
  const tradeStrategy =
    assetPick.instrument === "stock"
      ? armSide === "long" ? "long_stock" : "short_stock"
      : armSide === "long"
        ? "long_call"
        : "long_put";

  const stockEntrySide: "buy" | "sell_short" = armSide === "long" ? "buy" : "sell_short";
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
        source: "alma_vwap_cross",
        side: armSide,
        instrument: assetPick.instrument,
        contract: planContract,
        entryMidEstimate,
        entryAt: {
          almaAtCross: armState.almaAtCross,
          vwapAtCross: armState.vwapAtCross,
          slopePctAtCross: armState.slopePctAtCross,
          readyAt: armState.readyAt,
        },
        pullbackBar: { high: pullbackBar.high, low: pullbackBar.low, close: pullbackBar.close, time: pullbackBarTime },
        // Synthesize exit AST from config defaults so the existing exit
        // evaluator + OMS exit path "just work" without strategy-specific
        // code. time_stop is anchored to the signal bar's ET time.
        ast: (() => {
          const d = buildDefaultExits(config, time);
          return {
            entry: null,
            target1: d.target1,
            target2: d.target2,
            stop: d.stop,
            time_stop: d.time_stop,
          };
        })(),
      },
      mode: config.mode,
      status: "signal_fired",
      entrySignaledAt: new Date(),
    })
    .returning({ id: botTrades.id });

  await db.delete(botAlmaState).where(eq(botAlmaState.ticker, sym));

  const fillNote =
    assetPick.instrument === "stock"
      ? `${armSide === "long" ? "buy" : "sell_short"} ${qty} sh @ ~$${entryMidEstimate.toFixed(2)} (last)`
      : `buy_to_open ${qty}× @ ~$${entryMidEstimate.toFixed(2)} (mid)`;
  const assetLabel =
    assetPick.instrument === "stock" ? `${sym} STOCK` : `${sym} ${assetPick.occSymbol}`;
  await logTape({
    kind: "signal_fired",
    severity: "success",
    message: `${assetLabel} — ALMA pullback fired (${armSide}) on bar +${pullbackBarElapsed} (cool-down ${coolDownBars}, threshold ${thresholdPct}%), ${fillNote}. OMS will submit.`,
    tradeId: inserted.id,
    data: {
      ticker: sym,
      side: armSide,
      instrument: assetPick.instrument,
      qty,
      entryMidEstimate,
      pullbackBarElapsed,
      coolDownBars,
      thresholdPct,
      source: "alma_vwap_cross",
      ...(assetPick.instrument === "option" && {
        optionType: assetPick.optionType,
        strike: assetPick.strike,
        occSymbol: assetPick.occSymbol,
      }),
    },
  });

  return {
    ticker: sym,
    outcome: "pullback_fired",
    detail: {
      side: armSide,
      instrument: assetPick.instrument,
      qty,
      mid: entryMidEstimate,
      ...(assetPick.instrument === "option" && { strike: assetPick.strike }),
    },
  };
}

export type AlmaRunSummary = {
  watchlist: string[];
  staleSwept: number;
  perTicker: AlmaTickerOutcome[];
};

/**
 * Entry point invoked by the monitor when `activeSignalStrategy === "alma_vwap_cross"`.
 */
/**
 * Optional ALMA-reversal exit check. Fetches today's 5-min bars for the
 * ticker, computes ALMA(9, 6, 0.85) for the current + previous closed bar,
 * and reports whether a cross fired AGAINST the open position's side.
 *
 *   LONG  + ALMA crosses below VWAP → reversal = true
 *   SHORT + ALMA crosses above VWAP → reversal = true
 *
 * Standalone — used by the OMS exit phase when `cfg.almaReversalExit` is on.
 * Cost: one Tradier `getTimesales` call per ticker per tick (only when the
 * option is enabled AND there are open trades on the ticker).
 */
export async function checkAlmaReversal(args: {
  cfg: BotConfig;
  ticker: string;
  side: "long" | "short";
}): Promise<{ matched: boolean; detail?: Record<string, unknown>; reason?: string }> {
  const { cfg, ticker, side } = args;
  const date = todayEt();
  const time = nowEtTime();
  if (time < "09:30") return { matched: false, reason: "pre-market" };

  const barsRes = await getTimesales(cfg.mode, {
    symbol: ticker,
    interval: "5min",
    startEt: `${date} 09:30`,
    endEt: `${date} ${time}`,
  });
  if (!barsRes.ok) return { matched: false, reason: `bars: ${barsRes.reason}` };
  const bars = dropOpenBar(barsRes.data, time);
  if (bars.length < REQUIRED_BARS) {
    return { matched: false, reason: `only ${bars.length} closed bars` };
  }

  const closes = bars.map((b) => b.close);
  const currAlma = computeAlmaAt(closes, closes.length - 1);
  const prevAlma = computeAlmaAt(closes, closes.length - 2);
  if (currAlma == null || prevAlma == null) {
    return { matched: false, reason: "ALMA undefined" };
  }
  const vwapCurr = sessionVwap(bars);
  const vwapPrev = sessionVwap(bars.slice(0, -1));
  if (vwapCurr == null || vwapPrev == null) {
    return { matched: false, reason: "VWAP undefined" };
  }

  const matched = isAlmaReversal({
    side,
    prevAlma,
    prevVwap: vwapPrev,
    currAlma,
    currVwap: vwapCurr,
  });
  return {
    matched,
    detail: {
      side,
      prevAlma,
      prevVwap: vwapPrev,
      currAlma,
      currVwap: vwapCurr,
    },
  };
}

/**
 * Price-Reversal ALMA exit check. Fires when the most recent CLOSED bar's
 * close has moved against the position's side by more than the configured
 * threshold beyond ALMA9. Earlier signal than `checkAlmaReversal` (which
 * waits for the ALMA line itself to cross VWAP) — this watches the price
 * directly.
 *
 *   LONG  → bar.close < ALMA × (1 − threshold/100)   ⇒ matched
 *   SHORT → bar.close > ALMA × (1 + threshold/100)   ⇒ matched
 *
 * GRACE PERIOD: When `filledAt` is provided AND fewer than
 * `cfg.priceReversalAlmaGraceBars` (default 5) 5-min bars have elapsed
 * since the fill, the check is skipped (matched: false, reason: "grace").
 * Lets a fresh trade develop ~25 min before the price-reversal exit can
 * kick it out.
 *
 * Cost: one Tradier `getTimesales` per ticker per tick (same as
 * `checkAlmaReversal`).
 */
export async function checkPriceAlmaBreak(args: {
  cfg: BotConfig;
  ticker: string;
  side: "long" | "short";
  filledAt?: Date | null;
}): Promise<{ matched: boolean; detail?: Record<string, unknown>; reason?: string }> {
  const { cfg, ticker, side, filledAt } = args;
  const date = todayEt();
  const time = nowEtTime();
  if (time < "09:30") return { matched: false, reason: "pre-market" };

  // Grace-period gate. 5-min bars; we count elapsed bars conservatively
  // (floor of minutes/5). When `filledAt` is missing we can't enforce
  // the grace, so we DON'T skip — better to fire the exit than silently
  // disable risk control.
  const graceBars = Math.max(0, Number(cfg.priceReversalAlmaGraceBars ?? 5));
  if (graceBars > 0 && filledAt) {
    const minutesSinceFill = (Date.now() - filledAt.getTime()) / 60_000;
    const barsSinceFill = Math.floor(minutesSinceFill / 5);
    if (barsSinceFill < graceBars) {
      return {
        matched: false,
        reason: "grace",
        detail: {
          barsSinceFill,
          graceBars,
          filledAt: filledAt.toISOString(),
        },
      };
    }
  }

  const barsRes = await getTimesales(cfg.mode, {
    symbol: ticker,
    interval: "5min",
    startEt: `${date} 09:30`,
    endEt: `${date} ${time}`,
  });
  if (!barsRes.ok) return { matched: false, reason: `bars: ${barsRes.reason}` };
  const bars = dropOpenBar(barsRes.data, time);
  if (bars.length < REQUIRED_BARS) {
    return { matched: false, reason: `only ${bars.length} closed bars` };
  }

  const closes = bars.map((b) => b.close);
  const lastBar = bars[bars.length - 1];
  const currAlma = computeAlmaAt(closes, closes.length - 1);
  if (currAlma == null || !Number.isFinite(lastBar.close)) {
    return { matched: false, reason: "ALMA or close undefined" };
  }
  const thresholdPct = Math.max(0, Number(cfg.priceReversalAlmaThresholdPct ?? 0.05));
  const band = currAlma * (thresholdPct / 100);
  const matched =
    side === "long"
      ? lastBar.close < currAlma - band
      : lastBar.close > currAlma + band;
  return {
    matched,
    detail: {
      side,
      close: lastBar.close,
      alma: currAlma,
      thresholdPct,
      band,
      lowerBound: currAlma - band,
      upperBound: currAlma + band,
    },
  };
}

export async function runAlmaVwapCross(cfg: BotConfig): Promise<AlmaRunSummary> {
  const staleSwept = await sweepStaleAlmaState();
  const watchlist = (cfg.almaWatchlist ?? []).filter(Boolean).map((t) => t.toUpperCase());

  const perTicker: AlmaTickerOutcome[] = [];
  for (const ticker of watchlist) {
    try {
      perTicker.push(await processAlmaTicker({ config: cfg, ticker }));
    } catch (e) {
      perTicker.push({ ticker, outcome: "error", reason: `unexpected: ${String(e)}` });
    }
  }
  return { watchlist, staleSwept, perTicker };
}

// ---------------------------------------------------------------------------
// Bar utilities — duplicate-but-tiny from market-data.ts to keep this module
// independent (it has its own bar-pull, its own VWAP, etc.).
// ---------------------------------------------------------------------------


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
