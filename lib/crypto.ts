/**
 * Crypto Radar configuration — watchlist, exchange id mapping, and live
 * spot-price fetcher.
 *
 * Price source: OKX `/api/v5/market/ticker` (per ticker, fetched in parallel).
 * We originally used CoinGecko's `/simple/price` batch endpoint but their
 * free tier rate-limits cloud IPs and returns empty bodies from Railway's
 * egress, so prices stayed null in production. OKX has no such restriction,
 * returns the same data (last + 24h change + 24h volume), and is what
 * `fetchCryptoSpotPrice` (the radar webhook fallback) already uses.
 *
 * The CoinGecko id table is preserved below — it's still surfaced as a
 * `cgId` field on each quote for backwards compatibility, but no downstream
 * code reads it today.
 */

export const CRYPTO_TICKERS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ZECUSDT",
  "LINKUSDT", "AVAXUSDT", "SUIUSDT", "TAOUSDT", "NEARUSDT", "ASTERUSDT",
  "HYPEUSDT", "DOGEUSDT",
] as const;

export type CryptoTicker = (typeof CRYPTO_TICKERS)[number];

export function isCryptoTicker(t: string): t is CryptoTicker {
  return (CRYPTO_TICKERS as readonly string[]).includes(t);
}

/**
 * Map our exchange-style USDT pair → Coingecko coin id.
 * If a ticker is missing here, the Radar's "current price" column will show
 * "—" for it (signals still work, no UI breakage).
 */
export const COINGECKO_ID: Record<CryptoTicker, string> = {
  BTCUSDT: "bitcoin",
  ETHUSDT: "ethereum",
  SOLUSDT: "solana",
  BNBUSDT: "binancecoin",
  XRPUSDT: "ripple",
  ZECUSDT: "zcash",
  LINKUSDT: "chainlink",
  AVAXUSDT: "avalanche-2",
  SUIUSDT: "sui",
  TAOUSDT: "bittensor",
  NEARUSDT: "near",
  ASTERUSDT: "aster-2",   // verified: rank #54, not the defunct "aster-3"
  HYPEUSDT: "hyperliquid",
  DOGEUSDT: "dogecoin",
};

/** Display ticker — drops the USDT suffix for cleaner table cells. */
export function displayTicker(ticker: CryptoTicker): string {
  return ticker.replace(/USDT$/, "");
}

import {
  RADAR_TIMEFRAMES,
  TIMEFRAME_LABEL,
  type RadarCell,
  type RadarRowOf,
  emptyCell,
  emptyCells,
  buildRadarRow,
  relativeTime,
  normalizeSignal,
  normalizeTimeframe,
} from "./radar";

// Re-export the shared helpers so the crypto page/components can import from
// one module without reaching back into lib/radar.ts.
export {
  RADAR_TIMEFRAMES,
  TIMEFRAME_LABEL,
  emptyCell,
  emptyCells,
  buildRadarRow,
  relativeTime,
  normalizeSignal,
  normalizeTimeframe,
};
export type { RadarCell };
export type CryptoRadarRow = RadarRowOf<CryptoTicker>;

// ----------------------------------------------------------------------------
// Live current-price fetcher (Coingecko)
// ----------------------------------------------------------------------------

export interface CryptoQuote {
  ticker: CryptoTicker;
  cgId: string;
  usd: number | null;
  change24h: number | null;
  vol24h: number | null;
}


/**
 * Fetch live USD prices for all 12 watchlist tickers in one Coingecko call.
 * Returns one entry per ticker (null fields if Coingecko returned no data).
 *
 * Cached at the route handler level (Next.js fetch w/ revalidate) so the
 * /crypto page doesn't hammer Coingecko on every request.
 */
/**
 * Fetches a single ticker's current USD spot price. Used by the crypto-radar
 * webhook as a fallback when the TradingView alert doesn't include
 * `{{close}}` in its body — so every signal in the DB has a price captured
 * at signal-receipt time, not just the ones whose alerts were configured to
 * send price.
 *
 * Backed by OKX's spot-ticker endpoint (same provider we use for klines).
 * Tried CoinGecko first; their free tier rate-limits cloud IPs and returned
 * empty bodies from Railway egress. OKX has no rate limits and works fine.
 *
 * Returns `null` on any failure (unknown ticker, network error, OKX returns
 * non-zero code) — callers prefer null over blowing up the insert.
 */
export async function fetchCryptoSpotPrice(ticker: string): Promise<number | null> {
  const t = ticker.toUpperCase();
  if (!isCryptoTicker(t)) return null;
  const okxSym = toOkxSymbol(t);
  try {
    const res = await fetch(
      `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(okxSym)}`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
      },
    );
    if (!res.ok) {
      console.warn(`[crypto] OKX ticker fetch HTTP ${res.status} for ${okxSym}`);
      return null;
    }
    const data = (await res.json()) as {
      code?: string;
      msg?: string;
      data?: Array<{ last?: string }>;
    };
    if (data.code !== "0") {
      console.warn(`[crypto] OKX ticker code=${data.code} msg=${data.msg} for ${okxSym}`);
      return null;
    }
    const last = data.data?.[0]?.last;
    if (!last) return null;
    const px = Number(last);
    return Number.isFinite(px) ? px : null;
  } catch (err) {
    console.warn(`[crypto] OKX ticker exception for ${okxSym}:`, err);
    return null;
  }
}

/** Common shape returned by both OKX and MEXC fetch helpers. */
interface RawQuote {
  last: number | null;
  open24h: number | null;
  volUsd: number | null;
}

/** OKX per-ticker fetch. Returns null prices on miss (e.g. unlisted symbol). */
async function fetchFromOkx(ticker: CryptoTicker): Promise<RawQuote> {
  const okxSym = toOkxSymbol(ticker);
  try {
    const res = await fetch(
      `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(okxSym)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "oliviatrades-crypto-radar/1.0",
        },
        next: { revalidate: 60 },
      },
    );
    if (!res.ok) return { last: null, open24h: null, volUsd: null };
    const j = (await res.json()) as {
      code?: string;
      data?: Array<{ last?: string; open24h?: string; volCcy24h?: string }>;
    };
    if (j.code !== "0") return { last: null, open24h: null, volUsd: null };
    const row = j.data?.[0];
    const last = row?.last !== undefined ? Number(row.last) : NaN;
    const open24h = row?.open24h !== undefined ? Number(row.open24h) : NaN;
    const volCcy24h = row?.volCcy24h !== undefined ? Number(row.volCcy24h) : NaN;
    return {
      last: Number.isFinite(last) ? last : null,
      open24h: Number.isFinite(open24h) ? open24h : null,
      volUsd: Number.isFinite(volCcy24h) ? volCcy24h : null,
    };
  } catch {
    return { last: null, open24h: null, volUsd: null };
  }
}

/**
 * MEXC per-ticker fetch — used as a fallback when OKX doesn't list a symbol
 * (e.g. TAOUSDT). MEXC is Binance-compatible: tickers are concatenated
 * (`TAOUSDT`, no dash), and the response includes `lastPrice`, `openPrice`,
 * and `quoteVolume` (USDT-denominated 24h volume).
 */
async function fetchFromMexc(ticker: CryptoTicker): Promise<RawQuote> {
  try {
    const res = await fetch(
      `https://api.mexc.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(ticker)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "oliviatrades-crypto-radar/1.0",
        },
        next: { revalidate: 60 },
      },
    );
    if (!res.ok) return { last: null, open24h: null, volUsd: null };
    const j = (await res.json()) as {
      lastPrice?: string;
      openPrice?: string;
      quoteVolume?: string;
    };
    const last = j.lastPrice !== undefined ? Number(j.lastPrice) : NaN;
    const open = j.openPrice !== undefined ? Number(j.openPrice) : NaN;
    const vol = j.quoteVolume !== undefined ? Number(j.quoteVolume) : NaN;
    return {
      last: Number.isFinite(last) ? last : null,
      open24h: Number.isFinite(open) ? open : null,
      volUsd: Number.isFinite(vol) ? vol : null,
    };
  } catch {
    return { last: null, open24h: null, volUsd: null };
  }
}

/**
 * Fetch live USD prices for all watchlist tickers in parallel.
 *
 * Source: OKX first, MEXC as a fallback when OKX doesn't list a symbol
 * (e.g. TAOUSDT). Per-ticker errors are swallowed individually — a symbol
 * missing on both exchanges returns nulls rather than breaking the batch.
 * Cached 60s at the Next.js fetch layer so the page doesn't hammer either
 * endpoint.
 */
export async function fetchCryptoQuotes(): Promise<CryptoQuote[]> {
  return Promise.all(
    CRYPTO_TICKERS.map(async (ticker): Promise<CryptoQuote> => {
      let raw = await fetchFromOkx(ticker);
      if (raw.last === null) {
        raw = await fetchFromMexc(ticker);
      }
      const change24h =
        raw.last !== null && raw.open24h !== null && raw.open24h !== 0
          ? ((raw.last - raw.open24h) / raw.open24h) * 100
          : null;
      return {
        ticker,
        cgId: COINGECKO_ID[ticker],
        usd: raw.last,
        change24h,
        vol24h: raw.volUsd,
      };
    }),
  );
}

// ----------------------------------------------------------------------------
// Crypto klines for the Daily Research routine.
// Tried Binance first — HTTP 451 from Railway egress (geo-blocked). Switched
// to OKX public market API, which is globally accessible and similarly
// comprehensive. User-facing interval names match Binance (1m/4h/1d/1w/1M)
// and are translated to OKX's bar codes internally. Symbol translation:
// BTCUSDT → BTC-USDT (OKX uses a dash separator).
// Docs: https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-candlesticks
// ----------------------------------------------------------------------------

export interface CryptoBar {
  time: string;       // ISO 8601 UTC, e.g. "2026-05-08T00:00:00Z"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;     // base-asset volume (BTC for BTCUSDT)
}

/** User-facing interval values — match Binance/TradingView convention. */
export type CryptoInterval =
  | "1m" | "3m" | "5m" | "15m" | "30m"
  | "1h" | "2h" | "4h" | "6h" | "12h"
  | "1d" | "1w" | "1M";

/** Map our lowercase interval to OKX's `bar` query value. */
const OKX_BAR: Record<CryptoInterval, string> = {
  "1m": "1m",  "3m": "3m",  "5m": "5m",  "15m": "15m", "30m": "30m",
  "1h": "1H",  "2h": "2H",  "4h": "4H",  "6h": "6H",   "12h": "12H",
  "1d": "1D",  "1w": "1W",  "1M": "1M",
};

/** BTCUSDT → BTC-USDT (OKX symbol format). */
function toOkxSymbol(usdtPair: string): string {
  const s = usdtPair.toUpperCase();
  if (s.endsWith("USDT") && s.length > 4) return `${s.slice(0, -4)}-USDT`;
  return s;
}

/** Fetch klines from OKX spot. Symbol must be a USDT pair (e.g. "BTCUSDT"). */
export async function fetchCryptoKlines(
  symbol: string,
  interval: CryptoInterval,
  limit: number = 200,
): Promise<CryptoBar[]> {
  const sym = symbol.toUpperCase();
  const okxSym = toOkxSymbol(sym);
  const okxBar = OKX_BAR[interval];
  if (!okxBar) throw new Error(`Unsupported interval: ${interval}`);
  // OKX /candles returns up to 300 most-recent bars in one call.
  const lim = Math.min(Math.max(limit, 1), 300);
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(okxSym)}&bar=${okxBar}&limit=${lim}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 30 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OKX candles ${okxSym} ${okxBar} HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { code?: string; msg?: string; data?: unknown[] };
  if (json.code !== "0") {
    throw new Error(`OKX candles ${okxSym} ${okxBar} api error ${json.code}: ${json.msg || ""}`);
  }
  const raw = json.data ?? [];
  // Each row: [ts, open, high, low, close, volBase, volQuote, ...]; OKX returns
  // newest-first, so reverse for consistency with the rest of our codebase.
  const bars: CryptoBar[] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const tsMs = Number(r[0]);
    if (!Number.isFinite(tsMs)) continue;
    bars.push({
      time: new Date(tsMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    });
  }
  bars.reverse();
  return bars;
}

/** Format a USD price with sane decimals based on magnitude. */
export function fmtUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1000) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (value >= 10) return `$${value.toFixed(2)}`;
  if (value >= 1) return `$${value.toFixed(3)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}
