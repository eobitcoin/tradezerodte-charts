/**
 * Radar configuration — watchlist + timeframe metadata used by both the
 * webhook validator and the /radar page.
 */

import type { RadarSignal, RadarTimeframe } from "./db/schema";

export const RADAR_TICKERS = [
  "SPY", "QQQ", "IWM",
  "AAPL", "AMD", "AMZN", "AVGO", "GOOGL", "HOOD", "IBM",
  "META", "MSTR", "MU", "NFLX", "NVDA", "PLTR", "SNDK", "TSLA",
] as const;

export type RadarTicker = (typeof RADAR_TICKERS)[number];

export function isRadarTicker(t: string): t is RadarTicker {
  return (RADAR_TICKERS as readonly string[]).includes(t);
}

/** Order shown in the table header. */
export const RADAR_TIMEFRAMES: readonly RadarTimeframe[] = ["4h", "1d", "1w"] as const;

export const TIMEFRAME_LABEL: Record<RadarTimeframe, string> = {
  "4h": "4H",
  "1d": "Daily",
  "1w": "Weekly",
};

/**
 * Normalize a TradingView ticker string before checking it against either
 * watchlist. Handles three common shapes the `{{ticker}}` placeholder
 * produces:
 *
 *   - Exchange-prefixed:    "BYBIT:ASTERUSDT"  → "ASTERUSDT"
 *   - Perpetual-suffixed:   "ASTERUSDT.P"      → "ASTERUSDT"
 *   - Both at once:         "BYBIT:ASTERUSDT.P" → "ASTERUSDT"
 *
 * Equities have the same exchange-prefix variant ("NASDAQ:TSLA" → "TSLA"),
 * so this is shared between the equity and crypto webhooks.
 */
export function normalizeTradingViewTicker(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let t = raw.trim().toUpperCase();
  // Strip stray curly braces. Common footgun: users wrap a hardcoded ticker
  // in `{{ASTERUSDT}}` thinking it's required syntax, when it's actually
  // TradingView template-variable syntax that doesn't apply to literals.
  // TV passes the unknown placeholder through verbatim, so we receive
  // braces in the value.
  t = t.replace(/[{}]/g, "");
  // Strip exchange prefix: anything before the first colon.
  const colonIdx = t.indexOf(":");
  if (colonIdx >= 0) t = t.slice(colonIdx + 1);
  // Strip TradingView's perpetual / continuous-futures suffixes.
  t = t.replace(/\.(P|PERP|PERPS|PS)$/, "");
  return t;
}

/** Normalize a free-form timeframe string from a TradingView alert payload. */
export function normalizeTimeframe(raw: unknown): RadarTimeframe | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  // TV's {{interval}} variable returns: "1", "5", "15", "60", "240", "1D", "1W", "1M", etc.
  // Plus any user-typed values.
  if (t === "4h" || t === "240" || t === "240m" || t === "4hr" || t === "h4") return "4h";
  if (t === "1d" || t === "d" || t === "1day" || t === "daily" || t === "day") return "1d";
  if (t === "1w" || t === "w" || t === "weekly" || t === "1week" || t === "week") return "1w";
  return null;
}

/** Normalize a free-form signal string. */
export function normalizeSignal(raw: unknown): RadarSignal | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (s === "buy" || s === "long" || s === "bull" || s === "bullish") return "buy";
  if (s === "sell" || s === "short" || s === "bear" || s === "bearish") return "sell";
  if (s === "neutral" || s === "flat" || s === "exit" || s === "close") return "neutral";
  return null;
}

export interface RadarCell {
  signal: RadarSignal | null;
  indicator: string | null;
  price: number | null;
  signalAt: Date | null;
  createdAt: Date | null;
}

/**
 * Generic row shape — works for either watchlist (equity Radar uses
 * RadarTicker, Crypto Radar uses CryptoTicker). The shared rendering
 * components below only ever read row.ticker as string.
 */
export type RadarRowOf<T extends string = string> = {
  ticker: T;
  cells: Record<RadarTimeframe, RadarCell>;
  /** True iff all three timeframes have the same non-neutral signal. */
  allAgree: "buy" | "sell" | null;
  /** Most recent signalAt across all three cells (for "last update" column). */
  latestAt: Date | null;
};

/** Backward-compat alias used by the equity Radar code paths. */
export type RadarRow = RadarRowOf<RadarTicker>;

export function buildRadarRow<T extends string>(
  ticker: T,
  cells: Record<RadarTimeframe, RadarCell>,
): RadarRowOf<T> {
  const signals = RADAR_TIMEFRAMES.map((tf) => cells[tf].signal);
  let allAgree: "buy" | "sell" | null = null;
  if (signals.every((s) => s === "buy")) allAgree = "buy";
  else if (signals.every((s) => s === "sell")) allAgree = "sell";

  let latestAt: Date | null = null;
  for (const tf of RADAR_TIMEFRAMES) {
    const t = cells[tf].signalAt ?? cells[tf].createdAt;
    if (t && (!latestAt || t > latestAt)) latestAt = t;
  }
  return { ticker, cells, allAgree, latestAt };
}

export function emptyCell(): RadarCell {
  return { signal: null, indicator: null, price: null, signalAt: null, createdAt: null };
}

/**
 * Live spot quote for the equity Radar's "Current Price" column.
 * Sourced from Tradier server-side at page render. The shape mirrors
 * `CryptoQuote` from lib/crypto.ts so RadarTable can render either.
 */
export interface EquityQuote {
  ticker: string;
  last: number | null;
  change_pct: number | null;
}

/**
 * Batched Tradier quote fetch for the radar watchlist. Server-only — calls
 * lib/tradier.ts which reads TRADIER_API_KEY. Failures degrade gracefully:
 * tickers without a returned quote get {last: null, change_pct: null}.
 */
export async function fetchEquityQuotes(tickers: readonly string[]): Promise<EquityQuote[]> {
  if (tickers.length === 0) return [];
  // Lazy import — keeps lib/radar.ts tree-shakeable from any client component
  // that incidentally imports the type-only exports above.
  const { getQuotes } = await import("./tradier");
  let raw: Awaited<ReturnType<typeof getQuotes>> = [];
  try {
    raw = await getQuotes([...tickers]);
  } catch {
    // Fall through with empty raw — every ticker will surface as null.
  }
  const bySym = new Map<string, (typeof raw)[number]>();
  for (const q of raw) bySym.set(q.symbol.toUpperCase(), q);
  return tickers.map((t) => {
    const q = bySym.get(t.toUpperCase());
    const last = typeof q?.last === "number" && Number.isFinite(q.last) ? q.last : null;
    const changePct =
      typeof q?.change_percentage === "number" && Number.isFinite(q.change_percentage)
        ? q.change_percentage
        : null;
    return { ticker: t, last, change_pct: changePct };
  });
}

export function emptyCells(): Record<RadarTimeframe, RadarCell> {
  return {
    "4h": emptyCell(),
    "1d": emptyCell(),
    "1w": emptyCell(),
  };
}

/** "12 min ago", "3h ago", "2 days ago", etc. */
export function relativeTime(d: Date | null | undefined, now: Date = new Date()): string {
  if (!d) return "—";
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} wk${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} mo ago`;
}
