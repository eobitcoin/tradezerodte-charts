/**
 * TradingView webhook ingest for Radar signals.
 *
 *   POST /api/radar/signal/<RADAR_TOKEN>
 *
 * Path-token auth (TradingView's standard webhook can't add custom headers,
 * so URL-token is the practical choice). Same pattern as /api/mcp/[token].
 *
 * Body shape (any extra fields are stored in `raw` for debugging):
 *   {
 *     "ticker":     "TSLA",
 *     "timeframe":  "4h" | "1d" | "1w" | "240" | "1D" | "1W" | "daily" | "weekly" | ...,
 *     "signal":     "buy" | "sell" | "neutral" | "long" | "short" | "bullish" | "bearish",
 *     "indicator":  "MACD bullish cross",   // optional, free-form
 *     "price":      382.49,                  // optional
 *     "signal_at":  "2026-05-04T20:00:00Z"   // optional, ISO; defaults to now()
 *   }
 *
 * Returns 200 on success with `{ok: true, id}`. Logs raw body to `raw` column
 * regardless of validation outcome (helpful when debugging an alert template).
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { radarSignals } from "@/lib/db/schema";
import {
  isRadarTicker,
  normalizeSignal,
  normalizeTimeframe,
  normalizeTradingViewTicker,
} from "@/lib/radar";

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
  console.warn("[radar] bad_request:", message, "raw:", JSON.stringify(raw));
  return NextResponse.json({ error: "bad_request", message, raw }, { status: 400 });
}

function parsePrice(p: unknown): number | null {
  if (p == null) return null;
  if (typeof p === "number" && Number.isFinite(p)) return p;
  if (typeof p === "string") {
    const trimmed = p.replace(/[^0-9.\-]/g, "");
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
    // epoch seconds vs ms heuristic
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
  const expected = process.env.RADAR_TOKEN;
  if (!expected || token !== expected) return unauthorized();

  // Capture raw body even if downstream parsing fails — invaluable for
  // debugging TradingView alert templates.
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
  if (!isRadarTicker(tickerRaw)) {
    return badRequest(
      `ticker '${tickerRaw}' (from '${String(body.ticker)}') is not in the radar watchlist`,
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
  const price = parsePrice(body.price);
  const signalAt = parseTimestamp(body.signal_at) ?? new Date();

  const [row] = await db
    .insert(radarSignals)
    .values({
      ticker: tickerRaw,
      timeframe,
      signal,
      indicator,
      price: price != null ? String(price) : null,
      signalAt,
      raw: body as unknown as Record<string, unknown>,
    })
    .returning({ id: radarSignals.id });

  return NextResponse.json({ ok: true, id: row.id, ticker: tickerRaw, timeframe, signal });
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  // Friendly response if you paste the URL in a browser
  const { token } = await ctx.params;
  const expected = process.env.RADAR_TOKEN;
  if (!expected || token !== expected) return unauthorized();
  return NextResponse.json({
    ok: true,
    method: "POST",
    note: "POST a TradingView alert JSON body to this URL.",
  });
}
