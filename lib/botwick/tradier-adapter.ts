/**
 * BotWick → Tradier adapter.
 *
 * Why this exists when `lib/tradier.ts` already does:
 *
 *   1. **Mode-aware base URL + token**. The existing client is hard-wired to
 *      production (`TRADIER_API_KEY`, `api.tradier.com`). The bot needs to
 *      route to sandbox when `mode=paper` and prod when `mode=live`,
 *      choosing the token per env. Mixing those concerns into the existing
 *      MaxPain/GEX client would risk regressing those features.
 *   2. **Result-as-data**. The bot logs failures to `bot_actions` and keeps
 *      going. Exceptions inside a monitoring loop would crash the tick. This
 *      adapter returns `TradierResult<T>` so the caller pattern-matches on
 *      `ok` and never has to try/catch.
 *
 * Env vars (Railway → Web service):
 *   - TRADIER_SANDBOX_TOKEN   — required for paper-trading monitoring
 *   - TRADIER_LIVE_TOKEN      — required for live-trading monitoring
 *   - TRADIER_API_KEY         — legacy fallback for "live" (MaxPain uses it)
 */

import type { BotMode } from "@/lib/db/schema";

const SANDBOX_BASE = "https://sandbox.tradier.com/v1";
const LIVE_BASE = "https://api.tradier.com/v1";

export type TradierEnv = "sandbox" | "live";

export type TradierResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string; code: TradierErrorCode };

export type TradierErrorCode =
  | "no_token"
  | "mode_off"
  | "auth"
  | "rate_limited"
  | "network"
  | "bad_response"
  | "server_error";

/**
 * Two different routings — DATA vs ORDERS — picked per call:
 *
 *   - **Data env**: where quotes / bars / option mids come from. For
 *     `mode=paper` we PREFER production (`api.tradier.com`) when a live
 *     token is configured, because Tradier's sandbox data feed is 15 min
 *     delayed and that's worthless for 0DTE signal evaluation. Falls back
 *     to sandbox if no live token exists.
 *   - **Order env**: where order submissions go. For `mode=paper` this is
 *     ALWAYS sandbox — that's the whole point of paper mode (no real money).
 *
 * Same `mode=live` semantics on both: production data, production orders.
 *
 * The split is automatic — no admin config required. The presence of the
 * `TRADIER_LIVE_TOKEN` / `TRADIER_API_KEY` env var is the signal that prod
 * data is available; in its absence we degrade gracefully.
 */
function dataEnvFromMode(mode: BotMode): TradierEnv | null {
  if (mode === "off") return null;
  if (mode === "live") return "live";
  // mode === "paper": prefer prod data when available.
  const liveTokenSet = !!(process.env.TRADIER_LIVE_TOKEN ?? process.env.TRADIER_API_KEY);
  return liveTokenSet ? "live" : "sandbox";
}

function orderEnvFromMode(mode: BotMode): TradierEnv | null {
  if (mode === "paper") return "sandbox";
  if (mode === "live") return "live";
  return null;
}

function tokenFor(env: TradierEnv): string | undefined {
  if (env === "sandbox") return process.env.TRADIER_SANDBOX_TOKEN;
  // Live: prefer the explicit BotWick var; fall back to the legacy
  // TRADIER_API_KEY (already in Railway for MaxPain/GEX).
  return process.env.TRADIER_LIVE_TOKEN ?? process.env.TRADIER_API_KEY;
}

function baseFor(env: TradierEnv): string {
  return env === "sandbox" ? SANDBOX_BASE : LIVE_BASE;
}

/**
 * Internal GET helper. `routing` selects "data" (real-time-preferred) vs
 * "order" (env strictly determined by mode). Account-scoped endpoints
 * (e.g. `/accounts/{id}/orders/{id}`) MUST use "order"; market-data
 * endpoints (`/markets/*`) use "data".
 */
async function tradierGet<T>(
  mode: BotMode,
  routing: "data" | "order",
  path: string,
  query: Record<string, string>,
): Promise<TradierResult<T>> {
  const env = routing === "data" ? dataEnvFromMode(mode) : orderEnvFromMode(mode);
  if (!env) {
    return { ok: false, code: "mode_off", reason: `bot mode is "${mode}", refusing Tradier call` };
  }
  const token = tokenFor(env);
  if (!token) {
    return {
      ok: false,
      code: "no_token",
      reason:
        env === "sandbox"
          ? "TRADIER_SANDBOX_TOKEN env var is not set"
          : "TRADIER_LIVE_TOKEN / TRADIER_API_KEY env var is not set",
    };
  }
  const url = `${baseFor(env)}${path}?${new URLSearchParams(query).toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return { ok: false, code: "network", reason: `fetch failed: ${String(e)}` };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, code: "auth", reason: `Tradier auth failed (${res.status})` };
  }
  if (res.status === 429) {
    return { ok: false, code: "rate_limited", reason: "Tradier rate limited (429)" };
  }
  if (res.status >= 500) {
    return { ok: false, code: "server_error", reason: `Tradier ${res.status}` };
  }
  if (!res.ok) {
    return { ok: false, code: "bad_response", reason: `Tradier ${res.status}` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    return { ok: false, code: "bad_response", reason: `Tradier JSON parse: ${String(e)}` };
  }
  return { ok: true, data: body as T };
}

// ---------------------------------------------------------------------------
// Quotes (underlying)
// ---------------------------------------------------------------------------

export type TradierQuote = {
  symbol: string;
  description?: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  volume?: number | null;
};

export async function getQuotes(
  mode: BotMode,
  symbols: string[],
): Promise<TradierResult<TradierQuote[]>> {
  if (symbols.length === 0) return { ok: true, data: [] };
  const result = await tradierGet<{
    quotes: { quote: TradierQuote | TradierQuote[] | null } | null;
  }>(mode, "data", "/markets/quotes", { symbols: symbols.join(","), greeks: "false" });
  if (!result.ok) return result;
  const q = result.data.quotes?.quote;
  if (q == null) return { ok: true, data: [] };
  return { ok: true, data: Array.isArray(q) ? q : [q] };
}

// ---------------------------------------------------------------------------
// Option quote (single contract by OCC symbol)
// ---------------------------------------------------------------------------

export type TradierOptionQuote = {
  symbol: string;          // OCC, e.g. "TSLA260513P00437500"
  last: number | null;
  bid: number | null;
  ask: number | null;
  bidsize?: number | null;
  asksize?: number | null;
  volume?: number | null;
  open_interest?: number | null;
  underlying?: string;
  strike?: number;
  option_type?: "call" | "put";
  expiration_date?: string; // YYYY-MM-DD
};

/**
 * Pull a single option contract's quote by OCC symbol. Used by the live-mid
 * re-check before promoting `signal_armed → signal_fired`. We ask for
 * greeks=false because we only need bid/ask/last; greeks come into play in
 * later phases.
 */
export async function getOptionQuote(
  mode: BotMode,
  occSymbol: string,
): Promise<TradierResult<TradierOptionQuote | null>> {
  const result = await tradierGet<{
    quotes: { quote: TradierOptionQuote | TradierOptionQuote[] | null } | null;
  }>(mode, "data", "/markets/quotes", { symbols: occSymbol, greeks: "false" });
  if (!result.ok) return result;
  const q = result.data.quotes?.quote;
  if (q == null) return { ok: true, data: null };
  return { ok: true, data: Array.isArray(q) ? q[0] ?? null : q };
}

// ---------------------------------------------------------------------------
// Option chain
// ---------------------------------------------------------------------------

export type TradierChainOption = {
  symbol: string; // OCC
  strike: number;
  option_type: "call" | "put";
  expiration_date: string; // YYYY-MM-DD
  bid: number | null;
  ask: number | null;
  last: number | null;
  volume?: number | null;
  open_interest?: number | null;
};

/**
 * GET /markets/options/chains for a given underlying + expiration. Returns
 * all calls + puts for that expiry. Greeks=false by default — strike
 * selection doesn't need them and they're expensive.
 */
export async function getOptionChain(
  mode: BotMode,
  args: { symbol: string; expiration: string },
): Promise<TradierResult<TradierChainOption[]>> {
  const result = await tradierGet<{
    options: { option: TradierChainOption | TradierChainOption[] | null } | null;
  }>(mode, "data", "/markets/options/chains", {
    symbol: args.symbol.toUpperCase(),
    expiration: args.expiration,
    greeks: "false",
  });
  if (!result.ok) return result;
  const o = result.data.options?.option;
  if (o == null) return { ok: true, data: [] };
  return { ok: true, data: Array.isArray(o) ? o : [o] };
}

// ---------------------------------------------------------------------------
// Time & sales (intraday bars)
// ---------------------------------------------------------------------------

export type TradierBar = {
  time?: string; // "YYYY-MM-DD HH:MM" ET
  timestamp?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
};

export type BarInterval = "1min" | "5min" | "15min";

/**
 * Pull intraday bars between `startEt` and `endEt` (Tradier wants
 * "YYYY-MM-DD HH:MM" in America/New_York for both bounds).
 * `sessionFilter: "open"` restricts to regular trading hours.
 */
export async function getTimesales(
  mode: BotMode,
  args: {
    symbol: string;
    interval: BarInterval;
    startEt: string;
    endEt: string;
    sessionFilter?: "all" | "open";
  },
): Promise<TradierResult<TradierBar[]>> {
  const result = await tradierGet<{
    series: { data: TradierBar | TradierBar[] | null } | null;
  }>(mode, "data", "/markets/timesales", {
    symbol: args.symbol,
    interval: args.interval,
    start: args.startEt,
    end: args.endEt,
    session_filter: args.sessionFilter ?? "open",
  });
  if (!result.ok) return result;
  const d = result.data.series?.data;
  if (d == null) return { ok: true, data: [] };
  return { ok: true, data: Array.isArray(d) ? d : [d] };
}

// ---------------------------------------------------------------------------
// Orders — POST + GET on /accounts/{id}/orders
// ---------------------------------------------------------------------------

export type TradierOrderSide =
  | "buy_to_open"
  | "sell_to_open"
  | "buy_to_close"
  | "sell_to_close";

// Equity orders use a different side set than options. Phase 1 only ships
// `buy` and `sell` (long-only); `sell_short` / `buy_to_cover` arrive in Phase 3.
export type TradierEquitySide = "buy" | "sell" | "sell_short" | "buy_to_cover";

export type TradierOrderType = "market" | "limit" | "stop" | "stop_limit";

export type TradierOrderDuration = "day" | "gtc" | "pre" | "post";

export type SubmitOrderArgs =
  | {
      instrument: "option";
      /** Underlying ticker, e.g. "TSLA". */
      underlying: string;
      /** OCC option symbol, e.g. "TSLA260513P00437500". */
      optionSymbol: string;
      side: TradierOrderSide;
      quantity: number;
      type: TradierOrderType;
      /** Required for limit / stop_limit. */
      price?: number;
      /** Required for stop / stop_limit. */
      stop?: number;
      duration: TradierOrderDuration;
    }
  | {
      instrument: "stock";
      /** Underlying ticker = the order symbol for equity orders. */
      underlying: string;
      side: TradierEquitySide;
      quantity: number;
      type: TradierOrderType;
      price?: number;
      stop?: number;
      duration: TradierOrderDuration;
    };

/**
 * POST /v1/accounts/{id}/orders with class=option.
 *
 * Tradier requires `application/x-www-form-urlencoded` for order submission;
 * JSON is rejected. We build the body explicitly and surface every error path
 * as `TradierResult` so the OMS can log + recover.
 */
export async function submitOrder(
  mode: BotMode,
  args: SubmitOrderArgs,
): Promise<TradierResult<{ id: number | string; status: string; partner_id?: string }>> {
  const env = orderEnvFromMode(mode);
  if (!env) {
    return { ok: false, code: "mode_off", reason: `bot mode is "${mode}", refusing order submit` };
  }
  const token = tokenFor(env);
  if (!token) {
    return {
      ok: false,
      code: "no_token",
      reason:
        env === "sandbox"
          ? "TRADIER_SANDBOX_TOKEN env var is not set"
          : "TRADIER_LIVE_TOKEN / TRADIER_API_KEY env var is not set",
    };
  }
  const accountId = getAccountId(mode);
  if (!accountId) {
    return {
      ok: false,
      code: "no_token",
      reason:
        env === "sandbox"
          ? "TRADIER_SANDBOX_ACCOUNT_ID env var is not set"
          : "TRADIER_LIVE_ACCOUNT_ID env var is not set",
    };
  }

  const body =
    args.instrument === "stock"
      ? new URLSearchParams({
          class: "equity",
          symbol: args.underlying.toUpperCase(),
          side: args.side,
          quantity: String(args.quantity),
          type: args.type,
          duration: args.duration,
        })
      : new URLSearchParams({
          class: "option",
          symbol: args.underlying.toUpperCase(),
          option_symbol: args.optionSymbol,
          side: args.side,
          quantity: String(args.quantity),
          type: args.type,
          duration: args.duration,
        });
  if (args.price != null) body.set("price", args.price.toFixed(2));
  if (args.stop != null) body.set("stop", args.stop.toFixed(2));

  const url = `${baseFor(env)}/accounts/${encodeURIComponent(accountId)}/orders`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return { ok: false, code: "network", reason: `fetch failed: ${String(e)}` };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, code: "auth", reason: `Tradier auth failed (${res.status})` };
  }
  if (res.status === 429) {
    return { ok: false, code: "rate_limited", reason: "Tradier rate limited (429)" };
  }
  if (res.status >= 500) {
    return { ok: false, code: "server_error", reason: `Tradier ${res.status}` };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    return { ok: false, code: "bad_response", reason: `Tradier JSON parse: ${String(e)}` };
  }
  // Tradier returns 200 even on logical errors; the body shape is the truth.
  const parsed = json as { order?: { id: number; status: string; partner_id?: string }; errors?: { error: string | string[] } };
  if (parsed.errors) {
    const errs = Array.isArray(parsed.errors.error) ? parsed.errors.error.join("; ") : parsed.errors.error;
    return { ok: false, code: "bad_response", reason: `Tradier rejected order: ${errs}` };
  }
  if (!parsed.order || parsed.order.id == null) {
    return { ok: false, code: "bad_response", reason: `Tradier returned no order id (${res.status})` };
  }
  return { ok: true, data: parsed.order };
}

export type TradierOrderStatus = {
  id: number | string;
  status:
    | "open"
    | "partially_filled"
    | "filled"
    | "expired"
    | "canceled"
    | "rejected"
    | "pending"
    | "error"
    | string;
  side: string;
  quantity: number;
  exec_quantity?: number;
  avg_fill_price?: number;
  last_fill_price?: number;
  last_fill_quantity?: number;
  remaining_quantity?: number;
  create_date?: string;
  transaction_date?: string;
  type: string;
  /** "equity" | "option" | "multileg" | ... — useful for stock vs option matching. */
  class?: string;
  /** Top-level symbol — underlying for option orders, ticker for equity orders. */
  symbol?: string;
  option_symbol?: string;
  underlying?: string;
  price?: number;
  reason_description?: string;
};

/**
 * DELETE /v1/accounts/{id}/orders/{id}. Cancels an open Tradier order
 * (entry or exit) before it fills. Used by force-exit to cancel working
 * entries — a buy_to_open limit waiting in the book is a future open
 * position we don't want to inherit.
 */
export async function cancelOrder(
  mode: BotMode,
  orderId: string | number,
): Promise<TradierResult<{ id: number | string; status: string }>> {
  const env = orderEnvFromMode(mode);
  if (!env) {
    return { ok: false, code: "mode_off", reason: `bot mode is "${mode}", refusing cancel` };
  }
  const token = tokenFor(env);
  if (!token) {
    return { ok: false, code: "no_token", reason: `${env} token not configured` };
  }
  const accountId = getAccountId(mode);
  if (!accountId) {
    return { ok: false, code: "no_token", reason: `account id not configured for ${env}` };
  }
  const url = `${baseFor(env)}/accounts/${encodeURIComponent(accountId)}/orders/${encodeURIComponent(String(orderId))}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return { ok: false, code: "network", reason: `fetch failed: ${String(e)}` };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, code: "auth", reason: `Tradier auth failed (${res.status})` };
  }
  if (res.status >= 500) {
    return { ok: false, code: "server_error", reason: `Tradier ${res.status}` };
  }
  // 200 even on logical errors; check body.
  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    return { ok: false, code: "bad_response", reason: `Tradier JSON parse: ${String(e)}` };
  }
  const parsed = body as { order?: { id: number; status: string }; errors?: { error: string | string[] } };
  if (parsed.errors) {
    const errs = Array.isArray(parsed.errors.error) ? parsed.errors.error.join("; ") : parsed.errors.error;
    return { ok: false, code: "bad_response", reason: `Tradier cancel rejected: ${errs}` };
  }
  if (!parsed.order || parsed.order.id == null) {
    return { ok: false, code: "bad_response", reason: `Tradier returned no order` };
  }
  return { ok: true, data: parsed.order };
}

/**
 * GET /v1/accounts/{id}/orders — every order Tradier has on file for the
 * account, including filled, cancelled, and working. Used by the broker-side
 * reconciliation job to detect orphan orders (orders at Tradier we don't
 * have in our DB) and to recover stuck `submitting` rows.
 *
 * Tradier returns `{ orders: { order: [...] } }` or `{ orders: "null" }`
 * (literal string) when empty. We normalize to a plain array.
 */
export async function getAccountOrders(
  mode: BotMode,
): Promise<TradierResult<TradierOrderStatus[]>> {
  const env = orderEnvFromMode(mode);
  if (!env) {
    return { ok: false, code: "mode_off", reason: `bot mode is "${mode}"` };
  }
  const accountId = getAccountId(mode);
  if (!accountId) {
    return { ok: false, code: "no_token", reason: `account id env var not set for ${env}` };
  }
  const result = await tradierGet<{
    orders: { order: TradierOrderStatus | TradierOrderStatus[] } | string | null;
  }>(mode, "order", `/accounts/${encodeURIComponent(accountId)}/orders`, {});
  if (!result.ok) return result;
  const o = typeof result.data.orders === "object" ? result.data.orders?.order : null;
  if (!o || typeof o === "string") return { ok: true, data: [] };
  return { ok: true, data: Array.isArray(o) ? o : [o] };
}

export async function getOrderStatus(
  mode: BotMode,
  orderId: string | number,
): Promise<TradierResult<TradierOrderStatus | null>> {
  const env = orderEnvFromMode(mode);
  if (!env) {
    return { ok: false, code: "mode_off", reason: `bot mode is "${mode}"` };
  }
  const accountId = getAccountId(mode);
  if (!accountId) {
    return { ok: false, code: "no_token", reason: `account id env var not set for ${env}` };
  }
  const result = await tradierGet<{ order: TradierOrderStatus | null }>(
    mode,
    "order",
    `/accounts/${encodeURIComponent(accountId)}/orders/${encodeURIComponent(String(orderId))}`,
    {},
  );
  if (!result.ok) return result;
  return { ok: true, data: result.data.order ?? null };
}

// ---------------------------------------------------------------------------
// Account — balances, positions, realized gain/loss
// ---------------------------------------------------------------------------

export type TradierBalances = {
  account_number: string;
  total_equity: number;
  total_cash: number;
  market_value: number;
  open_pl: number;       // unrealized P&L on open positions
  close_pl: number;      // realized P&L for the day
  equity: number;        // = total_equity for cash accounts
  long_market_value?: number;
  short_market_value?: number;
  account_type?: string; // "cash" | "margin" | "pdt"
  // Tradier returns ONE of these sub-objects depending on account_type.
  // Field names match Tradier's JSON exactly so the response can be cast in.
  margin?: {
    fed_call?: number;
    maintenance_call?: number;
    option_buying_power?: number;
    stock_buying_power?: number;
    day_trade_buying_power?: number;
    sweep?: number;
  };
  cash?: {
    cash_available?: number;
    sweep?: number;
    unsettled_funds?: number;
  };
  pdt?: {
    fed_call?: number;
    maintenance_call?: number;
    option_buying_power?: number;
    stock_buying_power?: number;
    day_trade_buying_power?: number;
    sweep?: number;
  };
};

/**
 * Pull the right stock-buying-power figure based on account_type. Returns 0
 * when no balances are available so the caller can safely block the order.
 */
export function stockBuyingPowerOf(bal: TradierBalances | null): number {
  if (!bal) return 0;
  // Margin and PDT accounts both expose `stock_buying_power`. Cash accounts
  // only have settled cash; treat that as the buying-power equivalent.
  const fromMargin = bal.margin?.stock_buying_power ?? bal.pdt?.stock_buying_power;
  if (typeof fromMargin === "number" && fromMargin > 0) return fromMargin;
  const fromCash = bal.cash?.cash_available;
  if (typeof fromCash === "number" && fromCash > 0) return fromCash;
  return 0;
}

export async function getBalances(
  mode: BotMode,
): Promise<TradierResult<TradierBalances | null>> {
  const env = orderEnvFromMode(mode);
  if (!env) {
    return { ok: false, code: "mode_off", reason: `bot mode is "${mode}"` };
  }
  const accountId = getAccountId(mode);
  if (!accountId) {
    return { ok: false, code: "no_token", reason: `account id env var not set for ${env}` };
  }
  const result = await tradierGet<{ balances: TradierBalances | null }>(
    mode,
    "order",
    `/accounts/${encodeURIComponent(accountId)}/balances`,
    {},
  );
  if (!result.ok) return result;
  return { ok: true, data: result.data.balances ?? null };
}

export type TradierPosition = {
  symbol: string;        // OCC for options, ticker for stocks
  quantity: number;      // long = positive, short = negative
  cost_basis: number;    // total $, e.g. 215.00 for 1 contract @ $2.15
  date_acquired: string; // ISO timestamp
};

export async function getPositions(
  mode: BotMode,
): Promise<TradierResult<TradierPosition[]>> {
  const env = orderEnvFromMode(mode);
  if (!env) {
    return { ok: false, code: "mode_off", reason: `bot mode is "${mode}"` };
  }
  const accountId = getAccountId(mode);
  if (!accountId) {
    return { ok: false, code: "no_token", reason: `account id env var not set for ${env}` };
  }
  const result = await tradierGet<{
    positions: { position: TradierPosition | TradierPosition[] } | string | null;
  }>(mode, "order", `/accounts/${encodeURIComponent(accountId)}/positions`, {});
  if (!result.ok) return result;
  // Tradier returns the literal string "null" (as JSON) when there are no positions.
  const p = typeof result.data.positions === "object" ? result.data.positions?.position : null;
  if (!p) return { ok: true, data: [] };
  return { ok: true, data: Array.isArray(p) ? p : [p] };
}

export type TradierClosedPosition = {
  close_date: string;     // ISO
  open_date: string;
  symbol: string;         // OCC for options
  quantity: number;
  cost: number;
  proceeds: number;
  gain_loss: number;      // signed dollars
  gain_loss_percent: number;
  term: number;           // days held
};

/**
 * GET /v1/accounts/{id}/gainloss — realized P&L for closed positions.
 * Used to compute "today's realized P&L per trade".
 */
export async function getGainLoss(
  mode: BotMode,
  args: { start: string; end: string } = { start: todayIso(), end: todayIso() },
): Promise<TradierResult<TradierClosedPosition[]>> {
  const env = orderEnvFromMode(mode);
  if (!env) {
    return { ok: false, code: "mode_off", reason: `bot mode is "${mode}"` };
  }
  const accountId = getAccountId(mode);
  if (!accountId) {
    return { ok: false, code: "no_token", reason: `account id env var not set for ${env}` };
  }
  const result = await tradierGet<{
    gainloss: { closed_position: TradierClosedPosition | TradierClosedPosition[] } | string | null;
  }>(mode, "order", `/accounts/${encodeURIComponent(accountId)}/gainloss`, {
    start: args.start,
    end: args.end,
    limit: "1000",
    sortBy: "closeDate",
    sort: "desc",
  });
  if (!result.ok) return result;
  const g = typeof result.data.gainloss === "object" ? result.data.gainloss?.closed_position : null;
  if (!g) return { ok: true, data: [] };
  return { ok: true, data: Array.isArray(g) ? g : [g] };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Diagnostics — admin UI surfaces "creds set?" without exposing the token.
// ---------------------------------------------------------------------------

export type CredsStatus = {
  sandboxToken: boolean;
  sandboxAccount: boolean;
  liveToken: boolean;
  liveAccount: boolean;
  /** Last 4 chars of each account id, when present — for visual confirmation. */
  sandboxAccountMasked: string | null;
  liveAccountMasked: string | null;
  /**
   * What mode=paper will actually use for market data. When the live token
   * is configured we route paper-mode data calls to production (real-time);
   * otherwise we fall back to sandbox (15-min delayed). Order submissions
   * stay sandbox-only for paper regardless.
   */
  paperDataSource: "live_realtime" | "sandbox_delayed";
  /** Whether BOTWICK_CRON_TOKEN is set; required for the cron tick endpoint. */
  cronTokenSet: boolean;
};

function mask(id: string | undefined): string | null {
  if (!id) return null;
  return id.length <= 4 ? `••${id.slice(-2)}` : `••${id.slice(-4)}`;
}

export function getCredsStatus(): CredsStatus {
  const sa = process.env.TRADIER_SANDBOX_ACCOUNT_ID;
  const la = process.env.TRADIER_LIVE_ACCOUNT_ID;
  const liveTokenSet = !!(process.env.TRADIER_LIVE_TOKEN ?? process.env.TRADIER_API_KEY);
  return {
    sandboxToken: !!process.env.TRADIER_SANDBOX_TOKEN,
    sandboxAccount: !!sa,
    liveToken: liveTokenSet,
    liveAccount: !!la,
    sandboxAccountMasked: mask(sa),
    liveAccountMasked: mask(la),
    paperDataSource: liveTokenSet ? "live_realtime" : "sandbox_delayed",
    cronTokenSet: !!process.env.BOTWICK_CRON_TOKEN,
  };
}

/**
 * Resolve the account ID the OMS should target based on the bot's current
 * mode. Used by Phase 4 order placement. Returns null when not set.
 */
export function getAccountId(mode: BotMode): string | null {
  if (mode === "paper") return process.env.TRADIER_SANDBOX_ACCOUNT_ID ?? null;
  if (mode === "live") return process.env.TRADIER_LIVE_ACCOUNT_ID ?? null;
  return null;
}
