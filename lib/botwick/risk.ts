/**
 * BotWick risk engine — v1 (ingest-time gates only).
 *
 * What's gated here vs the runner:
 *   - Static gates (this file): enabled, kill switch, mode, grade filter,
 *     parser sanity, per-trade dollar cap, concurrency cap. These can run at
 *     plan-ingest time, with NO live market data.
 *   - Dynamic gates (later, in the runner): bid/ask spread, liquidity,
 *     buying-power, intraday drawdown vs max_daily_loss. Those need a quote
 *     and an account state.
 *
 * Every decision returns a structured `RiskDecision` so the ingest pipeline
 * can log the exact reason in `bot_actions` (and surface it on the Matrix
 * tape verbatim).
 */

import type { BotConfig, BotGradeFilter, Trade } from "@/lib/db/schema";
import type { ParsedPlan } from "./types";

/** Final decision shape: allow / block. */
export type RiskDecision =
  | { ok: true }
  | { ok: false; reason: string; code: RiskBlockCode };

/** Stable codes so the UI can color/group them later. */
export type RiskBlockCode =
  | "bot_disabled"
  | "kill_switch"
  | "mode_off"
  | "direction_avoid"
  | "grade_below_filter"
  | "plan_unparsed"
  | "missing_premium_estimate"
  | "per_trade_cap"
  | "max_open_positions"
  // Live-mid re-check codes (Phase 3b)
  | "no_option_quote"
  | "stale_option_quote"
  | "plan_slippage"
  | "live_per_trade_cap";

const GRADE_ORDER: Record<string, number> = {
  "A+": 14, A: 13, "A-": 12,
  "B+": 11, B: 10, "B-": 9,
  "C+": 8, C: 7, "C-": 6,
  "D+": 5, D: 4, "D-": 3,
  F: 1,
};

/**
 * Min grade rank required by the filter. "A+" = strictest; "ALL" = take
 * anything tradable.
 */
function minRankFor(filter: BotGradeFilter): number {
  if (filter === "ALL") return 0;
  return GRADE_ORDER[filter] ?? 999;
}

function gradePasses(grade: string | null | undefined, filter: BotGradeFilter): boolean {
  if (!grade) return false;
  return (GRADE_ORDER[grade] ?? -1) >= minRankFor(filter);
}

/**
 * Run all static gates against a parsed plan.
 *
 * `openPositionsCount` is the current count of bot_trades in
 * working/open/closing state (passed in from the ingest caller — keeps this
 * function pure / easy to test).
 */
export function evaluateStaticRisk(args: {
  config: BotConfig;
  trade: Trade;
  parsed: ParsedPlan;
  openPositionsCount: number;
}): RiskDecision {
  const { config, trade, parsed, openPositionsCount } = args;

  // Master gates first — fail fast, no per-trade computation needed.
  if (config.killSwitchEngaged) {
    return { ok: false, code: "kill_switch", reason: "kill switch engaged" };
  }
  if (!config.enabled) {
    return { ok: false, code: "bot_disabled", reason: "bot disabled" };
  }
  if (config.mode === "off") {
    return { ok: false, code: "mode_off", reason: "mode=off" };
  }

  // Trade-level: AVOID isn't tradable by definition.
  if (trade.direction === "avoid") {
    return { ok: false, code: "direction_avoid", reason: "direction=avoid" };
  }

  // Grade filter.
  if (!gradePasses(trade.grade, config.gradeFilter)) {
    return {
      ok: false,
      code: "grade_below_filter",
      reason: `grade ${trade.grade} below filter ${config.gradeFilter}`,
    };
  }

  // Parser sanity.
  if (!parsed.parsed) {
    return {
      ok: false,
      code: "plan_unparsed",
      reason: `plan not fully parseable: ${parsed.warnings.join("; ") || "missing fields"}`,
    };
  }

  // Per-trade dollar cap. We need a premium estimate to compute risk; if the
  // plan didn't include an entry zone, we can't size safely yet.
  if (parsed.entryMidEstimate == null) {
    return {
      ok: false,
      code: "missing_premium_estimate",
      reason: "no entry-zone mid — risk can't be sized",
    };
  }
  // Long-option max loss = premium * 100 * contracts. Sizing engine in the
  // runner picks contracts. Here we just check that ONE contract fits the cap.
  const oneContractRisk = parsed.entryMidEstimate * 100;
  const cap = Number(config.maxRiskPerTradeUsd);
  if (oneContractRisk > cap) {
    return {
      ok: false,
      code: "per_trade_cap",
      reason: `one contract = $${oneContractRisk.toFixed(2)} > cap $${cap.toFixed(2)}`,
    };
  }

  // Concurrency.
  if (openPositionsCount >= config.maxOpenPositions) {
    return {
      ok: false,
      code: "max_open_positions",
      reason: `${openPositionsCount}/${config.maxOpenPositions} positions open`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Live-mid re-check (Phase 3b)
// ---------------------------------------------------------------------------

export type LiveQuoteSnapshot = {
  bid: number | null;
  ask: number | null;
  last: number | null;
};

/** Compute mid the way the OMS will price an entry order. Returns null when
 *  bid/ask are missing or nonsensical (sandbox sometimes returns zeros). */
export function liveMid(q: LiveQuoteSnapshot): number | null {
  if (q.bid == null || q.ask == null) return null;
  if (q.bid <= 0 || q.ask <= 0) return null;
  if (q.ask < q.bid) return null;
  return (q.bid + q.ask) / 2;
}

/**
 * Run the live-mid re-check before promoting `signal_armed → signal_fired`.
 *
 * Three gates, in order:
 *   1. We must have a live mid at all.
 *   2. Live mid must not deviate from the plan estimate by more than
 *      `maxPlanSlippagePct` (either direction). Egregious moves => skip.
 *   3. One-contract risk against the LIVE mid must still fit
 *      `maxRiskPerTradeUsd`. The ingest-time check used the plan estimate;
 *      now that we know the real number, we re-prove it.
 *
 * This is intentionally a SEPARATE function from `evaluateStaticRisk`:
 * static risk is callable without market data; this one requires a quote.
 * Mixing them would hide the dependency.
 */
export function evaluateLiveMidRisk(args: {
  config: BotConfig;
  planMid: number | null;
  liveMid: number | null;
}): RiskDecision {
  const { config, planMid, liveMid } = args;

  if (liveMid == null) {
    return {
      ok: false,
      code: "no_option_quote",
      reason: "live option mid unavailable (bid/ask missing or inverted)",
    };
  }

  // Plan-slippage guard. We only run it when the plan included an estimate
  // — if it didn't, the ingest-time gate already required one, so reaching
  // this branch with planMid=null is a regression worth surfacing.
  if (planMid != null && planMid > 0) {
    const deviation = Math.abs(liveMid - planMid) / planMid;
    const cap = Number(config.maxPlanSlippagePct) / 100;
    if (deviation > cap) {
      const direction = liveMid > planMid ? "above" : "below";
      return {
        ok: false,
        code: "plan_slippage",
        reason: `live mid $${liveMid.toFixed(2)} is ${(deviation * 100).toFixed(0)}% ${direction} plan $${planMid.toFixed(2)} (cap ${(cap * 100).toFixed(0)}%)`,
      };
    }
  }

  // Re-prove per-trade cap against the live number.
  const oneContractRisk = liveMid * 100;
  const dollarCap = Number(config.maxRiskPerTradeUsd);
  if (oneContractRisk > dollarCap) {
    return {
      ok: false,
      code: "live_per_trade_cap",
      reason: `live one contract = $${oneContractRisk.toFixed(2)} > cap $${dollarCap.toFixed(2)}`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// In-flight position counter — used by every entry path (ALMA strategies +
// OMS submitNewEntry) so maxOpenPositions is enforced AT EVERY POST instead
// of only at plan-ingest time.
//
// "In flight" = anything that has reached or is about to reach the broker:
//   submitting (claim taken, POST in flight)
//   working    (order at broker, not yet filled)
//   open       (filled, live position)
//   closing    (exit in flight; still counts because the position isn't
//               yet realized — if the exit fails we bounce back to open)
// ---------------------------------------------------------------------------

import { count, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { botTrades, type BotTradeStatus } from "@/lib/db/schema";

const IN_FLIGHT_STATUSES: BotTradeStatus[] = ["submitting", "working", "open", "closing"];

export async function countInFlightPositions(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(botTrades)
    .where(inArray(botTrades.status, IN_FLIGHT_STATUSES));
  return Number(row?.n ?? 0);
}

/**
 * Race-safe maxOpenPositions check. Call right before submitting an order
 * (in the strategy entry path AND in submitNewEntry — both, because the
 * strategy check is on stale data by the time the OMS POSTs).
 */
export async function maxOpenPositionsGate(
  config: BotConfig,
): Promise<RiskDecision> {
  const inFlight = await countInFlightPositions();
  if (inFlight >= config.maxOpenPositions) {
    return {
      ok: false,
      code: "max_open_positions",
      reason: `${inFlight}/${config.maxOpenPositions} positions in flight (submitting/working/open/closing)`,
    };
  }
  return { ok: true };
}
