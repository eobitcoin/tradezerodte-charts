/**
 * Tradier market-data client. Used by the MCP server's `fetch_options_snapshot`
 * tool to pull options chains (with greeks) and the underlying quote, then
 * compute max pain + GEX server-side.
 *
 * Endpoint: https://api.tradier.com/v1/markets
 * Auth: Bearer token (TRADIER_API_KEY env var)
 *
 * Tradier base URL: https://api.tradier.com (production) or https://sandbox.tradier.com (sandbox).
 * Override via TRADIER_BASE_URL env var if needed.
 */

const TRADIER_BASE = (process.env.TRADIER_BASE_URL || "https://api.tradier.com").replace(/\/$/, "");

function authHeaders(): Record<string, string> {
  const key = process.env.TRADIER_API_KEY;
  if (!key) throw new Error("TRADIER_API_KEY not configured");
  return {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
}

export interface TradierQuote {
  symbol: string;
  last: number;
  prevclose?: number;
  description?: string;
}

export interface TradierExpiration {
  date: string; // YYYY-MM-DD
}

export interface TradierGreeks {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
  smv_vol?: number;
  mid_iv?: number;
  bid_iv?: number;
  ask_iv?: number;
}

export interface TradierOption {
  symbol: string;
  description?: string;
  underlying: string;
  strike: number;
  option_type: "call" | "put";
  expiration_date: string; // YYYY-MM-DD
  open_interest?: number;
  volume?: number;
  bid?: number;
  ask?: number;
  last?: number;
  greeks?: TradierGreeks;
}

async function fetchJson(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${TRADIER_BASE}/v1/markets/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tradier ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Extended quote shape (Tradier returns more fields than we narrowly typed before).
export interface TradierQuoteFull extends TradierQuote {
  bid?: number;
  ask?: number;
  change?: number;
  change_percentage?: number;
  volume?: number;
  high?: number;
  low?: number;
  open?: number;
  trade_date?: number;
  bid_size?: number;
  ask_size?: number;
  greeks?: TradierGreeks;
  open_interest?: number;
  expiration_date?: string;
  strike?: number;
  option_type?: "call" | "put";
  underlying?: string;
  type?: string; // "stock" | "option" | "etf" | "index"
}

export async function getQuote(symbol: string): Promise<TradierQuoteFull | null> {
  const data = (await fetchJson("quotes", { symbols: symbol, greeks: "false" })) as {
    quotes?: { quote?: TradierQuoteFull | TradierQuoteFull[] };
  };
  const q = data?.quotes?.quote;
  if (!q) return null;
  return Array.isArray(q) ? q[0] ?? null : q;
}

export async function getQuotes(symbols: string[]): Promise<TradierQuoteFull[]> {
  if (symbols.length === 0) return [];
  const data = (await fetchJson("quotes", { symbols: symbols.join(","), greeks: "false" })) as {
    quotes?: { quote?: TradierQuoteFull | TradierQuoteFull[] };
  };
  const q = data?.quotes?.quote;
  if (!q) return [];
  return Array.isArray(q) ? q : [q];
}

/**
 * Fetch a single option contract by OCC symbol with greeks. The OCC symbol
 * encodes ticker + expiry + right + strike, e.g. SPY260430C00720000.
 */
export async function getOptionQuote(occSymbol: string): Promise<TradierQuoteFull | null> {
  const data = (await fetchJson("quotes", { symbols: occSymbol, greeks: "true" })) as {
    quotes?: { quote?: TradierQuoteFull | TradierQuoteFull[] };
  };
  const q = data?.quotes?.quote;
  if (!q) return null;
  return Array.isArray(q) ? q[0] ?? null : q;
}

/**
 * Construct an OCC-21 option symbol.
 *   ROOT (1-6 chars) + YYMMDD + C|P + STRIKE_8DIGITS (cents × 100, i.e. dollars × 1000)
 * Example: SPY 2026-04-30 720 C → SPY260430C00720000
 */
export function buildOccSymbol(params: {
  root: string;
  expiry: string; // YYYY-MM-DD
  right: "call" | "put";
  strike: number;
}): string {
  const { root, expiry, right, strike } = params;
  const [, yy, mm, dd] = expiry.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
  if (!yy || !mm || !dd) throw new Error(`bad expiry: ${expiry}`);
  const year2 = yy.slice(2);
  const cp = right === "call" ? "C" : "P";
  const strikeInt = Math.round(strike * 1000); // dollars * 1000
  const strikeStr = String(strikeInt).padStart(8, "0");
  return `${root.toUpperCase()}${year2}${mm}${dd}${cp}${strikeStr}`;
}

export interface TradierBar {
  date?: string; // YYYY-MM-DD — present on daily history bars
  time?: string; // YYYY-MM-DD HH:MM — present on intraday timesales bars
  timestamp?: number; // epoch seconds — also present on intraday
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number; // intraday only
}

/** Daily history. Tradier interval values: daily | weekly | monthly. */
export async function getDailyHistory(
  symbol: string,
  start: string,
  end: string,
): Promise<TradierBar[]> {
  const data = (await fetchJson("history", {
    symbol,
    interval: "daily",
    start,
    end,
  })) as { history?: { day?: TradierBar | TradierBar[] } };
  const days = data?.history?.day;
  if (!days) return [];
  return Array.isArray(days) ? days : [days];
}

/**
 * Intraday bars (timesales). interval: "tick" | "1min" | "5min" | "15min".
 * Returns bars with VWAP.
 */
export async function getIntradayBars(
  symbol: string,
  interval: "1min" | "5min" | "15min",
  start: string, // ISO datetime
  end: string,
): Promise<TradierBar[]> {
  const data = (await fetchJson("timesales", {
    symbol,
    interval,
    start,
    end,
    session_filter: "all",
  })) as { series?: { data?: TradierBar | TradierBar[] } };
  const bars = data?.series?.data;
  if (!bars) return [];
  return Array.isArray(bars) ? bars : [bars];
}

export async function getExpirations(symbol: string): Promise<string[]> {
  const data = (await fetchJson("options/expirations", {
    symbol,
    includeAllRoots: "true",
    strikes: "false",
  })) as { expirations?: { date?: string | string[] } };
  const dates = data?.expirations?.date;
  if (!dates) return [];
  return Array.isArray(dates) ? dates : [dates];
}

export async function getChain(symbol: string, expiration: string): Promise<TradierOption[]> {
  const data = (await fetchJson("options/chains", {
    symbol,
    expiration,
    greeks: "true",
  })) as { options?: { option?: TradierOption | TradierOption[] } };
  const opts = data?.options?.option;
  if (!opts) return [];
  return Array.isArray(opts) ? opts : [opts];
}

/**
 * Tradier symbol mapping — the indices don't use ^ prefix; some need different
 * roots than the canonical ticker.
 */
export function tradierSymbol(ticker: string): string {
  const t = ticker.toUpperCase();
  // Tradier uses "VIX" directly for the CBOE VIX index, "SPX" for S&P 500.
  // Verify against Tradier docs if a fetch fails.
  return t;
}
