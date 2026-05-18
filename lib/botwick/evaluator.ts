/**
 * BotWick trigger evaluator.
 *
 * Pure: takes a `Condition` + a `MarketState` snapshot, returns a tree of
 * results explaining exactly why each branch matched (or didn't). No I/O,
 * no DB, no clock — `MarketState.nowEt` is supplied by the caller so this
 * function is deterministic for the same inputs.
 *
 * This is what the runner (Phase 3) will call per tick against the live
 * data stream. For now it powers the admin Signal Sandbox so the user can
 * punch in hypothetical states and see how the parsed ASTs would react.
 *
 * Premium-percent predicates (premium_pct_gte / premium_pct_lte) compare to
 * a *fill price* that isn't known until the position is open. We treat
 * those as "indeterminate" (matched=false, reason="no fill price yet")
 * unless `state.entryFill` is provided.
 */

import type { Condition, Predicate } from "./types";

export type MarketState = {
  ticker: string;
  /** Last trade / mid price for the underlying. */
  lastPrice: number;
  /** Session VWAP. null when not yet computed (e.g., pre-market). */
  sessionVwap: number | null;
  /** Latest *closed* bar per timeframe. Open bar is intentionally excluded. */
  lastBars: Partial<
    Record<"1min" | "5min" | "15min", { close: number; high: number; low: number }>
  >;
  /**
   * Pattern flags. The bar-pattern detection that produces these flags is
   * future work; for the sandbox the admin asserts them, and the runner will
   * compute them from streaming bars.
   */
  vwapRejectionShort: boolean;
  vwapRejectionLong: boolean;
  /** "HH:MM" America/New_York. Caller controls the clock. */
  nowEt: string;
  /**
   * Premium fill at entry, used for premium_pct_* predicates on exits.
   * Undefined when the position hasn't opened yet (sandbox / pending trades).
   */
  entryFill?: number;
  /** Current option mid for premium_pct_* checks. */
  currentMid?: number;
};

export type PredicateResult = {
  matched: boolean;
  reason: string;
};

export type ConditionResult =
  | { kind: "leaf"; predicate: Predicate; matched: boolean; reason: string }
  | { kind: "all"; matched: boolean; children: ConditionResult[] }
  | { kind: "any"; matched: boolean; children: ConditionResult[] };

/** "HH:MM" lexical compare works because we zero-pad on the parser side. */
function cmpTime(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function evalPredicate(p: Predicate, state: MarketState): PredicateResult {
  // Each branch handles ONE shape; mutually exclusive — the discriminator is
  // the only present key. We do a key-check rather than `if ("bar_close_below" in p)`
  // because that idiom narrows poorly here.

  if ("bar_close_below" in p) {
    const { price, tf } = p.bar_close_below;
    const bar = state.lastBars[tf];
    if (!bar) return { matched: false, reason: `no ${tf} bar yet` };
    return {
      matched: bar.close < price,
      reason: `${tf} close ${bar.close.toFixed(2)} vs ${price.toFixed(2)}`,
    };
  }

  if ("bar_close_above" in p) {
    const { price, tf } = p.bar_close_above;
    const bar = state.lastBars[tf];
    if (!bar) return { matched: false, reason: `no ${tf} bar yet` };
    return {
      matched: bar.close > price,
      reason: `${tf} close ${bar.close.toFixed(2)} vs ${price.toFixed(2)}`,
    };
  }

  if ("vwap_rejection" in p) {
    const side = p.vwap_rejection.side;
    const matched = side === "short" ? state.vwapRejectionShort : state.vwapRejectionLong;
    return {
      matched,
      reason: matched
        ? `${side}-side VWAP rejection detected`
        : `no ${side}-side VWAP rejection`,
    };
  }

  if ("vwap_relative" in p) {
    const side = p.vwap_relative.side;
    if (state.sessionVwap == null) {
      return { matched: false, reason: "no session VWAP yet" };
    }
    // Use last bar close when available (predicate is bar-anchored). Falls
    // back to lastPrice when bars aren't pulled (e.g., pre-market).
    const bar = state.lastBars["5min"] ?? state.lastBars["1min"] ?? state.lastBars["15min"];
    const ref = bar?.close ?? state.lastPrice;
    const matched = side === "above" ? ref > state.sessionVwap : ref < state.sessionVwap;
    return {
      matched,
      reason: `${ref.toFixed(2)} ${matched ? (side === "above" ? ">" : "<") : (side === "above" ? "≤" : "≥")} vwap ${state.sessionVwap.toFixed(2)}`,
    };
  }

  if ("time_after" in p) {
    const target = p.time_after.et;
    const matched = cmpTime(state.nowEt, target) >= 0;
    return { matched, reason: `now ${state.nowEt} ${matched ? "≥" : "<"} ${target}` };
  }

  if ("time_before" in p) {
    const target = p.time_before.et;
    const matched = cmpTime(state.nowEt, target) <= 0;
    return { matched, reason: `now ${state.nowEt} ${matched ? "≤" : ">"} ${target}` };
  }

  if ("underlying_at" in p) {
    const { price, op } = p.underlying_at;
    const last = state.lastPrice;
    let matched = false;
    switch (op) {
      case "<=": matched = last <= price; break;
      case ">=": matched = last >= price; break;
      case "<":  matched = last < price; break;
      case ">":  matched = last > price; break;
    }
    return {
      matched,
      reason: `last ${last.toFixed(2)} ${matched ? op : "!" + op} ${price.toFixed(2)}`,
    };
  }

  if ("premium_pct_gte" in p) {
    if (state.entryFill == null || state.currentMid == null) {
      return { matched: false, reason: "no fill/mid yet (premium % indeterminate)" };
    }
    const pct = ((state.currentMid - state.entryFill) / state.entryFill) * 100;
    const matched = pct >= p.premium_pct_gte;
    return {
      matched,
      reason: `premium ${pct.toFixed(1)}% ${matched ? "≥" : "<"} ${p.premium_pct_gte}%`,
    };
  }

  if ("premium_pct_lte" in p) {
    if (state.entryFill == null || state.currentMid == null) {
      return { matched: false, reason: "no fill/mid yet (premium % indeterminate)" };
    }
    const pct = ((state.currentMid - state.entryFill) / state.entryFill) * 100;
    const matched = pct <= p.premium_pct_lte;
    return {
      matched,
      reason: `premium ${pct.toFixed(1)}% ${matched ? "≤" : ">"} ${p.premium_pct_lte}%`,
    };
  }

  // Exhaustive — TS will fail here if Predicate gains a new variant.
  const _exhaustive: never = p;
  return { matched: false, reason: `unknown predicate ${JSON.stringify(_exhaustive)}` };
}

/** Recursive evaluator. Returns a result tree mirroring the Condition. */
export function evaluate(cond: Condition, state: MarketState): ConditionResult {
  if ("all" in cond) {
    const children = cond.all.map((c) => evaluate(c, state));
    return { kind: "all", matched: children.every((c) => c.matched), children };
  }
  if ("any" in cond) {
    const children = cond.any.map((c) => evaluate(c, state));
    return { kind: "any", matched: children.some((c) => c.matched), children };
  }
  const r = evalPredicate(cond as Predicate, state);
  return { kind: "leaf", predicate: cond as Predicate, matched: r.matched, reason: r.reason };
}

/**
 * Flatten the result tree into a list of leaf rows for display.
 * Each row carries its boolean + a human reason. Caller decides indentation.
 */
export type FlatResult = {
  depth: number;
  kind: "leaf" | "all" | "any";
  matched: boolean;
  label: string;
};

export function flattenResult(r: ConditionResult, depth = 0): FlatResult[] {
  if (r.kind === "leaf") {
    return [{ depth, kind: "leaf", matched: r.matched, label: leafLabel(r.predicate, r.reason) }];
  }
  const header: FlatResult = {
    depth,
    kind: r.kind,
    matched: r.matched,
    label: r.kind === "all" ? "ALL of:" : "ANY of:",
  };
  return [header, ...r.children.flatMap((c) => flattenResult(c, depth + 1))];
}

function leafLabel(p: Predicate, reason: string): string {
  const k = Object.keys(p)[0] as keyof Predicate;
  return `${k} — ${reason}`;
}
