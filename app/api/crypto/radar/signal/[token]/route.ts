/**
 * TradingView webhook ingest for the Crypto Radar.
 *
 *   POST /api/crypto/radar/signal/<CRYPTO_RADAR_TOKEN>
 *
 * Same shape as the equity Radar webhook (/api/radar/signal/[token]) but with
 * a separate auth token (so it can be rotated independently) and writes to
 * crypto_radar_signals (separate table — different ticker universe).
 *
 * Body shape (extra fields stored in `raw` for debugging):
 *   {
 *     "ticker":     "BTCUSDT",
 *     "timeframe":  "4h" | "1d" | "1w" | "240" | "1D" | "1W" | "daily" | "weekly" | ...,
 *     "signal":     "buy" | "sell" | "neutral" | "long" | "short" | "bullish" | "bearish",
 *     "indicator":  "MACD bullish cross",
 *     "price":      80123.45,
 *     "signal_at":  "2026-05-04T20:00:00Z"
 *   }
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cryptoRadarSignals } from "@/lib/db/schema";
import { isCryptoTicker, fetchCryptoSpotPrice } from "@/lib/crypto";
import { normalizeSignal, normalizeTimeframe, normalizeTradingViewTicker } from "@/lib/radar";

export const runtime = "nodejs";

interface SignalBody {
  ticker?: unknown;
  timeframe?: unknown;
  signal?: unknown;
  indicator?: unknown;
  price?: unknown;
  signal_at?: unknown;
}

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
function badRequest(message: string, raw?: unknown) {
  // Log every rejection with the raw payload so we can debug TradingView
  // delivery failures from the Railway log stream without needing the
  // sender to open TV's alert log.
  console.warn("[crypto-radar] bad_request:", message, "raw:", JSON.stringify(raw));
  return NextResponse.json({ error: "bad_request", message, raw }, { status: 400 });
}

function parsePrice(p: unknown): number | null {
  if (p == null) return null;
  if (typeof p === "number" && Number.isFinite(p)) return p;
  if (typeof p === "string") {
    const trimmed = p.replace(/[^0-9.\-eE]/g, "");
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseTimestamp(t: unknown): Date | null {
  if (t == null) return null;
  if (t instanceof Date) return t;
  if (typeof t === "number") {
    const ms = t > 1e11 ? t : t * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof t === "string") {
    const trimmed = t.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const expected = process.env.CRYPTO_RADAR_TOKEN;
  if (!expected || token !== expected) return unauthorized();

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return badRequest("could not read request body");
  }

  let body: SignalBody;
  try {
    body = JSON.parse(bodyText) as SignalBody;
  } catch {
    return badRequest("body is not valid JSON", bodyText.slice(0, 500));
  }

  const tickerRaw = normalizeTradingViewTicker(body.ticker);
  if (!tickerRaw) return badRequest("ticker is required", body);
  if (!isCryptoTicker(tickerRaw)) {
    return badRequest(
      `ticker '${tickerRaw}' (from '${String(body.ticker)}') is not in the crypto radar watchlist`,
      body,
    );
  }

  const timeframe = normalizeTimeframe(body.timeframe);
  if (!timeframe) {
    return badRequest(
      `timeframe '${String(body.timeframe)}' could not be normalized to 4h/1d/1w`,
      body,
    );
  }

  const signal = normalizeSignal(body.signal);
  if (!signal) {
    return badRequest(
      `signal '${String(body.signal)}' could not be normalized to buy/sell/neutral`,
      body,
    );
  }

  const indicator =
    typeof body.indicator === "string" && body.indicator.trim()
      ? body.indicator.trim().slice(0, 200)
      : null;
  // Capture a price for every signal so the radar UI always has something to
  // display. First try the body (TradingView's `{{close}}`); if missing, hit
  // CoinGecko for a live spot at signal-receipt time. Failures resolve to
  // null — better to insert with a missing price than to drop the signal.
  let price = parsePrice(body.price);
  if (price == null) {
    price = await fetchCryptoSpotPrice(tickerRaw);
  }
  const signalAt = parseTimestamp(body.signal_at) ?? new Date();

  const [row] = await db
    .insert(cryptoRadarSignals)
    .values({
      ticker: tickerRaw,
      timeframe,
      signal,
      indicator,
      price: price != null ? String(price) : null,
      signalAt,
      raw: body as unknown as Record<string, unknown>,
    })
    .returning({ id: cryptoRadarSignals.id });

  return NextResponse.json({ ok: true, id: row.id, ticker: tickerRaw, timeframe, signal });
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const expected = process.env.CRYPTO_RADAR_TOKEN;
  if (!expected || token !== expected) return unauthorized();
  return NextResponse.json({
    ok: true,
    method: "POST",
    note: "POST a TradingView crypto alert JSON body to this URL.",
  });
}
