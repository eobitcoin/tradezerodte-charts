/**
 * Signal strategy registry.
 *
 * The bot honors exactly one strategy at a time, selected via
 * `bot_config.active_signal_strategy`. Each strategy is a self-contained
 * unit of behavior: how it identifies entries, how it picks the contract,
 * what additional data it requires.
 *
 * Adding a new strategy:
 *   1. Add its id to `SignalStrategy` in lib/db/schema.ts.
 *   2. Add a `StrategyMeta` entry to the `STRATEGIES` map below — that's all
 *      the SIGNALS tab needs to render the option + its docs.
 *   3. Wire the actual signal logic in lib/botwick/monitor.ts (or a per-
 *      strategy module under this directory) where the strategy switch
 *      currently dispatches.
 *
 * The UI reads ONLY from this registry, so SIGNALS tab content stays in
 * sync with the runtime by construction.
 */

import type { SignalStrategy } from "@/lib/db/schema";

export type StrategyStatus = "implemented" | "in_development";

export type StrategyMeta = {
  id: SignalStrategy;
  name: string;
  /** One-line label in the radio-pick UI. */
  shortLabel: string;
  /** Plain-English summary shown under the radio. */
  summary: string;
  /** Detailed rules — rendered as a bullet list on the SIGNALS tab. */
  rules: string[];
  /** What data sources the strategy depends on (informational chips). */
  dataSources: string[];
  /** Whether the runtime currently dispatches to a working implementation. */
  status: StrategyStatus;
  /** Optional default-recommendation note. */
  recommended?: boolean;
  /** When true, the strategy stays in the codebase but is hidden from the
   *  SIGNALS UI. Used to retire strategies without breaking the DB enum. */
  hidden?: boolean;
};

export const STRATEGIES: Record<SignalStrategy, StrategyMeta> = {
  alma_vwap_cross: {
    id: "alma_vwap_cross",
    name: "Option 1 — ALMA × VWAP Cross",
    shortLabel: "ALMA × VWAP",
    summary:
      "Pure technical signal: ALMA(9, 6, 0.85) crossing session VWAP on the 5-min chart, with entry on pullback to ALMA. Pricing-agnostic to any external trade plan.",
    rules: [
      "Indicator: ALMA(length=9, sigma=6, offset=0.85) on the 5-min chart.",
      "Reference: session VWAP.",
      "LONG setup: ALMA(9) is sloping up steeply AND crosses ABOVE VWAP → READY (long).",
      "LONG entry: while READY (long), price pulls back to ALMA(9) → bot buys the nearest OTM CALL at the bid/ask mid.",
      "SHORT setup: ALMA(9) is sloping down steeply AND crosses BELOW VWAP → READY (short).",
      "SHORT entry: while READY (short), price pulls back to ALMA(9) → bot buys the nearest OTM PUT at the bid/ask mid.",
      "Order size (options mode): derived from CONFIG → Position Size ($). Contracts = floor(positionSize / (mid × 100)), capped by Max Risk Per Trade.",
      "Order size (stock modes): qty = floor(maxStockNotional / underlyingPrice), capped further by Tradier-reported stock buying power at submit.",
      "Instrument toggle in CONFIG → ALMA × VWAP settings: 'options' (default), 'stock_long' (LONG signals only — buys shares), 'stock_short' (SHORT signals only — short-sells; margin required), or 'stock_both' (both directions). Same signal/pullback logic; only the asset traded changes.",
      "Exits: default Target1/Target2/Stop/Time-stop from CONFIG. Optional ALMA reversal exit (CONFIG → ALMA × VWAP settings) fires MARKET sell_to_close when ALMA crosses back against the position.",
    ],
    dataSources: ["Tradier 5-min bars", "Tradier option chain", "Session VWAP (computed from bars)"],
    status: "implemented",
    recommended: true,
  },
  alma_9_39_rsi: {
    id: "alma_9_39_rsi",
    name: "Option 2 — ALMA 9/39 RSI Cross",
    shortLabel: "ALMA 9/39 RSI",
    summary:
      "ALMA(9) crossing ALMA(39) on the 5-min chart with RSI, Choppiness, VWAP and NY-session filters. Long calls on bullish cross; long puts on bearish cross. Fully configurable in CONFIG.",
    rules: [
      "Indicators: ALMA(fast=9), ALMA(slow=39) — same offset/sigma, configurable.",
      "LONG entry — ALL must be true on the latest closed 5-min bar:",
      "  • ALMA9 crosses ABOVE ALMA39 this bar",
      "  • RSI within configured long band (default 50–72)",
      "  • Choppiness Index on the configured side of threshold (default ≤ 50 = trending)",
      "  • Close (or HL2) ABOVE session VWAP",
      "  • Inside the NY entry session (default 09:30–16:00)",
      "  • Before the configured force-close cutoff (default 15:55)",
      "  • No existing in-flight trade for this ticker",
      "SHORT entry — symmetric: ALMA9 crosses BELOW ALMA39, RSI in short band (default 28–50), price below VWAP. Bot buys nearest OTM PUT.",
      "Instrument toggle in CONFIG → ALMA 9/39 RSI settings: 'options' (default), 'stock_long' (long shares only), 'stock_short' (short shares only; margin required), 'stock_both' (long + short). In stock modes the bot buys/short-sells underlying shares instead of contracts; SHORT-only or LONG-only modes skip-with-warning on the wrong-side signal.",
      "Order size (options): floor(min(positionSize, maxRiskPerTrade) / (live_mid × 100)). originalQty + entryUnderlying are locked at fill for scale-out math.",
      "Order size (stock modes): floor(maxStockNotional / underlyingPrice), capped further by Tradier stock buying power. Same scale-out machinery applies to shares.",
      "Exits (priority order):",
      "  1. Force-close at 15:55 ET (BotWick day-trade sweep) — full MARKET close",
      "  2. Stop loss on underlying — FIXED % (default 1%) OR TRAILING % with anchor = prev-bar extreme / current-bar extreme / close. Trailing stop only moves favorably and is floored at the fixed-SL distance.",
      "  3. TP1–TP5 on underlying price — each enabled level scales out its configured qty % of the ORIGINAL position via MARKET; the last enabled level full-closes the remainder. (Defaults: TP1 +0.50% / TP2 +1.00% / TP3 +1.50% / TP4 +2.00% / TP5 +2.50%, 20% qty each.)",
      "  4. ALMA exits (optional): close vs ALMA39, ALMA9 × ALMA39 cross against position — full MARKET close",
      "  5. VWAP exits (optional): close vs VWAP, ALMA9 × VWAP cross with close confirming — full MARKET close",
    ],
    dataSources: ["Tradier 5-min bars", "Tradier option chain", "Session VWAP (computed)", "RSI + Choppiness (computed)"],
    status: "implemented",
  },
  plan_based: {
    id: "plan_based",
    name: "0DTE Plan-Based (retired)",
    shortLabel: "0DTE Plans",
    summary: "Retired. Bot no longer trades from the daily research post — the research itself still publishes.",
    rules: [],
    dataSources: [],
    status: "implemented",
    hidden: true,
  },
  alma_plus_plan: {
    id: "alma_plus_plan",
    name: "ALMA Confirms Plan (retired)",
    shortLabel: "ALMA + Plan",
    summary: "Retired. Depended on the plan-based strategy which is no longer offered.",
    rules: [],
    dataSources: [],
    status: "in_development",
    hidden: true,
  },
};

/** Iteration helper for UI rendering. Only non-hidden strategies. */
export const STRATEGY_ORDER: SignalStrategy[] = (
  ["alma_vwap_cross", "alma_9_39_rsi", "plan_based", "alma_plus_plan"] as const
).filter((id) => !STRATEGIES[id].hidden);
