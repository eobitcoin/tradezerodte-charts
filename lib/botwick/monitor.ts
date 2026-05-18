/**
 * BotWick monitor — one tick.
 *
 * For every distinct ticker with a `pending` bot_trade:
 *   1. Pull a live quote + intraday bars from Tradier.
 *   2. Build a MarketState.
 *   3. For each `pending` trade on that ticker, evaluate the entry condition.
 *   4. If matched: transition `status -> "signal_armed"`, set
 *      `entrySignaledAt`, log a `signal_armed` event tied to the trade.
 *
 * Phase 3a STOPS at `signal_armed`. The `signal_armed → signal_fired`
 * promotion (live-mid risk re-check, plan-slippage guard, sizing engine)
 * comes in Phase 3b with option-quote integration. Until then we just prove
 * the bot recognises a triggering market and audit-logs it.
 *
 * Re-runnable: the SELECT filters on `status='pending'`, so trades already
 * armed are skipped automatically.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { withAdvisoryLock, LOCK_IDS } from "@/lib/db/advisory-lock";
import {
  botActions,
  botAlmaState,
  botConfig,
  botTrades,
  type BotConfig,
} from "@/lib/db/schema";
import type { Condition, TriggerAST } from "./types";
import { buildMarketState } from "./market-data";
import { evaluate, type MarketState } from "./evaluator";
import { getBalances, getCredsStatus, getOptionQuote } from "./tradier-adapter";
import { resolveOcc } from "./occ";
import { evaluateLiveMidRisk, liveMid } from "./risk";
import {
  processOpenExitsForTicker,
  reconcileWorkingOrders,
  repegStaleWorkingOrders,
  submitAllFired,
  type RepegOutcome,
} from "./oms";
import { runForceExit, type ForceExitOutcome } from "./force-exit";
import { reconcileWithBroker, type ReconcileOutcome } from "./broker-reconcile";
import { buildDefaultExits } from "./default-exits";
import { isForceExitWindow } from "./market-hours";
import { runAlmaVwapCross, type AlmaRunSummary } from "./strategies/alma-vwap-cross";
import { runAlma939Rsi, type Alma939RunSummary } from "./strategies/alma-9-39-rsi";

export type TickSummary = {
  tickAt: string;
  mode: string;
  enabled: boolean;
  killSwitchEngaged: boolean;
  pendingCount: number;
  tickersConsidered: number;
  trades: TickTradeOutcome[];
  errors: { ticker: string; reason: string; code: string }[];
  /** OMS phase: submissions of signal_fired → working. */
  submitted: Array<{
    tradeId: string;
    ticker: string;
    outcome: "submitted" | "blocked" | "error" | "claim_lost";
    orderId?: string;
    price?: number;
    quantity?: number;
    reason?: string;
    code?: string;
  }>;
  /** OMS phase: exits evaluated against open positions. */
  exits: Array<{
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
  }>;
  /** OMS phase: reconciliation of working + closing orders. */
  reconciled: Array<{
    tradeId: string;
    ticker: string;
    phase: "entry" | "exit";
    tradierStatus: string;
    newStatus: string | null;
    filled: boolean;
    realizedPnlUsd?: number;
  }>;
  /** Day-trade force-exit sweep, if it fired this tick. */
  forceExit?: ForceExitOutcome[];
  /** ALMA × VWAP run summary, when activeSignalStrategy uses ALMA. */
  alma?: AlmaRunSummary;
  /** ALMA 9/39 RSI (Option 2) run summary, when active. */
  alma939?: Alma939RunSummary;
  /** Smart re-pegging outcomes for stale working orders. */
  repegged?: RepegOutcome[];
  /** Broker-side reconciliation against Tradier's view of orders + positions. */
  brokerReconcile?: ReconcileOutcome;
};

export type TickTradeOutcome = {
  tradeId: string;
  ticker: string;
  status: string;
  outcome:
    | "fired"             // armed + live re-check passed → signal_fired
    | "armed_no_recheck"  // armed; live re-check failed (slippage / cap / no quote)
    | "armed"             // armed; we didn't get to the re-check (legacy path)
    | "no_match"
    | "ast_missing"
    | "skipped_already_progressed";
  reason?: string;
};

/**
 * Public tick entry. Wraps `runMonitorTickInner` with a Postgres advisory
 * lock so two ticks cannot run concurrently — the inner work assumes it is
 * the sole writer to `bot_trades` for its duration. If another tick already
 * holds the lock, this returns `{ ok: false, code: "concurrent_tick" }`
 * immediately without doing any work.
 */
export async function runMonitorTick(opts?: { actor?: { id: string } }): Promise<
  | { ok: true; summary: TickSummary }
  | { ok: false; reason: string; code: string }
> {
  const locked = await withAdvisoryLock(LOCK_IDS.BOTWICK_MONITOR_TICK, () =>
    runMonitorTickInner(opts),
  );
  if (!locked.ok) {
    await logTape({
      kind: "monitor_tick",
      severity: "info",
      message: "Monitor tick skipped — another tick already running (advisory lock held)",
      data: { actor: opts?.actor?.id, code: locked.code },
    });
    return { ok: false, code: "concurrent_tick", reason: locked.reason };
  }
  return locked.data;
}

async function runMonitorTickInner(opts?: { actor?: { id: string } }): Promise<
  | { ok: true; summary: TickSummary }
  | { ok: false; reason: string; code: string }
> {
  // Read singleton config; bail out cleanly if anything we depend on is off.
  const cfgRows = await db.select().from(botConfig).where(eq(botConfig.id, "default")).limit(1);
  const config = cfgRows[0];
  if (!config) {
    return { ok: false, code: "no_config", reason: "bot_config row missing" };
  }

  // mode=off means no Tradier credentials, so we can't reconcile anything.
  // Bail before doing any work.
  if (config.mode === "off") {
    await logTape({
      kind: "monitor_tick",
      severity: "info",
      message: "Monitor tick skipped — mode=off",
      data: { actor: opts?.actor?.id },
    });
    return { ok: false, code: "mode_off", reason: "mode is off" };
  }

  // Run broker-reconcile EARLY — even when the bot is disabled or kill-switched.
  // Reasoning: the reconcile only mutates DB state to mirror the broker
  // (e.g., marking externally-closed positions as closed). It never submits
  // any new orders. Skipping it when bot is off used to strand stuck `open`
  // trades — admin closes the position at Tradier, then disables the bot,
  // and the Activity tab shows a phantom `open` position forever.
  if (config.killSwitchEngaged || !config.enabled) {
    try {
      const r = await reconcileWithBroker(config);
      if (r.externallyClosed.length > 0 || r.recoveredStuck.length > 0) {
        await logTape({
          kind: "monitor_tick",
          severity: "warn",
          message: `Reconcile-only pass (bot ${config.killSwitchEngaged ? "kill-switched" : "disabled"}): ${r.externallyClosed.length} externally-closed, ${r.recoveredStuck.length} stuck recovered`,
          data: { actor: opts?.actor?.id, reconcile: r },
        });
      }
    } catch (err) {
      await logTape({
        kind: "error",
        severity: "warn",
        message: `Reconcile-only pass failed: ${String(err)}`,
        data: { actor: opts?.actor?.id },
      });
    }
  }

  if (config.killSwitchEngaged) {
    await logTape({
      kind: "monitor_tick",
      severity: "warn",
      message: "Monitor tick skipped — kill switch engaged (reconcile ran)",
      data: { actor: opts?.actor?.id },
    });
    return { ok: false, code: "kill_switch", reason: "kill switch engaged" };
  }
  if (!config.enabled) {
    await logTape({
      kind: "monitor_tick",
      severity: "info",
      message: "Monitor tick skipped — bot disabled (reconcile ran)",
      data: { actor: opts?.actor?.id },
    });
    return { ok: false, code: "bot_disabled", reason: "bot disabled" };
  }

  // Fast cred check so we fail loud if Tradier env vars are unset. With the
  // data/order split in the adapter, paper mode needs the sandbox token for
  // orders AND either token for data (it will prefer the live one if set).
  const creds = getCredsStatus();
  if (config.mode === "paper") {
    if (!creds.sandboxToken) {
      await logTape({
        kind: "error",
        severity: "error",
        message: "TRADIER_SANDBOX_TOKEN not set — paper orders route to sandbox. Add via Railway env.",
      });
      return { ok: false, code: "no_token", reason: "TRADIER_SANDBOX_TOKEN missing" };
    }
    // Data side: either token works. Both unset = no data feed at all.
    if (!creds.sandboxToken && !creds.liveToken) {
      return { ok: false, code: "no_token", reason: "no Tradier token configured for data" };
    }
  }
  if (config.mode === "live" && !creds.liveToken) {
    await logTape({
      kind: "error",
      severity: "error",
      message: "TRADIER_LIVE_TOKEN (or TRADIER_API_KEY) not set — live monitoring needs it.",
    });
    return { ok: false, code: "no_token", reason: "TRADIER_LIVE_TOKEN missing" };
  }

  // B2: maxDailyLossUsd kill-switch trip. Pull live Tradier balances and
  // compute today's realized + unrealized PnL. If drawdown ≥ cap, trip the
  // kill switch, flatten all open positions immediately, and return.
  //
  // A fetch failure here is NOT a trip — we'd rather miss a tick than trip
  // on a transient Tradier hiccup. The check runs every tick so a real
  // drawdown will be caught within ~1 minute.
  const dailyLossCap = Number(config.maxDailyLossUsd);
  if (dailyLossCap > 0) {
    try {
      const bal = await getBalances(config.mode);
      if (bal.ok && bal.data) {
        const realized = Number.isFinite(bal.data.close_pl) ? Number(bal.data.close_pl) : 0;
        const unrealized = Number.isFinite(bal.data.open_pl) ? Number(bal.data.open_pl) : 0;
        const dayPnl = realized + unrealized;
        if (dayPnl <= -dailyLossCap) {
          const reason = `daily loss cap hit: $${dayPnl.toFixed(2)} (cap −$${dailyLossCap.toFixed(2)}). Kill switch tripped automatically.`;
          await db
            .update(botConfig)
            .set({
              killSwitchEngaged: true,
              killSwitchReason: reason,
              updatedAt: new Date(),
            })
            .where(eq(botConfig.id, "default"));
          await logTape({
            kind: "kill_switch",
            severity: "error",
            message: reason,
            data: {
              realizedPnl: realized,
              unrealizedPnl: unrealized,
              dayPnl,
              cap: dailyLossCap,
              actor: opts?.actor?.id,
            },
          });
          // Flatten everything now. Same machinery as 15:55 sweep.
          try {
            const outcomes = await runForceExit(config);
            await logTape({
              kind: "kill_switch",
              severity: "warn",
              message: `Auto-flatten after kill-switch trip — ${outcomes.length} trade${outcomes.length === 1 ? "" : "s"} touched`,
              data: { outcomes, trigger: "max_daily_loss" },
            });
          } catch (e) {
            await logTape({
              kind: "error",
              severity: "error",
              message: `Kill switch tripped but auto-flatten failed: ${String(e)}. Manual close required.`,
            });
          }
          return { ok: false, code: "kill_switch", reason };
        }
      }
    } catch (e) {
      // Soft-fail. Log but don't trip.
      await logTape({
        kind: "error",
        severity: "warn",
        message: `Daily-loss check failed (balances fetch): ${String(e)}. Continuing without trip.`,
      });
    }
  }

  // PHASE 0: Day-trade force-exit sweep (15:55–15:59 ET, weekday, setting on).
  // Runs BEFORE everything else and bypasses the rest of the tick: no new
  // entries get evaluated, no exits get re-priced — we just flatten.
  // Reconcile still runs (further down) so the market-close fills are
  // picked up promptly.
  let forceExitOutcomes: ForceExitOutcome[] | undefined;
  if (config.dayTradeForceExit && isForceExitWindow()) {
    forceExitOutcomes = await runForceExit(config);
    const reconciled = await reconcileWorkingOrders(config);
    const summary: TickSummary = {
      tickAt: new Date().toISOString(),
      mode: config.mode,
      enabled: config.enabled,
      killSwitchEngaged: config.killSwitchEngaged,
      pendingCount: 0,
      tickersConsidered: 0,
      trades: [],
      errors: [],
      submitted: [],
      exits: [],
      reconciled,
      forceExit: forceExitOutcomes,
    };
    await logTape({
      kind: "monitor_tick",
      severity: "info",
      message: `Monitor tick — force-exit sweep · swept=${forceExitOutcomes.length} reconciled=${reconciled.length}`,
      data: summary,
    });
    return { ok: true, summary };
  }

  // Strategy switch. Implementations:
  //   - plan_based: existing path. Plan-based pending/armed trades flow
  //     through processTrade in the per-ticker loop below.
  //   - alma_vwap_cross: ALMA × VWAP runs as a standalone phase before the
  //     per-ticker plan loop. It writes its own bot_trades(status=signal_fired)
  //     rows; submitAllFired in Phase C picks them up alongside any plan-based
  //     fired trades.
  //   - alma_plus_plan: BOTH plan-based entries AND ALMA. The confirmation
  //     gating (only fire a plan-based trade when ALMA agrees) is Phase 6b
  //     polish; today it runs plan-based armed-→fired without ALMA gating.
  const processPlanEntries =
    config.activeSignalStrategy === "plan_based" ||
    config.activeSignalStrategy === "alma_plus_plan";
  const processAlmaEntries =
    config.activeSignalStrategy === "alma_vwap_cross" ||
    config.activeSignalStrategy === "alma_plus_plan";

  // ALMA phase. Runs INDEPENDENT of the plan-based per-ticker loop; uses
  // its own watchlist + bar pull. It's a self-contained module that writes
  // bot_trades(signal_fired) directly, so Phase C submit picks them up.
  let almaSummary: AlmaRunSummary | undefined;
  if (processAlmaEntries) {
    almaSummary = await runAlmaVwapCross(config);
    const fired = almaSummary.perTicker.filter((t) => t.outcome === "pullback_fired").length;
    await logTape({
      kind: "monitor_tick",
      severity: "info",
      message: `ALMA × VWAP run — watchlist=${almaSummary.watchlist.length} fired=${fired}`,
      data: almaSummary,
    });
  }

  // Option 2 — ALMA 9/39 RSI strategy. Same pattern as Option 1: standalone
  // module, writes signal_fired rows directly, Phase C submits them.
  let alma939Summary: Alma939RunSummary | undefined;
  if (config.activeSignalStrategy === "alma_9_39_rsi") {
    alma939Summary = await runAlma939Rsi(config);
    const fired = alma939Summary.perTicker.filter(
      (t) => t.outcome === "long_entry_fired" || t.outcome === "short_entry_fired",
    ).length;
    await logTape({
      kind: "monitor_tick",
      severity: "info",
      message: `ALMA 9/39 RSI run — watchlist=${alma939Summary.watchlist.length} fired=${fired}`,
      data: alma939Summary,
    });
  }

  if (config.activeSignalStrategy === "alma_plus_plan") {
    await logTape({
      kind: "monitor_tick",
      severity: "info",
      message: `"alma_plus_plan" combined gating not yet wired — running plan_based entries + ALMA entries independently this tick.`,
      data: { note: "Phase 6b TODO: gate plan_based fires on ALMA direction agreement." },
    });
  }

  // Find trades we still need to act on. Three cases:
  //   - status="pending": entry trigger hasn't matched yet on real data.
  //     (Only loaded when the active strategy uses plan-based entries.)
  //   - status="signal_armed": entry matched in a prior tick but the live
  //     re-check failed. Always retried so we don't strand armed trades
  //     just because the admin swapped strategies mid-day.
  //   - status="open": we hold a filled position; exits need evaluation
  //     regardless of which strategy is active now.
  const pendingTrades = processPlanEntries
    ? await db
        .select()
        .from(botTrades)
        .where(inArray(botTrades.status, ["pending", "signal_armed"]))
    : await db
        .select()
        .from(botTrades)
        .where(eq(botTrades.status, "signal_armed"));
  const openTrades = await db
    .select()
    .from(botTrades)
    .where(eq(botTrades.status, "open"));

  // Count any rows that need OMS attention this tick. signal_fired (just
  // created by ALMA or plan-armed→fired in this tick) and submitting (stuck
  // from a prior tick) are critical — without them the submit phase never
  // runs and orders stuck on the bot side never reach Tradier.
  const omsPendingCount = await db
    .select({ id: botTrades.id })
    .from(botTrades)
    .where(inArray(botTrades.status, ["signal_fired", "submitting", "working", "closing"]));

  // No per-ticker work AND nothing for the OMS to chase: only reconcile +
  // repeg are needed. Otherwise fall through to the full pipeline.
  if (pendingTrades.length === 0 && openTrades.length === 0 && omsPendingCount.length === 0) {
    const brokerReconcile = await reconcileWithBroker(config);
    const reconciled = await reconcileWorkingOrders(config);
    const repegged = await repegStaleWorkingOrders(config);
    const summary: TickSummary = {
      tickAt: new Date().toISOString(),
      mode: config.mode,
      enabled: config.enabled,
      killSwitchEngaged: config.killSwitchEngaged,
      pendingCount: 0,
      tickersConsidered: 0,
      trades: [],
      errors: [],
      submitted: [],
      exits: [],
      reconciled,
      repegged,
      brokerReconcile,
    };
    await logTape({
      kind: "monitor_tick",
      severity: "info",
      message: `Monitor tick — no work · reconciled=${reconciled.length} repegged=${repegged.length}`,
      data: summary,
    });
    return { ok: true, summary };
  }

  await logTape({
    kind: "monitor_tick",
    severity: "info",
    message: `Monitor tick started (mode=${config.mode}, pending=${pendingTrades.length})${opts?.actor ? ` — by BotWick Admin` : ""}`,
    data: { actor: opts?.actor?.id, pendingCount: pendingTrades.length },
  });


  // Group by ticker so we hit Tradier once per ticker, not once per trade.
  // Union across pending/armed AND open so an open-only ticker still gets
  // its underlying state pulled for exit evaluation.
  const tickers = Array.from(
    new Set([
      ...pendingTrades.map((t) => t.sourceTicker.toUpperCase()),
      ...openTrades.map((t) => t.sourceTicker.toUpperCase()),
    ]),
  );
  const summary: TickSummary = {
    tickAt: new Date().toISOString(),
    mode: config.mode,
    enabled: config.enabled,
    killSwitchEngaged: config.killSwitchEngaged,
    pendingCount: pendingTrades.length,
    tickersConsidered: tickers.length,
    trades: [],
    errors: [],
    submitted: [],
    exits: [],
    reconciled: [],
  };

  // Per-ticker market state + per-trade evaluation. We do these serially to
  // avoid hammering Tradier; underlying ticker counts are tiny (≤ 16 typ.).
  for (const ticker of tickers) {
    const stateRes = await buildMarketState({ mode: config.mode, ticker });
    if (!stateRes.ok) {
      summary.errors.push({ ticker, reason: stateRes.reason, code: stateRes.code });
      await logTape({
        kind: "error",
        severity: "error",
        message: `${ticker} — market data fetch failed: ${stateRes.reason}`,
        data: { ticker, code: stateRes.code },
      });
      continue;
    }
    const state = stateRes.state;

    // quote_refresh per ticker — a single audit line per Tradier hit, not
    // per trade. The §6.5 spec says we log every live-quote pull.
    const phaseTag =
      stateRes.sessionPhase === "rth" ? "" : ` (${stateRes.sessionPhase.replace("_", "-")})`;
    await logTape({
      kind: "quote_refresh",
      severity: "info",
      message: `${ticker} last=${state.lastPrice.toFixed(2)} vwap=${state.sessionVwap?.toFixed(2) ?? "—"} bars=${stateRes.barCount}${phaseTag}`,
      data: { ticker, mode: config.mode, sessionPhase: stateRes.sessionPhase, state },
    });

    for (const trade of pendingTrades.filter((t) => t.sourceTicker.toUpperCase() === ticker)) {
      const outcome = await processTrade(trade, config, state);
      summary.trades.push(outcome);
    }

    // Phase E (interleaved): evaluate exits for any open positions on this
    // ticker, using the same underlying state we just built.
    if (openTrades.some((t) => t.sourceTicker.toUpperCase() === ticker)) {
      const exitOutcomes = await processOpenExitsForTicker({
        cfg: config,
        ticker,
        baseState: state,
      });
      summary.exits.push(...exitOutcomes);
    }
  }

  if (almaSummary) summary.alma = almaSummary;
  if (alma939Summary) summary.alma939 = alma939Summary;

  // Phase B2: broker-side reconcile. Catches drift between DB and Tradier:
  //   - Stuck `submitting` rows (process died mid-POST) → attach or release.
  //   - Orphan Tradier orders → log warning.
  //   - Orphan Tradier positions → log warning.
  // Runs BEFORE submitAllFired so any stuck rows just released are eligible
  // for retry in the same tick.
  summary.brokerReconcile = await reconcileWithBroker(config);

  // Phase C: OMS — submit orders for any signal_fired trades (including
  // those promoted in this very tick), then reconcile working orders.
  // We run submit first because a just-fired trade is the freshest signal;
  // the reconcile then picks up fills from any order, including the one we
  // just placed (sandbox sometimes fills inside the same second).
  summary.submitted = await submitAllFired(config);
  summary.reconciled = await reconcileWorkingOrders(config);

  // Phase D2: re-peg working entry orders that haven't filled after one
  // tick. Runs AFTER reconcile so any fills from this same tick are
  // recognised first (and the trade is no longer in "working" so we won't
  // re-peg it).
  summary.repegged = await repegStaleWorkingOrders(config);

  const fired = summary.trades.filter((t) => t.outcome === "fired").length;
  const armed = summary.trades.filter(
    (t) => t.outcome === "armed_no_recheck" || t.outcome === "armed",
  ).length;
  const submitted = summary.submitted.filter((s) => s.outcome === "submitted").length;
  const exitsFired = summary.exits.filter(
    (e) =>
      e.outcome === "fired_stop" ||
      e.outcome === "fired_target" ||
      e.outcome === "fired_time_stop" ||
      e.outcome === "fired_alma_reversal" ||
      e.outcome === "fired_alma_break",
  ).length;
  const filledEntries = summary.reconciled.filter((r) => r.phase === "entry" && r.filled).length;
  const filledExits = summary.reconciled.filter((r) => r.phase === "exit" && r.filled).length;
  await logTape({
    kind: "monitor_tick",
    severity: "info",
    message: `Monitor tick done — pending=${summary.pendingCount} tickers=${summary.tickersConsidered} fired=${fired} armed=${armed} submitted=${submitted} exits_fired=${exitsFired} filled_entries=${filledEntries} filled_exits=${filledExits} errors=${summary.errors.length}`,
    data: summary,
  });

  return { ok: true, summary };
}

/**
 * Process one trade through the monitoring pipeline. Two phases:
 *
 *   Phase A (entry latch): if status='pending', evaluate the entry AST
 *     against the underlying market state. On match, atomically promote to
 *     'signal_armed' and stamp entrySignaledAt. Trades already in
 *     'signal_armed' skip this phase.
 *
 *   Phase B (live re-check): pull the live option quote, compute mid, run
 *     evaluateLiveMidRisk (plan-slippage guard + per-trade cap with the
 *     LIVE number, per §6.5). On pass, promote to 'signal_fired'. On fail,
 *     stay in 'signal_armed' so the next tick can retry.
 */
async function processTrade(
  trade: typeof botTrades.$inferSelect,
  config: BotConfig,
  state: MarketState,
): Promise<TickTradeOutcome> {
  const plan = (trade.plan ?? {}) as Record<string, unknown>;
  const ast = (plan.ast ?? null) as TriggerAST | null;
  const entryCond = ast?.entry as Condition | null;
  const planMid = (plan.entryMidEstimate as number | null) ?? null;

  // ---- Phase A: entry latch (only for status=pending) -------------------
  if (trade.status === "pending") {
    if (!entryCond) {
      return {
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        status: trade.status,
        outcome: "ast_missing",
        reason: "no entry AST on trade.plan",
      };
    }

    const entryResult = evaluate(entryCond, state);
    if (!entryResult.matched) {
      return {
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        status: trade.status,
        outcome: "no_match",
      };
    }

    // Race-safe latch. Also patch `plan.ast.time_stop` if it's null: anchor
    // the default time-stop to the current ET time so the exit evaluator
    // has an absolute cutoff to compare against later.
    const now = new Date();
    const patchedPlan: Record<string, unknown> = { ...plan };
    if (ast && ast.time_stop == null) {
      const d = buildDefaultExits(config, state.nowEt);
      patchedPlan.ast = { ...ast, time_stop: d.time_stop };
    }
    const armed = await db
      .update(botTrades)
      .set({
        status: "signal_armed",
        entrySignaledAt: now,
        plan: patchedPlan,
      })
      .where(
        and(
          eq(botTrades.id, trade.id),
          eq(botTrades.status, "pending"),
          isNull(botTrades.entrySignaledAt),
        ),
      )
      .returning({ id: botTrades.id });

    if (armed.length === 0) {
      return {
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        status: trade.status,
        outcome: "skipped_already_progressed",
      };
    }

    await logTape({
      kind: "signal_armed",
      severity: "success",
      message: `${trade.sourceTicker} ${trade.strategy} — entry condition matched`,
      tradeId: trade.id,
      data: { ticker: trade.sourceTicker, grade: trade.sourceGrade, planMid, state },
    });
    // fall through to Phase B in the same tick
  }

  // ---- Phase B: live re-check (for status=signal_armed) -----------------
  // Resolve OCC, fetch option quote, run live-mid risk, promote if pass.
  const occ = resolveOcc(trade);
  if (!occ.ok) {
    await logTape({
      kind: "risk_block",
      severity: "warn",
      message: `${trade.sourceTicker} — re-check skipped: ${occ.reason}`,
      tradeId: trade.id,
      data: { reason: occ.reason },
    });
    return {
      tradeId: trade.id,
      ticker: trade.sourceTicker,
      status: "signal_armed",
      outcome: "armed_no_recheck",
      reason: occ.reason,
    };
  }

  const quoteRes = await getOptionQuote(config.mode, occ.occSymbol);
  if (!quoteRes.ok) {
    await logTape({
      kind: "error",
      severity: "error",
      message: `${trade.sourceTicker} ${occ.occSymbol} — option quote fetch failed: ${quoteRes.reason}`,
      tradeId: trade.id,
      data: { ticker: trade.sourceTicker, occSymbol: occ.occSymbol, code: quoteRes.code },
    });
    return {
      tradeId: trade.id,
      ticker: trade.sourceTicker,
      status: "signal_armed",
      outcome: "armed_no_recheck",
      reason: quoteRes.reason,
    };
  }
  const q = quoteRes.data;
  const mid =
    q == null ? null : liveMid({ bid: q.bid, ask: q.ask, last: q.last });

  await logTape({
    kind: "quote_refresh",
    severity: "info",
    message: `${trade.sourceTicker} ${occ.occSymbol} bid=${q?.bid ?? "—"} ask=${q?.ask ?? "—"} mid=${mid?.toFixed(2) ?? "—"} plan=${planMid?.toFixed(2) ?? "—"}`,
    tradeId: trade.id,
    data: {
      ticker: trade.sourceTicker,
      occSymbol: occ.occSymbol,
      bid: q?.bid ?? null,
      ask: q?.ask ?? null,
      last: q?.last ?? null,
      mid,
      planMid,
    },
  });

  const decision = evaluateLiveMidRisk({ config, planMid, liveMid: mid });
  if (!decision.ok) {
    await logTape({
      kind: "risk_block",
      severity: "warn",
      message: `${trade.sourceTicker} ${occ.occSymbol} — ${decision.reason}`,
      tradeId: trade.id,
      data: { code: decision.code, occSymbol: occ.occSymbol, mid, planMid },
    });
    return {
      tradeId: trade.id,
      ticker: trade.sourceTicker,
      status: "signal_armed",
      outcome: "armed_no_recheck",
      reason: decision.reason,
    };
  }

  // ---- Option 3 gate: alma_plus_plan requires ALMA confirmation in the
  // same direction as the plan. Without it, the plan-based trade stays
  // armed and re-checks on each tick until ALMA crosses + maintains READY
  // for this ticker on the matching side (or end-of-day force-exit clears it).
  if (config.activeSignalStrategy === "alma_plus_plan") {
    const planSide: "long" | "short" =
      trade.strategy === "long_put" ? "short" : "long";
    const [almaRow] = await db
      .select()
      .from(botAlmaState)
      .where(eq(botAlmaState.ticker, trade.sourceTicker.toUpperCase()))
      .limit(1);
    const almaOk = almaRow && almaRow.side === planSide;
    if (!almaOk) {
      await logTape({
        kind: "risk_block",
        severity: "info",
        message: `${trade.sourceTicker} ${trade.strategy} — awaiting ALMA ${planSide} confirmation (current state: ${almaRow?.side ?? "no READY"})`,
        tradeId: trade.id,
        data: {
          code: "alma_confirmation_missing",
          planSide,
          almaSide: almaRow?.side ?? null,
        },
      });
      return {
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        status: "signal_armed",
        outcome: "armed_no_recheck",
        reason: `awaiting ALMA ${planSide} confirmation`,
      };
    }
  }

  // All gates passed — promote to signal_fired (race-safe).
  const fired = await db
    .update(botTrades)
    .set({ status: "signal_fired" })
    .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "signal_armed")))
    .returning({ id: botTrades.id });
  if (fired.length === 0) {
    return {
      tradeId: trade.id,
      ticker: trade.sourceTicker,
      status: trade.status,
      outcome: "skipped_already_progressed",
    };
  }

  await logTape({
    kind: "signal_fired",
    severity: "success",
    message: `${trade.sourceTicker} ${occ.occSymbol} — live re-check passed (mid $${mid!.toFixed(2)}, plan $${planMid?.toFixed(2) ?? "—"}). Ready for OMS.`,
    tradeId: trade.id,
    data: {
      ticker: trade.sourceTicker,
      occSymbol: occ.occSymbol,
      mid,
      planMid,
      nextStep: "Phase 4: OMS submits limit order at mid; status → working.",
    },
  });

  return {
    tradeId: trade.id,
    ticker: trade.sourceTicker,
    status: "signal_fired",
    outcome: "fired",
  };
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
