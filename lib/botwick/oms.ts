/**
 * BotWick OMS — entry submission + working/open reconciliation.
 *
 * Submits ENTRY orders for `signal_fired` trades and reconciles `working`
 * trades against Tradier order state. Exits land in oms exit paths.
 *
 * Order shape (entry):
 *   class=option, side=buy_to_open, type=limit, price=live_mid, duration=day,
 *   quantity = floor(min(positionSizeUsd, maxRiskPerTradeUsd) / (live_mid×100)).
 *
 * Sizing — single golden source: `bot_config.positionSizeUsd` is the intent;
 * `maxRiskPerTradeUsd` is the hard cap that clamps it. ALL strategies converge
 * here regardless of where they computed an initial qty (the strategy's
 * pre-computed qty is overwritten at submit time with the live-mid recompute).
 *
 * Safety: the **four-of-four gate** is re-checked at the moment of every
 * order submission. The bot may have been disabled between signal_fired
 * and now; we want a fresh read of bot_config every time.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  botActions,
  botConfig,
  botTrades,
  type BotConfig,
  type BotTrade,
} from "@/lib/db/schema";
import {
  cancelOrder,
  getOrderStatus,
  getOptionQuote,
  getQuotes,
  getBalances,
  stockBuyingPowerOf,
  submitOrder,
  type TradierOrderStatus,
} from "./tradier-adapter";
import { liveMid, maxOpenPositionsGate } from "./risk";
import { resolveOcc } from "./occ";
import { evaluate, type ConditionResult, type MarketState } from "./evaluator";
import type { Condition, TriggerAST } from "./types";
import { checkAlmaReversal, checkPriceAlmaBreak } from "./strategies/alma-vwap-cross";
import { checkAlma939Exits } from "./strategies/alma-9-39-rsi";

// ---------------------------------------------------------------------------
// Four-of-four gate
// ---------------------------------------------------------------------------

export type GateResult =
  | { ok: true }
  | { ok: false; reason: string; code: GateBlockCode };

export type GateBlockCode =
  | "bot_disabled"
  | "kill_switch"
  | "mode_off"
  | "live_not_confirmed";

/**
 * The contract for ANY order submission. The OMS calls this immediately
 * before each POST so a config change between signal-fire and submit gets
 * picked up. Mirrors §6.5 of the architecture doc.
 */
export function checkFourOfFourGate(cfg: BotConfig): GateResult {
  if (cfg.killSwitchEngaged) {
    return { ok: false, code: "kill_switch", reason: "kill switch engaged" };
  }
  if (!cfg.enabled) {
    return { ok: false, code: "bot_disabled", reason: "bot disabled" };
  }
  if (cfg.mode === "off") {
    return { ok: false, code: "mode_off", reason: "mode is off" };
  }
  // Live mode additionally requires explicit liveOrdersConfirmed.
  // Paper mode does NOT — sandbox can't move real money.
  if (cfg.mode === "live" && !cfg.liveOrdersConfirmed) {
    return {
      ok: false,
      code: "live_not_confirmed",
      reason: "mode=live requires live_orders_confirmed=true (admin must toggle)",
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Entry order submission
// ---------------------------------------------------------------------------

export type SubmitEntryOutcome =
  | { ok: true; orderId: string; price: number; quantity: number }
  | { ok: false; reason: string; code: string };

/**
 * Submit a single entry order for a trade in `signal_fired` status.
 * Re-fetches the option quote at the moment of submission so the limit
 * price is fresh — Tradier may have moved between Phase 3b re-check and now.
 */
export async function submitEntryOrder(
  trade: BotTrade,
  cfg: BotConfig,
): Promise<SubmitEntryOutcome> {
  // Re-check the gate immediately before the POST. Cheap insurance.
  const gate = checkFourOfFourGate(cfg);
  if (!gate.ok) return { ok: false, code: gate.code, reason: gate.reason };

  // B1: re-prove maxOpenPositions at submit time. The strategy entry checked
  // this when it inserted the row, but between then and now another trade
  // could have moved into a counted status. The signal_fired row we're about
  // to submit is NOT counted by the gate (in-flight = submitting/working/
  // open/closing) so this is correct.
  const opGate = await maxOpenPositionsGate(cfg);
  if (!opGate.ok) {
    return { ok: false, code: "max_open_positions", reason: opGate.reason };
  }

  const leg = (trade.legs as Array<Record<string, unknown>>)[0];
  if (!leg) return { ok: false, code: "no_leg", reason: "trade.legs is empty" };

  // ── Stock-mode entry (instrument=stock on the leg) ─────────────────────
  // MARKET buy (long) or sell_short (short) on the underlying. Sized against
  // maxStockNotionalUsd capped by Tradier's reported stock buying power.
  // Short entries additionally require account_type !== "cash" (Tradier will
  // reject them anyway, but we surface a cleaner error).
  if ((leg as Record<string, unknown>).instrument === "stock") {
    const sym = ((leg.symbol as string | undefined) ?? trade.sourceTicker).toUpperCase();
    const isShort = (leg as Record<string, unknown>).side === "sell_short" || trade.strategy === "short_stock";
    const qres = await getQuotes(cfg.mode, [sym]);
    if (!qres.ok) return { ok: false, code: qres.code, reason: qres.reason };
    const last = qres.data[0]?.last;
    if (last == null || !Number.isFinite(last) || last <= 0) {
      return { ok: false, code: "no_live_mid", reason: `no live price for ${sym}` };
    }
    const balRes = await getBalances(cfg.mode);
    if (!balRes.ok) return { ok: false, code: balRes.code, reason: balRes.reason };

    // Short pre-flight: must be a margin account. Cash accounts can't short.
    if (isShort) {
      const acct = balRes.data?.account_type ?? "";
      if (acct === "cash") {
        return {
          ok: false,
          code: "kill_switch",
          reason: `cannot short ${sym}: Tradier account_type=cash. Short-selling requires a margin account.`,
        };
      }
    }

    const buyingPower = stockBuyingPowerOf(balRes.data);
    const stockCap = Number(cfg.maxStockNotionalUsd);
    const effectiveBudget = Math.min(stockCap, buyingPower);
    const computedQty = Math.floor(effectiveBudget / last);
    if (computedQty <= 0) {
      return {
        ok: false,
        code: "size_zero",
        reason: `${sym} last $${last.toFixed(2)} too high for effective budget $${effectiveBudget.toFixed(2)} (cap=$${stockCap}, BP=$${buyingPower.toFixed(2)})`,
      };
    }

    // PDT awareness — non-blocking. Margin/PDT accounts under $25k equity
    // count every same-day round-trip toward the 4-in-5-days limit.
    // M5: renamed from `eq` to `equity` to avoid shadowing drizzle's `eq()`.
    const equity = balRes.data?.total_equity ?? 0;
    const acct = balRes.data?.account_type ?? "";
    if (equity > 0 && equity < 25000 && (acct === "margin" || acct === "pdt")) {
      await logTape({
        kind: "risk_block",
        severity: "warn",
        message: `${sym} stock entry — account equity $${equity.toFixed(0)} below $25k PDT threshold; intraday round-trips count toward 4-in-5-day limit (account_type=${acct})`,
        tradeId: trade.id,
        data: { equity, accountType: acct, source: "pdt_warning" },
      });
    }

    const sub = await submitOrder(cfg.mode, {
      instrument: "stock",
      underlying: sym,
      side: isShort ? "sell_short" : "buy",
      quantity: computedQty,
      type: "market",
      duration: "day",
    });
    if (!sub.ok) return { ok: false, code: sub.code, reason: sub.reason };
    return { ok: true, orderId: String(sub.data.id), price: last, quantity: computedQty };
  }

  // ── Option-mode entry (existing path) ──────────────────────────────────
  // Prefer the OCC stored on the leg at ingest. If the plan didn't embed
  // one (most don't), resolveOcc constructs it from strike/expiry/type.
  // resolveOcc also handles legacy rows that predate plan.contract.
  let occSymbol = (leg.occ_symbol as string | null) ?? null;
  if (!occSymbol) {
    const occ = resolveOcc(trade);
    if (!occ.ok) return { ok: false, code: "no_occ", reason: occ.reason };
    occSymbol = occ.occSymbol;
  }

  // Fresh quote — Tradier may have moved.
  const qres = await getOptionQuote(cfg.mode, occSymbol);
  if (!qres.ok) return { ok: false, code: qres.code, reason: qres.reason };
  const q = qres.data;
  const mid = q == null ? null : liveMid({ bid: q.bid, ask: q.ask, last: q.last });
  if (mid == null) {
    return {
      ok: false,
      code: "no_live_mid",
      reason: `live mid unavailable for ${occSymbol} at submit time`,
    };
  }

  // H4: Plan-slippage guard against the strategy's signal-time mid estimate.
  // ALMA strategies bake `entryMidEstimate` into `trade.plan` at signal time
  // but didn't previously re-check it at submit. If the option mid has run
  // far from where the signal fired (volatility spike, queue), refuse to
  // submit — we'd be paying a price the strategy never approved.
  const planObj = (trade.plan ?? {}) as Record<string, unknown>;
  const planMid =
    typeof planObj.entryMidEstimate === "number" && Number.isFinite(planObj.entryMidEstimate)
      ? planObj.entryMidEstimate
      : null;
  if (planMid != null && planMid > 0) {
    const slippageCap = Number(cfg.maxPlanSlippagePct) / 100;
    const drift = (mid - planMid) / planMid;
    if (Math.abs(drift) > slippageCap) {
      return {
        ok: false,
        code: "plan_slippage",
        reason: `live mid $${mid.toFixed(2)} is ${(drift * 100).toFixed(0)}% ${drift > 0 ? "above" : "below"} plan $${planMid.toFixed(2)} (cap ${(slippageCap * 100).toFixed(0)}%)`,
      };
    }
  }

  // Submit-time sizing — single golden source for every strategy.
  //
  //   budget = min(positionSizeUsd, maxRiskPerTradeUsd)
  //   qty    = floor(budget / (live_mid × 100))
  //
  // Strategies write an initial qty on `leg` when they create the trade
  // (ALMA uses live mid at fire time, plan-based uses plan mid). Both are
  // overwritten here using the **live mid at submit moment**, which can be
  // minutes-to-hours fresher. `leg.qty` is then patched to match what was
  // actually sent so the audit and UI never lie.
  const positionSize = Number(cfg.positionSizeUsd);
  const perTradeCap = Number(cfg.maxRiskPerTradeUsd);
  const budget = Math.min(positionSize, perTradeCap);
  const computedQty = Math.floor(budget / (mid * 100));
  if (computedQty <= 0) {
    return {
      ok: false,
      code: "size_zero",
      reason: `live mid $${mid.toFixed(2)} too high for budget $${budget.toFixed(2)} (one contract = $${(mid * 100).toFixed(2)})`,
    };
  }

  // Submit.
  const sub = await submitOrder(cfg.mode, {
    instrument: "option",
    underlying: trade.sourceTicker,
    optionSymbol: occSymbol,
    side: "buy_to_open",
    quantity: computedQty,
    type: "limit",
    price: Number(mid.toFixed(2)),
    duration: "day",
  });
  if (!sub.ok) return { ok: false, code: sub.code, reason: sub.reason };

  return { ok: true, orderId: String(sub.data.id), price: Number(mid.toFixed(2)), quantity: computedQty };
}

/**
 * Process ALL trades in `signal_fired` for this tick. Returns per-trade
 * outcomes; the caller (monitor) folds them into the tick summary.
 *
 * Each trade goes through a 3-step state machine to keep DB and broker in
 * sync even if the process crashes mid-flight:
 *   1. CLAIM:   signal_fired → submitting   (atomic; no-op if lost the race)
 *   2. POST:    Tradier submitOrder
 *   3. COMMIT:  submitting → working + tradierOrderId   (on POST success)
 *               OR submitting → signal_fired             (on POST failure, retry next tick)
 *
 * If the process dies between step 1 and step 3, the trade is stuck in
 * `submitting`. The broker-reconcile job sweeps stuck rows by querying
 * Tradier orders and either attaches the found order (→ working) or
 * releases the claim (→ signal_fired) so the next tick retries.
 */
export async function submitAllFired(cfg: BotConfig): Promise<
  Array<{
    tradeId: string;
    ticker: string;
    outcome: "submitted" | "blocked" | "error" | "claim_lost";
    orderId?: string;
    price?: number;
    quantity?: number;
    reason?: string;
    code?: string;
  }>
> {
  const trades = await db
    .select()
    .from(botTrades)
    .where(eq(botTrades.status, "signal_fired"));

  const outcomes: Awaited<ReturnType<typeof submitAllFired>> = [];
  for (const trade of trades) {
    // STEP 1 — Atomic claim. signal_fired → submitting. If another writer
    // beat us (advisory lock leak, manual intervention, force-exit at the
    // same moment), the UPDATE returns zero rows and we skip silently.
    const claimed = await db
      .update(botTrades)
      .set({ status: "submitting", submittingAt: new Date() })
      .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "signal_fired")))
      .returning({ id: botTrades.id });
    if (claimed.length === 0) {
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        outcome: "claim_lost",
        reason: "row no longer in signal_fired at claim time",
      });
      continue;
    }

    // STEP 2 — POST to Tradier. If this throws or the process dies, the row
    // stays in `submitting` and broker-reconcile will sweep it.
    const res = await submitEntryOrder(trade, cfg);

    if (!res.ok) {
      // H3: Distinguish "Tradier definitely didn't get the order" failures
      // (auth, bad_response, rate_limited, no_token, gates) from "we don't
      // know if Tradier got it" failures (network, server_error, timeout).
      // For the second group we KEEP the row in `submitting` so the broker-
      // reconcile sweep (which looks up by OCC + side) can find the order
      // if Tradier actually received it. Releasing to `signal_fired` would
      // double-submit on the next tick.
      const ambiguousFailure =
        res.code === "network" ||
        res.code === "server_error" ||
        res.code === "timeout";
      if (!ambiguousFailure) {
        // Definitive failure → release the claim so next tick can retry.
        await db
          .update(botTrades)
          .set({ status: "signal_fired" })
          .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "submitting")));
      }
      await logTape({
        kind: res.code === "live_not_confirmed" || res.code.startsWith("bot_") || res.code === "kill_switch" || res.code === "mode_off"
          ? "risk_block"
          : "error",
        severity: "warn",
        message: `${trade.sourceTicker} ${trade.strategy} — submit ${ambiguousFailure ? "AMBIGUOUS" : "blocked"}: ${res.reason}${ambiguousFailure ? " (left in submitting; broker-reconcile will sweep)" : ""}`,
        tradeId: trade.id,
        data: { code: res.code, reason: res.reason, ambiguousFailure },
      });
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        outcome: "blocked",
        reason: res.reason,
        code: res.code,
      });
      continue;
    }

    // STEP 3 — Commit. submitting → working + tradierOrderId. Patch leg.qty
    // so the audit reflects what was actually sent (submit-time sizing may
    // differ from the ingest-time estimate).
    const legsArr = (trade.legs as Array<Record<string, unknown>>).slice();
    if (legsArr[0]) legsArr[0] = { ...legsArr[0], qty: res.quantity };
    const updated = await db
      .update(botTrades)
      .set({
        status: "working",
        tradierOrderId: res.orderId,
        submittedAt: new Date(),
        legs: legsArr,
      })
      .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "submitting")))
      .returning({ id: botTrades.id });

    if (updated.length === 0) {
      // Should be effectively impossible — submitting is owned by us. If it
      // happens (manual DB intervention, schema bug), cancel the order so
      // we don't leave a fillable orphan.
      const cancel = await cancelOrder(cfg.mode, res.orderId);
      await logTape({
        kind: "error",
        severity: "error",
        message: cancel.ok
          ? `${trade.sourceTicker} — race: trade no longer in 'submitting' when commit ran; order ${res.orderId} cancelled.`
          : `${trade.sourceTicker} — race: orphan order ${res.orderId} + cancel ALSO failed (${cancel.reason}). MANUAL ACTION REQUIRED.`,
        tradeId: trade.id,
        data: {
          orderId: res.orderId,
          leakedOrder: true,
          cancelAttempted: true,
          cancelOk: cancel.ok,
          cancelReason: cancel.ok ? null : cancel.reason,
        },
      });
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        outcome: "error",
        reason: cancel.ok
          ? "commit race; orphan auto-cancelled"
          : `commit race; orphan cancel failed: ${cancel.reason}`,
      });
      continue;
    }

    await logTape({
      kind: "order_submitted",
      severity: "success",
      message: `${trade.sourceTicker} buy_to_open ${res.quantity}x @ ${res.price} (limit) — order ${res.orderId}`,
      tradeId: trade.id,
      data: {
        ticker: trade.sourceTicker,
        orderId: res.orderId,
        price: res.price,
        quantity: res.quantity,
        mode: cfg.mode,
      },
    });
    outcomes.push({
      tradeId: trade.id,
      ticker: trade.sourceTicker,
      outcome: "submitted",
      orderId: res.orderId,
      price: res.price,
      quantity: res.quantity,
    });
  }

  return outcomes;
}

// ---------------------------------------------------------------------------
// Exit evaluation + submission (Phase 5)
// ---------------------------------------------------------------------------

/**
 * Which exit branch fired. Priority is stop > target > time_stop so the
 * tape event is honest about *why* we closed even when multiple branches
 * matched in the same tick.
 */
export type ExitReason =
  | "stop"
  | "alma_break"
  | "alma_reversal"
  | "target"
  | "time_stop"
  | "alma939"; // ALMA 9/39 RSI strategy exit — always MARKET

export type ExitDecision =
  | { fire: false; details: { branch: keyof TriggerAST; result: ConditionResult | null }[] }
  | { fire: true; reason: ExitReason; details: { branch: keyof TriggerAST; result: ConditionResult | null }[] };

/**
 * Run the exit AST against a fully-hydrated MarketState (including entryFill
 * + currentMid). Pure function — no I/O. The caller is responsible for
 * filling those two extra fields before invoking.
 */
export function evaluateExits(ast: TriggerAST | null, state: MarketState): ExitDecision {
  const details: { branch: keyof TriggerAST; result: ConditionResult | null }[] = [];
  function check(branch: keyof TriggerAST): ConditionResult | null {
    const cond = ast?.[branch] as Condition | null | undefined;
    if (!cond) {
      details.push({ branch, result: null });
      return null;
    }
    const r = evaluate(cond, state);
    details.push({ branch, result: r });
    return r;
  }
  const stop = check("stop");
  const target1 = check("target1");
  const target2 = check("target2");
  const timeStop = check("time_stop");

  if (stop?.matched) return { fire: true, reason: "stop", details };
  if (target1?.matched || target2?.matched) return { fire: true, reason: "target", details };
  if (timeStop?.matched) return { fire: true, reason: "time_stop", details };
  return { fire: false, details };
}

export type SubmitExitOutcome =
  | { ok: true; orderId: string; price: number | "market"; reason: ExitReason }
  | { ok: false; reason: string; code: string };

/**
 * Submit a sell_to_close. The order *type* depends on the exit reason:
 *
 *   - "target"     → LIMIT at the current bid/ask mid. No urgency; capture
 *                    a good fill. `mid` MUST be a number.
 *   - "stop"       → MARKET. The position is bleeding; fill matters more
 *                    than price. `mid` is ignored.
 *   - "time_stop"  → MARKET. Time has run out; just exit. `mid` is ignored.
 *
 * Same four-of-four gate as entries — even on exits we re-check in case the
 * admin flipped the kill switch during the tick.
 */
export async function submitExitOrder(
  trade: BotTrade,
  cfg: BotConfig,
  reason: ExitReason,
  mid: number | null,
  occSymbol: string,
  qtyOverride?: number,
): Promise<SubmitExitOutcome> {
  const gate = checkFourOfFourGate(cfg);
  if (!gate.ok) return { ok: false, code: gate.code, reason: gate.reason };

  const leg = (trade.legs as Array<Record<string, unknown>>)[0];
  const legQty = (leg?.qty as number) ?? 1;
  // Partial closes pass an explicit qty < legQty. Clamp defensively so we
  // never accidentally over-close.
  const qty = qtyOverride != null && qtyOverride > 0 ? Math.min(qtyOverride, legQty) : legQty;

  const useMarket =
    reason === "stop" ||
    reason === "time_stop" ||
    reason === "alma_reversal" ||
    reason === "alma_break" ||
    reason === "alma939";

  // Stock legs always exit MARKET, so the option-style `target needs a mid`
  // guard doesn't apply to them.
  const isStockLeg = (leg as Record<string, unknown>)?.instrument === "stock";
  if (!useMarket && mid == null && !isStockLeg) {
    return {
      ok: false,
      code: "no_live_mid",
      reason: `target exit needs a live mid to price the limit order`,
    };
  }

  // M4: Spread sanity check before MARKET option exit. A 0DTE option that
  // has gone illiquid (wide bid/ask) can fill far below mid on a MARKET
  // order. Re-fetch the quote at submit-time and log a tape warning if
  // the spread is unreasonable, so the admin sees what we're doing.
  // The order still goes through — exits must fire — but the warning
  // surfaces the slippage risk for after-action review.
  if (useMarket && !isStockLeg) {
    try {
      const sanityQuote = await getOptionQuote(cfg.mode, occSymbol);
      if (sanityQuote.ok && sanityQuote.data) {
        const { bid, ask } = sanityQuote.data;
        if (bid != null && ask != null && bid > 0 && ask > bid) {
          const spread = ask - bid;
          const midPx = (ask + bid) / 2;
          const spreadPct = (spread / midPx) * 100;
          if (spreadPct > 25) {
            await logTape({
              kind: "risk_block",
              severity: "warn",
              message: `${trade.sourceTicker} ${occSymbol} — about to MARKET exit on WIDE SPREAD bid=$${bid} ask=$${ask} (${spreadPct.toFixed(0)}% of mid). Expect slippage. Reason: ${reason}.`,
              tradeId: trade.id,
              data: { bid, ask, spread, spreadPct, reason, occSymbol },
            });
          }
        }
      }
    } catch {
      // Soft-fail: if the spread check fails, proceed with MARKET anyway.
    }
  }

  // Stock long → sell. Stock short → buy_to_cover. Option → sell_to_close.
  // We detect "short" via the trade's recorded strategy (short_stock) since
  // leg.side might still be the entry side ("sell_short") at this point.
  const isStockShortLeg = isStockLeg && trade.strategy === "short_stock";
  const sub = await submitOrder(
    cfg.mode,
    isStockLeg
      ? {
          instrument: "stock",
          underlying: trade.sourceTicker,
          side: isStockShortLeg ? "buy_to_cover" : "sell",
          quantity: qty,
          // Stock exits ALWAYS go MARKET. Bid/ask spreads on liquid names
          // are tight enough that limit-at-mid offers no edge for an exit,
          // and missed fills bleed away the win we just earned.
          type: "market",
          duration: "day",
        }
      : useMarket
        ? {
            instrument: "option",
            underlying: trade.sourceTicker,
            optionSymbol: occSymbol,
            side: "sell_to_close",
            quantity: qty,
            type: "market",
            duration: "day",
          }
        : {
            instrument: "option",
            underlying: trade.sourceTicker,
            optionSymbol: occSymbol,
            side: "sell_to_close",
            quantity: qty,
            type: "limit",
            price: Number(mid!.toFixed(2)),
            duration: "day",
          },
  );
  if (!sub.ok) return { ok: false, code: sub.code, reason: sub.reason };
  return {
    ok: true,
    orderId: String(sub.data.id),
    price: useMarket ? "market" : Number(mid!.toFixed(2)),
    reason,
  };
}

/**
 * Process exits for every `open` trade on a ticker. The caller passes the
 * underlying MarketState (built once per ticker upstream); we layer in the
 * per-trade option mid + entry fill before evaluating.
 */
export async function processOpenExitsForTicker(args: {
  cfg: BotConfig;
  ticker: string;
  baseState: MarketState;
}): Promise<
  Array<{
    tradeId: string;
    ticker: string;
    outcome:
      | "no_match"
      | "no_quote"
      | "no_occ"
      | "fired_stop"
      | "fired_target"
      | "fired_time_stop"
      | "fired_alma_reversal"
      | "fired_alma_break"
      | "submit_blocked"
      | "submit_error"
      | "no_entry_fill";
    reason?: string;
  }>
> {
  const { cfg, ticker, baseState } = args;
  const rows = await db
    .select()
    .from(botTrades)
    .where(and(eq(botTrades.status, "open"), eq(botTrades.sourceTicker, ticker)));

  const out: Awaited<ReturnType<typeof processOpenExitsForTicker>> = [];
  for (const trade of rows) {
    if (trade.entryFillUsd == null) {
      out.push({ tradeId: trade.id, ticker, outcome: "no_entry_fill" });
      continue;
    }
    const plan = (trade.plan ?? {}) as Record<string, unknown>;
    const tradeSideForStrategy: "long" | "short" =
      trade.strategy === "long_put" || trade.strategy === "short_stock" ? "short" : "long";

    // M1: For Option 2 trades, exits are underlying-priced (stop/TP) or
    // bar-driven (ALMA/VWAP). We don't need the option quote here. Skipping
    // it saves one Tradier hit per Option 2 trade per tick.
    // Stock trades also don't need an OCC option quote — their exits are
    // underlying-priced and routed by the strategy module + leg shape.
    const leg0 = (trade.legs as Array<Record<string, unknown>>)[0] ?? {};
    const isStockLeg = (leg0 as Record<string, unknown>).instrument === "stock";
    const isOption2 = plan.source === "alma_9_39_rsi";
    const needsOptionQuote = !isOption2 && !isStockLeg;

    // OCC needed for option submits (entry + exit) regardless of source.
    // For stock legs we use the underlying ticker as the "asset label" (the
    // submitExitOrder branches on leg.instrument and ignores this for stocks).
    let occSymbolForExit: string = trade.sourceTicker;
    if (!isStockLeg) {
      const occ = resolveOcc(trade);
      if (!occ.ok) {
        out.push({ tradeId: trade.id, ticker, outcome: "no_occ", reason: occ.reason });
        continue;
      }
      occSymbolForExit = occ.occSymbol;
    }

    let mid: number | null = null;
    if (needsOptionQuote) {
      const qres = await getOptionQuote(cfg.mode, occSymbolForExit);
      if (!qres.ok || qres.data == null) {
        out.push({
          tradeId: trade.id,
          ticker,
          outcome: "no_quote",
          reason: qres.ok ? "Tradier returned no quote" : qres.reason,
        });
        continue;
      }
      mid = liveMid({ bid: qres.data.bid, ask: qres.data.ask, last: qres.data.last });
    }

    // Build per-trade state. The underlying parts come from baseState; we
    // layer in the option-specific numbers needed by premium_pct_* and the
    // exit-side underlying predicates.
    const state: MarketState = {
      ...baseState,
      entryFill: Number(trade.entryFillUsd),
      currentMid: mid ?? undefined,
    };

    const ast = (plan.ast ?? null) as TriggerAST | null;
    const astDecision = evaluateExits(ast, state);

    // ── Option 2 (ALMA 9/39 RSI): strategy owns its own exits. Skip the
    //    standard AST / ALMA-reversal / price-reversal flow for these trades.
    if (plan.source === "alma_9_39_rsi") {
      const leg0 = (trade.legs as Array<Record<string, unknown>>)[0] ?? {};
      const remainingQty = (leg0.qty as number | undefined) ?? 1;
      const a939 = await checkAlma939Exits({
        cfg,
        trade: { id: trade.id, sourceTicker: trade.sourceTicker, plan },
        side: tradeSideForStrategy,
        underlyingNow: baseState.lastPrice,
        remainingQty,
      });

      // Persist runtime mutations (trailing stop moved, etc.) even when no
      // exit fires. Mutates plan.runtime in place — Drizzle treats the whole
      // jsonb as a single column so we write the full plan back.
      if (a939.runtimePatch && Object.keys(a939.runtimePatch).length > 0) {
        const planNext = {
          ...plan,
          runtime: { ...((plan.runtime as Record<string, unknown> | undefined) ?? {}), ...a939.runtimePatch },
        };
        await db.update(botTrades).set({ plan: planNext }).where(eq(botTrades.id, trade.id));
      }

      if (!a939.fire) {
        out.push({ tradeId: trade.id, ticker, outcome: "no_match", reason: a939.reason });
        continue;
      }

      const isPartial = a939.kind === "partial";
      const closeQty = isPartial ? a939.qtyToClose : remainingQty;
      await logTape({
        kind: "exit_alma_939",
        severity: a939.reason === "stop" ? "warn" : "info",
        message: `${trade.sourceTicker} — ALMA 9/39 RSI ${isPartial ? `PARTIAL (${closeQty}/${remainingQty})` : "FULL"} exit (${a939.reason}) firing MARKET sell_to_close`,
        tradeId: trade.id,
        data: {
          ticker: trade.sourceTicker,
          side: tradeSideForStrategy,
          reason: a939.reason,
          detail: a939.detail,
          kind: a939.kind,
          closeQty,
        },
      });
      const sub = await submitExitOrder(
        trade,
        cfg,
        "alma939",
        null,
        occSymbolForExit,
        isPartial ? closeQty : undefined,
      );
      if (!sub.ok) {
        await logTape({
          kind: sub.code === "live_not_confirmed" || sub.code === "kill_switch" || sub.code === "bot_disabled" || sub.code === "mode_off"
            ? "risk_block"
            : "error",
          severity: "warn",
          message: `${trade.sourceTicker} — ALMA 9/39 RSI exit blocked: ${sub.reason}`,
          tradeId: trade.id,
          data: { code: sub.code, reason: sub.reason },
        });
        out.push({ tradeId: trade.id, ticker, outcome: "submit_blocked", reason: sub.reason });
        continue;
      }

      if (isPartial) {
        // PARTIAL CLOSE — trade stays in `open`. We reduce leg.qty
        // immediately and record the TP in plan.runtime so the next tick
        // won't re-fire the same level. MARKET fills near-instantly so this
        // optimistic accounting is fine; if the order is rejected, the next
        // reconcile will catch the discrepancy.
        const legsArr = (trade.legs as Array<Record<string, unknown>>).map((l, i) =>
          i === 0 ? { ...l, qty: remainingQty - closeQty } : l,
        );
        const planNext = {
          ...plan,
          runtime: { ...((plan.runtime as Record<string, unknown> | undefined) ?? {}), ...(a939.runtimePatch ?? {}) },
        };
        await db
          .update(botTrades)
          .set({ legs: legsArr, plan: planNext })
          .where(eq(botTrades.id, trade.id));
        await logTape({
          kind: "exit_alma_939",
          severity: "success",
          message: `${trade.sourceTicker} ${occSymbolForExit} — TP${a939.level} HIT, partial sell_to_close ${closeQty} of ${remainingQty} (order ${sub.orderId})`,
          tradeId: trade.id,
          data: { orderId: sub.orderId, level: a939.level, closeQty, remainingAfter: remainingQty - closeQty },
        });
        out.push({ tradeId: trade.id, ticker, outcome: "fired_target" });
        continue;
      }

      // FULL CLOSE — race-safe open → closing transition.
      const upd = await db
        .update(botTrades)
        .set({ status: "closing", tradierOrderId: sub.orderId })
        .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "open")))
        .returning({ id: botTrades.id });
      if (upd.length === 0) {
        const cancel = await cancelOrder(cfg.mode, sub.orderId);
        await logTape({
          kind: "error",
          severity: "error",
          message: `${trade.sourceTicker} — ALMA 9/39 RSI exit race: trade no longer in 'open'; orphan ${cancel.ok ? "cancelled" : `cancel FAILED (${cancel.reason})`}`,
          tradeId: trade.id,
          data: { orderId: sub.orderId, raceCancelOk: cancel.ok },
        });
        out.push({ tradeId: trade.id, ticker, outcome: "submit_error", reason: "race: trade not in open" });
        continue;
      }
      await logTape({
        kind: "exit_alma_939",
        severity: "warn",
        message: `${trade.sourceTicker} ${occSymbolForExit} — ALMA 9/39 ${(a939.reason ?? "exit").toUpperCase()} firing MARKET (order ${sub.orderId})`,
        tradeId: trade.id,
        data: { orderId: sub.orderId, reason: a939.reason, detail: a939.detail },
      });
      out.push({
        tradeId: trade.id,
        ticker,
        outcome:
          a939.reason === "stop"
            ? "fired_stop"
            : a939.reason.startsWith("target")
              ? "fired_target"
              : "fired_alma_reversal",
      });
      continue;
    }

    // Optional ALMA-based exits. Priority order, highest urgency first:
    //   stop > alma_break > alma_reversal > target > time_stop
    //
    // - stop          : user-set risk rail; always wins.
    // - alma_break    : (new) price close moved beyond ALMA9 ± threshold.
    //                   Earliest possible ALMA-based signal; if enabled, fires
    //                   before alma_reversal.
    // - alma_reversal : ALMA line itself crosses back against position vs VWAP.
    //                   Slower signal than alma_break.
    // - target/time_stop : standard AST-driven exits.
    let decision: typeof astDecision = astDecision;
    const stopFromAst = astDecision.fire && astDecision.reason === "stop";
    const tradeSide: "long" | "short" =
      trade.strategy === "long_put" ? "short" : "long";

    if (cfg.priceReversalAlmaExit && !stopFromAst) {
      const almaBreak = await checkPriceAlmaBreak({
        cfg,
        ticker: ticker.toUpperCase(),
        side: tradeSide,
        filledAt: trade.filledAt,
      });
      if (almaBreak.matched) {
        decision = { fire: true, reason: "alma_break", details: astDecision.details };
        const d = almaBreak.detail ?? {};
        await logTape({
          kind: "exit_alma_break",
          severity: "warn",
          message: `${trade.sourceTicker} — Price-Reversal ALMA exit triggered (${tradeSide} position, close ${(d.close as number)?.toFixed?.(2)} vs ALMA ${(d.alma as number)?.toFixed?.(2)} ± ${(d.thresholdPct as number)?.toFixed?.(3)}%)`,
          tradeId: trade.id,
          data: { ticker: trade.sourceTicker, side: tradeSide, almaBreak: d },
        });
      }
    }

    const almaBreakFired =
      decision.fire && decision.reason === "alma_break";
    if (cfg.almaReversalExit && !stopFromAst && !almaBreakFired) {
      const reversal = await checkAlmaReversal({
        cfg,
        ticker: ticker.toUpperCase(),
        side: tradeSide,
      });
      if (reversal.matched) {
        decision = { fire: true, reason: "alma_reversal", details: astDecision.details };
        await logTape({
          kind: "exit_alma_reversal",
          severity: "warn",
          message: `${trade.sourceTicker} — ALMA reversal exit triggered (${tradeSide} position, ALMA crossed against side)`,
          tradeId: trade.id,
          data: { ticker: trade.sourceTicker, side: tradeSide, reversal: reversal.detail },
        });
      }
    }

    if (!decision.fire) {
      out.push({ tradeId: trade.id, ticker, outcome: "no_match" });
      continue;
    }

    // Mid is only required for TARGET exits (they price as limit). Stop and
    // time_stop go MARKET — we'd rather pay slippage than fail to exit. So
    // we only bail when this is a target exit without a usable mid.
    const reasonNeedsMarket =
      decision.reason === "stop" ||
      decision.reason === "time_stop" ||
      decision.reason === "alma_reversal" ||
      decision.reason === "alma_break";
    if (mid == null && !reasonNeedsMarket) {
      out.push({
        tradeId: trade.id,
        ticker,
        outcome: "no_quote",
        reason: "target exit matched but no live mid to price the limit",
      });
      continue;
    }

    const sub = await submitExitOrder(trade, cfg, decision.reason, mid, occSymbolForExit);
    if (!sub.ok) {
      await logTape({
        kind: sub.code === "live_not_confirmed" || sub.code === "kill_switch" || sub.code === "bot_disabled" || sub.code === "mode_off"
          ? "risk_block"
          : "error",
        severity: "warn",
        message: `${trade.sourceTicker} — exit (${decision.reason}) blocked: ${sub.reason}`,
        tradeId: trade.id,
        data: { code: sub.code, reason: sub.reason },
      });
      out.push({
        tradeId: trade.id,
        ticker,
        outcome: "submit_blocked",
        reason: sub.reason,
      });
      continue;
    }

    // Race-safe transition open → closing.
    const upd = await db
      .update(botTrades)
      .set({
        status: "closing",
        tradierOrderId: sub.orderId,
      })
      .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "open")))
      .returning({ id: botTrades.id });

    if (upd.length === 0) {
      // Trade already moved. Auto-cancel the orphan exit order so we don't
      // accidentally over-short the position (e.g., if force-exit raced).
      const cancel = await cancelOrder(cfg.mode, sub.orderId);
      await logTape({
        kind: "error",
        severity: "error",
        message: cancel.ok
          ? `${trade.sourceTicker} — race: trade had moved by the time exit order ${sub.orderId} returned. Auto-cancelled.`
          : `${trade.sourceTicker} — race: orphan exit ${sub.orderId} + cancel ALSO failed (${cancel.reason}). MANUAL ACTION REQUIRED.`,
        tradeId: trade.id,
        data: {
          orderId: sub.orderId,
          leakedExit: true,
          cancelAttempted: true,
          cancelOk: cancel.ok,
          cancelReason: cancel.ok ? null : cancel.reason,
        },
      });
      out.push({
        tradeId: trade.id,
        ticker,
        outcome: "submit_error",
        reason: cancel.ok
          ? "race: trade not in open; orphan auto-cancelled"
          : `race: orphan exit cancel failed: ${cancel.reason}`,
      });
      continue;
    }

    const eventKind =
      decision.reason === "stop"
        ? "exit_stop_hit"
        : decision.reason === "target"
          ? "exit_target_hit"
          : decision.reason === "alma_reversal"
            ? "exit_alma_reversal"
            : decision.reason === "alma_break"
              ? "exit_alma_break"
              : "exit_time_stop";

    const priceLabel = sub.price === "market" ? "MARKET" : `${sub.price} (limit)`;
    await logTape({
      kind: eventKind,
      severity:
        decision.reason === "stop" ||
        decision.reason === "alma_reversal" ||
        decision.reason === "alma_break"
          ? "warn"
          : "success",
      message: `${trade.sourceTicker} ${occSymbolForExit} — ${decision.reason.toUpperCase()} hit; closing ${priceLabel} (order ${sub.orderId})`,
      tradeId: trade.id,
      data: {
        ticker: trade.sourceTicker,
        occSymbol: occSymbolForExit,
        reason: decision.reason,
        orderId: sub.orderId,
        price: sub.price,
        entryFill: Number(trade.entryFillUsd),
        state,
      },
    });

    out.push({
      tradeId: trade.id,
      ticker,
      outcome:
        decision.reason === "stop"
          ? "fired_stop"
          : decision.reason === "target"
            ? "fired_target"
            : decision.reason === "alma_reversal"
              ? "fired_alma_reversal"
              : decision.reason === "alma_break"
                ? "fired_alma_break"
                : "fired_time_stop",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Map Tradier's order.status to our bot_trade.status + the side-effect
 * we should take.
 *
 * Tradier values we care about: open, partially_filled, filled, expired,
 * canceled, rejected, pending, error. Anything else → no-op (log only).
 */
function classifyTradierStatus(s: string): {
  newStatus: "open" | "rejected" | "cancelled" | "errored" | null;
  kind: "order_filled" | "order_partial" | "order_rejected" | "order_cancelled" | "error" | null;
  severity: "success" | "warn" | "error" | "info";
  terminal: boolean;
} {
  switch (s) {
    case "filled":
      return { newStatus: "open", kind: "order_filled", severity: "success", terminal: true };
    case "partially_filled":
      return { newStatus: null, kind: "order_partial", severity: "info", terminal: false };
    case "rejected":
      return { newStatus: "rejected", kind: "order_rejected", severity: "error", terminal: true };
    case "canceled":
    case "expired":
      return { newStatus: "cancelled", kind: "order_cancelled", severity: "warn", terminal: true };
    case "error":
      return { newStatus: "errored", kind: "error", severity: "error", terminal: true };
    case "open":
    case "pending":
      // No-op statuses: order is at the broker but hasn't filled or
      // cancelled yet. Removed dead `partially_open` branch — Tradier's
      // documented statuses don't include it; the `default` arm below
      // handles any unknown status the same way.
      return { newStatus: null, kind: null, severity: "info", terminal: false };
    default:
      return { newStatus: null, kind: null, severity: "info", terminal: false };
  }
}

export type ReconcileOutcome = {
  tradeId: string;
  ticker: string;
  phase: "entry" | "exit";
  tradierStatus: string;
  newStatus: string | null;
  filled: boolean;
  realizedPnlUsd?: number;
};

/**
 * Walk every `working` AND `closing` trade. For each, ask Tradier where its
 * order stands and propagate state changes.
 *
 *   working  → entry order in flight; fill → status=open, write entryFillUsd
 *   closing  → exit order in flight; fill → status=closed, write exitFillUsd
 *              + realizedPnlUsd, set closedAt
 *
 * Polling-based reconcile (Phase 4a/5). Account-event WebSocket would give
 * sub-second fill latency but isn't needed at the 1-tick/minute cadence.
 */
export async function reconcileWorkingOrders(cfg: BotConfig): Promise<ReconcileOutcome[]> {
  const inFlight = await db
    .select()
    .from(botTrades)
    .where(inArray(botTrades.status, ["working", "closing"]));

  const outcomes: ReconcileOutcome[] = [];
  for (const trade of inFlight) {
    const phase: "entry" | "exit" = trade.status === "working" ? "entry" : "exit";

    if (!trade.tradierOrderId) {
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        phase,
        tradierStatus: "no_order_id",
        newStatus: null,
        filled: false,
      });
      continue;
    }
    const res = await getOrderStatus(cfg.mode, trade.tradierOrderId);
    if (!res.ok) {
      await logTape({
        kind: "error",
        severity: "warn",
        message: `${trade.sourceTicker} — order ${trade.tradierOrderId} status fetch failed: ${res.reason}`,
        tradeId: trade.id,
        data: { code: res.code },
      });
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        phase,
        tradierStatus: "fetch_failed",
        newStatus: null,
        filled: false,
      });
      continue;
    }
    const order = res.data;
    if (!order) {
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        phase,
        tradierStatus: "missing",
        newStatus: null,
        filled: false,
      });
      continue;
    }

    const cls = classifyTradierStatus(order.status);

    // ---- Entry leg (status=working) -------------------------------------
    if (phase === "entry") {
      if (cls.newStatus === "open" && order.avg_fill_price != null) {
        // B5: reconcile leg.qty against actual exec_quantity so partial
        // entry fills don't leak the wrong qty into exit math + PnL math.
        // Tradier's "filled" status guarantees exec_quantity == quantity in
        // practice, but if a partial fills + the broker calls it done (rare,
        // mostly on illiquid OCC after re-peg), exec_quantity wins.
        const legsArr = trade.legs as Array<Record<string, unknown>>;
        const leg0 = legsArr[0] ?? {};
        const advertisedQty = typeof leg0.qty === "number" ? leg0.qty : Number(leg0.qty ?? 1);
        const filledQty =
          typeof order.exec_quantity === "number" && order.exec_quantity > 0
            ? order.exec_quantity
            : advertisedQty;
        const qtyChanged = filledQty !== advertisedQty;
        const patchedLegs = qtyChanged
          ? legsArr.map((l, i) => (i === 0 ? { ...l, qty: filledQty } : l))
          : legsArr;

        const updated = await db
          .update(botTrades)
          .set({
            status: "open",
            filledAt: new Date(),
            entryFillUsd: String(order.avg_fill_price),
            ...(qtyChanged && { legs: patchedLegs }),
          })
          .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "working")))
          .returning({ id: botTrades.id });
        if (updated.length > 0) {
          await emitOrderEvent({
            trade,
            kind: "order_filled",
            severity: "success",
            message: `${trade.sourceTicker} — FILLED @ ${order.avg_fill_price}${qtyChanged ? ` (partial: ${filledQty}/${advertisedQty}; leg.qty reconciled)` : ""} (order ${order.id})`,
            data: { order, advertisedQty, filledQty, qtyReconciled: qtyChanged },
          });
        }
        outcomes.push({
          tradeId: trade.id,
          ticker: trade.sourceTicker,
          phase,
          tradierStatus: order.status,
          newStatus: "open",
          filled: true,
        });
        continue;
      }
      if (
        cls.newStatus === "rejected" ||
        cls.newStatus === "cancelled" ||
        cls.newStatus === "errored"
      ) {
        await db
          .update(botTrades)
          .set({ status: cls.newStatus, closedAt: new Date() })
          .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "working")));
        await emitOrderEvent({
          trade,
          kind: cls.kind ?? "error",
          severity: cls.severity,
          message: `${trade.sourceTicker} — ${cls.newStatus.toUpperCase()} (${order.reason_description ?? order.status})`,
          data: { order },
        });
        outcomes.push({
          tradeId: trade.id,
          ticker: trade.sourceTicker,
          phase,
          tradierStatus: order.status,
          newStatus: cls.newStatus,
          filled: false,
        });
        continue;
      }
      if (cls.kind === "order_partial") {
        await emitOrderEvent({
          trade,
          kind: "order_partial",
          severity: "info",
          message: `${trade.sourceTicker} — partial fill ${order.exec_quantity ?? "?"}/${order.quantity} @ ${order.last_fill_price ?? "?"}`,
          data: { order },
        });
      }
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        phase,
        tradierStatus: order.status,
        newStatus: null,
        filled: false,
      });
      continue;
    }

    // ---- Exit leg (status=closing) --------------------------------------
    if (cls.newStatus === "open" && order.avg_fill_price != null) {
      // Tradier's "filled" for a closing leg = we're flat. Compute PnL,
      // set status=closed, stamp closedAt + exitFillUsd + realizedPnlUsd.
      const leg = (trade.legs as Array<Record<string, unknown>>)[0];
      const qty = (leg?.qty as number) ?? 1;
      const entryFill = trade.entryFillUsd == null ? 0 : Number(trade.entryFillUsd);
      // B4: PnL math branches on instrument + direction.
      //   - Long option / long stock: realized = (exit - entry) × qty × mult
      //   - Short stock: realized = (entry - exit) × qty × mult (short profit when price drops)
      //   - Options multiplier = 100 (1 contract = 100 shares); stocks = 1.
      const isStockLeg = (leg as Record<string, unknown>)?.instrument === "stock";
      const isShort = trade.strategy === "short_stock";
      const mult = isStockLeg ? 1 : 100;
      const realized = isShort
        ? (entryFill - order.avg_fill_price) * qty * mult
        : (order.avg_fill_price - entryFill) * qty * mult;
      const updated = await db
        .update(botTrades)
        .set({
          status: "closed",
          closedAt: new Date(),
          exitFillUsd: String(order.avg_fill_price),
          realizedPnlUsd: realized.toFixed(2),
        })
        .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "closing")))
        .returning({ id: botTrades.id });
      if (updated.length > 0) {
        await emitOrderEvent({
          trade,
          kind: "order_filled",
          severity: realized >= 0 ? "success" : "warn",
          message: `${trade.sourceTicker} — CLOSED ${isStockLeg ? (isShort ? "(short stock)" : "(long stock)") : "(option)"} @ ${order.avg_fill_price} entry ${entryFill.toFixed(2)} qty ${qty} → pnl ${realized >= 0 ? "+" : ""}$${realized.toFixed(2)}`,
          data: { order, realizedPnlUsd: realized, entryFill, qty, mult, isStockLeg, isShort },
        });
      }
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        phase,
        tradierStatus: order.status,
        newStatus: "closed",
        filled: true,
        realizedPnlUsd: realized,
      });
      continue;
    }
    if (
      cls.newStatus === "rejected" ||
      cls.newStatus === "cancelled" ||
      cls.newStatus === "errored"
    ) {
      // The CLOSE order failed. The position is STILL OPEN. Bounce status
      // back to `open` so the next tick re-evaluates exits; clear the
      // tradierOrderId since this one is dead.
      await db
        .update(botTrades)
        .set({ status: "open", tradierOrderId: null })
        .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "closing")));
      await emitOrderEvent({
        trade,
        kind: cls.kind ?? "error",
        severity: "warn",
        message: `${trade.sourceTicker} — exit order ${cls.newStatus.toUpperCase()} (${order.reason_description ?? order.status}); position remains open, will retry`,
        data: { order, retryFromOpen: true },
      });
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        phase,
        tradierStatus: order.status,
        newStatus: "open",
        filled: false,
      });
      continue;
    }
    if (cls.kind === "order_partial") {
      await emitOrderEvent({
        trade,
        kind: "order_partial",
        severity: "info",
        message: `${trade.sourceTicker} — exit partial ${order.exec_quantity ?? "?"}/${order.quantity} @ ${order.last_fill_price ?? "?"}`,
        data: { order },
      });
    }
    outcomes.push({
      tradeId: trade.id,
      ticker: trade.sourceTicker,
      phase,
      tradierStatus: order.status,
      newStatus: null,
      filled: false,
    });
  }
  return outcomes;
}

// ---------------------------------------------------------------------------
// Smart re-pegging for working entry orders
// ---------------------------------------------------------------------------

/**
 * After an entry order sits in `working` for one monitor tick (≥5 min), we
 * cancel the broker-side order and re-submit at a slightly worsened limit.
 * After `entryRepegMax` such attempts, we cross the spread with a MARKET
 * order so the trade actually starts rather than expiring at end of day.
 *
 * Storage: re-peg count lives on `bot_trades.plan.repegCount` (jsonb). No
 * schema migration needed; safely 0 / missing on legacy rows.
 *
 *   repegCount 0 → first limit at mid (initial submit by submitEntryOrder)
 *   repegCount 1..entryRepegMax → cancel + resubmit at mid + 1c (buys)
 *   repegCount = entryRepegMax + 1 → MARKET (crosses spread)
 *   repegCount > entryRepegMax + 1 → no-op (already crossed; awaiting fill)
 *
 * The penny-worsening is applied per-side: BUY orders increase price (pay
 * more, more likely to fill); SELL orders decrease price. Initial entries
 * are always BUYs, but the structure keeps this honest if we ever add a
 * sell-to-open path.
 */

const REPEG_AGE_MIN = 5;        // wait at least one monitor tick before pegging
const REPEG_PENNY_STEP = 0.01;  // per-attempt worsening, dollars

export type RepegOutcome = {
  tradeId: string;
  ticker: string;
  outcome:
    | "skipped_fresh"
    | "skipped_no_order"
    | "skipped_max_reached"
    | "cancel_failed"
    | "resubmitted_limit"
    | "resubmitted_market"
    | "error";
  newOrderId?: string;
  newPrice?: number | "market";
  attempt?: number;
  reason?: string;
};

/**
 * Walk every `working` trade. For each that's older than REPEG_AGE_MIN and
 * hasn't yet exceeded the configured max, cancel + resubmit. Same race-safe
 * pattern as other OMS transitions.
 */
export async function repegStaleWorkingOrders(cfg: BotConfig): Promise<RepegOutcome[]> {
  const max = cfg.entryRepegMax ?? 2;
  if (max <= 0) return []; // re-pegging disabled

  const gate = checkFourOfFourGate(cfg);
  if (!gate.ok) return []; // bot is off / killed / etc.; skip re-pegging entirely

  const working = await db.select().from(botTrades).where(eq(botTrades.status, "working"));
  const now = Date.now();
  const outcomes: RepegOutcome[] = [];

  for (const trade of working) {
    const submittedAt = trade.submittedAt ? new Date(trade.submittedAt).getTime() : null;
    if (!submittedAt || now - submittedAt < REPEG_AGE_MIN * 60_000) {
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        outcome: "skipped_fresh",
      });
      continue;
    }
    if (!trade.tradierOrderId) {
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        outcome: "skipped_no_order",
      });
      continue;
    }

    const plan = (trade.plan ?? {}) as Record<string, unknown>;
    const repegCount = Number(plan.repegCount ?? 0);
    if (repegCount > max + 1) {
      // Already crossed the spread; just waiting for the market order to fill.
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        outcome: "skipped_max_reached",
      });
      continue;
    }

    // Cancel the current order. If cancel fails because it just filled, the
    // next reconcile will catch the fill — we just don't re-peg in that case.
    const cancel = await cancelOrder(cfg.mode, trade.tradierOrderId);
    if (!cancel.ok) {
      await logTape({
        kind: "error",
        severity: "warn",
        message: `${trade.sourceTicker} — re-peg cancel failed (${cancel.code}): ${cancel.reason}. Will retry next tick or reconcile.`,
        tradeId: trade.id,
        data: { orderId: trade.tradierOrderId, code: cancel.code },
      });
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        outcome: "cancel_failed",
        reason: cancel.reason,
      });
      continue;
    }

    const leg = (trade.legs as Array<Record<string, unknown>>)[0];
    if (!leg) {
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        outcome: "error",
        reason: "leg missing",
      });
      continue;
    }
    const occSymbol = leg.occ_symbol as string | undefined;
    if (!occSymbol) {
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        outcome: "error",
        reason: "occ_symbol missing on leg",
      });
      continue;
    }
    const side = leg.side as
      | "buy_to_open"
      | "sell_to_open"
      | "buy_to_close"
      | "sell_to_close"
      | undefined;
    if (!side) {
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        outcome: "error",
        reason: "side missing on leg",
      });
      continue;
    }
    const originalQty = (leg.qty as number | undefined) ?? 1;

    const nextRepeg = repegCount + 1;
    const goMarket = nextRepeg > max;
    const isBuy = side === "buy_to_open" || side === "buy_to_close";

    // -------- Fresh quote for BOTH sizing AND limit pricing -----------------
    // Critical: we always need a price reference to size against the budget,
    // regardless of whether we're submitting LIMIT or MARKET. Without it we
    // could overspend by 2-3× when the option premium runs (a real production
    // incident: TSLA put repeg priced 15 contracts at $1.47 each instead of
    // recomputing to ~6 contracts against the same $1000 budget).
    const qres = await getOptionQuote(cfg.mode, occSymbol);
    const mid =
      qres.ok && qres.data
        ? liveMid({ bid: qres.data.bid, ask: qres.data.ask, last: qres.data.last })
        : null;

    if (mid == null) {
      // Cannot size without a price. DO NOT submit blind market — clear the
      // tradierOrderId so the next tick can retry with a fresh quote.
      await logTape({
        kind: "risk_block",
        severity: "warn",
        message: `${trade.sourceTicker} — re-peg aborted: no live mid for sizing. Old order ${trade.tradierOrderId} cancelled; next tick will retry.`,
        tradeId: trade.id,
        data: { occSymbol, repegCount: nextRepeg },
      });
      await db
        .update(botTrades)
        .set({ tradierOrderId: null })
        .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "working")));
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        outcome: "error",
        reason: "no live mid for re-peg sizing",
      });
      continue;
    }

    // -------- Drift cap ------------------------------------------------------
    // If the option premium has run significantly above the original signal
    // mid (`plan.entryMidEstimate`), the setup is no longer the trade we
    // sized for — chasing it through re-pegs amounts to entering a different
    // trade at a worse price. Abandon instead.
    //
    // Asymmetric: a CHEAPER live mid is always allowed (free improvement).
    // Only applies to BUYs (sell entries don't exist today, but the same
    // logic would invert for them).
    const originalMidRaw = (plan as Record<string, unknown>)?.entryMidEstimate;
    const originalMid =
      typeof originalMidRaw === "number" && Number.isFinite(originalMidRaw) && originalMidRaw > 0
        ? originalMidRaw
        : null;
    const driftCapPct = Number(cfg.entryRepegMaxDriftPct ?? "30");
    if (isBuy && originalMid != null && Number.isFinite(driftCapPct) && driftCapPct > 0) {
      const driftPct = ((mid - originalMid) / originalMid) * 100;
      if (driftPct > driftCapPct) {
        await logTape({
          kind: "risk_block",
          severity: "warn",
          message: `${trade.sourceTicker} — re-peg abandoned: option mid ran ${driftPct.toFixed(1)}% above signal ($${originalMid.toFixed(2)} → $${mid.toFixed(2)}); exceeds drift cap ${driftCapPct.toFixed(1)}%. Trade cancelled to avoid chasing.`,
          tradeId: trade.id,
          data: {
            occSymbol,
            originalMid,
            currentMid: mid,
            driftPct: Number(driftPct.toFixed(2)),
            driftCapPct,
            repegCount: nextRepeg,
            wouldHaveSpent: originalQty * mid * 100,
          },
        });
        await db
          .update(botTrades)
          .set({ status: "cancelled", closedAt: new Date(), tradierOrderId: null })
          .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "working")));
        outcomes.push({
          tradeId: trade.id,
          ticker: trade.sourceTicker,
          outcome: "error",
          reason: `re-peg abandoned: drift ${driftPct.toFixed(1)}% > cap ${driftCapPct}%`,
        });
        continue;
      }
    }

    // -------- Budget-driven resize ------------------------------------------
    // For BUYs, ask is the worst-case fill price — size against that to keep
    // a MARKET fallback inside the cap. For SELLs the opposite isn't a risk.
    const quoteData = qres.ok ? qres.data : null;
    const sizingPrice = isBuy ? (quoteData?.ask ?? mid) : mid;
    const positionSize = Number(cfg.positionSizeUsd);
    const perTradeCap = Number(cfg.maxRiskPerTradeUsd);
    const budget = Math.min(positionSize, perTradeCap);
    const budgetQty = Math.floor(budget / (sizingPrice * 100));
    // Never EXPAND on re-peg (would change the strategy's intended exposure
    // mid-flight). Only shrink to fit the new budget.
    const newQty = Math.max(0, Math.min(originalQty, budgetQty));

    if (newQty <= 0) {
      // Price moved beyond what we can afford even for 1 contract. Abandon
      // the trade — same outcome `submitEntryOrder` would have returned with
      // code "size_zero" had we tried to start fresh.
      await logTape({
        kind: "risk_block",
        severity: "warn",
        message: `${trade.sourceTicker} — re-peg abandoned: 1 contract at $${sizingPrice.toFixed(2)} ($${(sizingPrice * 100).toFixed(2)}) exceeds budget $${budget.toFixed(2)}. Trade cancelled.`,
        tradeId: trade.id,
        data: { occSymbol, sizingPrice, budget, originalQty, newQty: 0, repegCount: nextRepeg },
      });
      await db
        .update(botTrades)
        .set({ status: "cancelled", closedAt: new Date(), tradierOrderId: null })
        .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "working")));
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        outcome: "error",
        reason: `re-peg abandoned: 1 contract exceeds $${budget} budget`,
      });
      continue;
    }

    if (newQty < originalQty) {
      await logTape({
        kind: "order_submitted",
        severity: "warn",
        message: `${trade.sourceTicker} — re-peg resized ${originalQty}→${newQty} contracts (sizing price $${sizingPrice.toFixed(2)}, budget $${budget.toFixed(2)}). Original size would have spent $${(originalQty * sizingPrice * 100).toFixed(2)}.`,
        tradeId: trade.id,
        data: {
          originalQty,
          newQty,
          sizingPrice,
          budget,
          wouldHaveSpent: originalQty * sizingPrice * 100,
        },
      });
    }

    // -------- Decide LIMIT vs MARKET for the actual submit ------------------
    let newPrice: number | undefined;
    if (!goMarket) {
      // For BUYs, worsening = pay more (higher price). For SELLs, opposite.
      const worsening = REPEG_PENNY_STEP * nextRepeg;
      newPrice = isBuy ? mid + worsening : mid - worsening;
    }

    const submitArgs = {
      instrument: "option" as const,
      underlying: trade.sourceTicker,
      optionSymbol: occSymbol,
      side,
      quantity: newQty,
      type: (goMarket || newPrice == null ? "market" : "limit") as "market" | "limit",
      ...(newPrice != null ? { price: Number(newPrice.toFixed(2)) } : {}),
      duration: "day" as const,
    };

    const submitRes = await submitOrder(cfg.mode, submitArgs);
    if (!submitRes.ok) {
      await logTape({
        kind: "error",
        severity: "error",
        message: `${trade.sourceTicker} — re-peg resubmit failed (${submitRes.code}): ${submitRes.reason}. Trade stays in 'working' with cancelled prior order.`,
        tradeId: trade.id,
        data: { code: submitRes.code, nextRepeg },
      });
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        outcome: "error",
        reason: submitRes.reason,
      });
      continue;
    }

    // Race-safe state update. If we resized down, patch leg.qty so a future
    // re-peg (or any other reader) uses the new size as its baseline.
    const newPlan = { ...plan, repegCount: nextRepeg };
    const legsArr = (trade.legs as Array<Record<string, unknown>>).slice();
    if (legsArr[0]) legsArr[0] = { ...legsArr[0], qty: newQty };
    const upd = await db
      .update(botTrades)
      .set({
        tradierOrderId: String(submitRes.data.id),
        submittedAt: new Date(),
        plan: newPlan,
        legs: legsArr,
      })
      .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "working")))
      .returning({ id: botTrades.id });
    if (upd.length === 0) {
      // Race — cancel the orphan, log loud.
      const cancel2 = await cancelOrder(cfg.mode, submitRes.data.id);
      await logTape({
        kind: "error",
        severity: "error",
        message: `${trade.sourceTicker} — re-peg race: trade no longer in 'working' (auto-cancelled the new order ${submitRes.data.id}, ${cancel2.ok ? "succeeded" : "FAILED"})`,
        tradeId: trade.id,
        data: { orderId: submitRes.data.id, raceCancelOk: cancel2.ok },
      });
      outcomes.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        outcome: "error",
        reason: "race during re-peg",
      });
      continue;
    }

    const priceLabel =
      goMarket || newPrice == null ? "MARKET" : `${newPrice.toFixed(2)} (limit)`;
    await logTape({
      kind: "order_submitted",
      severity: goMarket ? "warn" : "info",
      message: `${trade.sourceTicker} — re-peg #${nextRepeg}/${max + 1}: cancelled old ${trade.tradierOrderId}, submitted ${newQty}× ${side} at ${priceLabel} → order ${submitRes.data.id}${newQty !== originalQty ? ` (resized from ${originalQty})` : ""}`,
      tradeId: trade.id,
      data: {
        repegCount: nextRepeg,
        max,
        oldOrderId: trade.tradierOrderId,
        newOrderId: String(submitRes.data.id),
        newPrice: newPrice ?? "market",
        goMarket,
      },
    });

    outcomes.push({
      tradeId: trade.id,
      ticker: trade.sourceTicker,
      outcome: goMarket ? "resubmitted_market" : "resubmitted_limit",
      newOrderId: String(submitRes.data.id),
      newPrice: newPrice ?? "market",
      attempt: nextRepeg,
    });
  }

  return outcomes;
}

// ---------------------------------------------------------------------------
// Internals
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

async function emitOrderEvent(opts: {
  trade: BotTrade;
  kind: typeof botActions.$inferInsert.kind;
  severity: string;
  message: string;
  data: Record<string, unknown> & { order: TradierOrderStatus };
}): Promise<void> {
  await logTape({
    kind: opts.kind,
    severity: opts.severity,
    message: opts.message,
    tradeId: opts.trade.id,
    data: opts.data,
  });
}
