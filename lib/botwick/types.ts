/**
 * BotWick — shared types for plan parsing, risk gating, and OMS.
 *
 * The trigger AST mirrors the predicate language documented in
 * docs/botwick-architecture.md §6. Predicates are intentionally small and
 * stateless — evaluation lives in the runner, not in these types.
 */

/** A single predicate the trigger evaluator can check against a tick. */
export type Predicate =
  | { bar_close_below: { price: number; tf: "1min" | "5min" | "15min" } }
  | { bar_close_above: { price: number; tf: "1min" | "5min" | "15min" } }
  | { vwap_rejection: { side: "short" | "long" } }
  /** Plain state check: is the latest bar close on the requested side of VWAP?
   *  "above" maps to "VWAP support" / "VWAP reclaim" prose; "below" maps to
   *  short-side equivalents. Different from vwap_rejection which is a
   *  bar-pattern (tag + reverse). */
  | { vwap_relative: { side: "above" | "below" } }
  | { time_after: { et: string } }   // "HH:MM"
  | { time_before: { et: string } }  // "HH:MM"
  | { underlying_at: { price: number; op: "<=" | ">=" | "<" | ">" } }
  | { premium_pct_gte: number }      // e.g. 60 means +60% from entry fill
  | { premium_pct_lte: number };     // e.g. -40 means -40% from entry fill

/**
 * Boolean combination of predicates. `all` = AND, `any` = OR.
 * A leaf is a bare Predicate (no wrapper).
 */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | Predicate;

/** Per-trade trigger AST. Each branch may be null when unparseable. */
export type TriggerAST = {
  entry: Condition | null;
  target1: Condition | null;
  target2: Condition | null;
  stop: Condition | null;
  time_stop: Condition | null;
};

/** Option contract derived from a Trade. */
export type ContractIntent = {
  optionType: "call" | "put";
  strike: number | null;
  /** "0DTE" | "1DTE" | ... | ISO date | null when unknown */
  expiry: string | null;
  /** OCC standard, if explicitly named in the plan: "TSLA260513C00445000" */
  occSymbol: string | null;
};

/**
 * Output of plan-parser. Always returns — never throws. `parsed=false` means
 * we couldn't extract enough to safely act on this trade; the runner must
 * skip those.
 */
export type ParsedPlan = {
  ticker: string;
  contract: ContractIntent;
  ast: TriggerAST;
  /** Estimated mid-price at entry from the entry_zone prose, when given. */
  entryMidEstimate: number | null;
  /** Range from entry_zone prose, when present: [low, high]. */
  entryZoneRange: [number, number] | null;
  /**
   * False if any of entry/target1/stop are null OR contract.strike+optionType
   * are missing. Conservative: missing target2 alone doesn't fail the parse.
   */
  parsed: boolean;
  /** Human-readable notes about anything we couldn't recognise. */
  warnings: string[];
};
