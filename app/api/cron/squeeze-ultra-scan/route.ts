import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireSqueezeUltraCronBearer } from "@/lib/bearer";
import { db } from "@/lib/db";
import { squeezeUltraScans } from "@/lib/db/schema";
import {
  runSqueezeUltraScan,
  MIN_PRICE,
  MIN_DAY_VOLUME,
  BARS_LOOKBACK_DAYS,
} from "@/lib/squeeze-ultra-scan";

/**
 * POST /api/cron/squeeze-ultra-scan
 *
 * Weekly full-market ST Squeeze Ultra scan. Pulls the Polygon all-tickers
 * snapshot, filters to price >= $20 + daily volume > 500k + optionable, then
 * for each survivor pulls ~420d of daily bars, runs the squeeze engine on
 * Daily + resampled Weekly, and keeps names in a squeeze on either timeframe.
 *
 * Auth: `Authorization: Bearer ${SQUEEZE_ULTRA_CRON_TOKEN}`.
 * Schedule: Sunday evening (UTC).
 * Idempotent: UPSERTs on scan_day.
 *
 * Returns: 200 { ok, scanDay, universeSize, computedSize, counts, truncated,
 *                timing, topRows }
 */
export async function POST(req: Request) {
  const auth = requireSqueezeUltraCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const scanDay = new Date().toISOString().slice(0, 10);
  const result = await runSqueezeUltraScan(scanDay);

  const data = {
    scanDay,
    filters: { minPrice: MIN_PRICE, minDayVolume: MIN_DAY_VOLUME, barsLookbackDays: BARS_LOOKBACK_DAYS },
    rows: result.rows,
    suggestions: result.suggestions,
    counts: result.counts,
  };
  const meta = { timing: result.timing, truncated: result.truncated };

  await db
    .insert(squeezeUltraScans)
    .values({
      scanDay,
      universeSize: result.universeSize,
      computedSize: result.computedSize,
      data,
      meta,
      runAt: new Date(),
    })
    .onConflictDoUpdate({
      target: squeezeUltraScans.scanDay,
      set: {
        universeSize: result.universeSize,
        computedSize: result.computedSize,
        data,
        meta,
        runAt: new Date(),
        updatedAt: sql`now()`,
      },
    });

  return NextResponse.json({
    ok: true,
    scanDay,
    universeSize: result.universeSize,
    computedSize: result.computedSize,
    counts: result.counts,
    truncated: result.truncated,
    timing: result.timing,
    topRows: result.rows.slice(0, 10).map((r) => ({
      symbol: r.symbol,
      price: r.price,
      daily: `${r.daily.label ?? "—"}${r.daily.ideal ? "/long-ideal" : r.daily.idealShort ? "/short-ideal" : ""}`,
      weekly: `${r.weekly.label ?? "—"}${r.weekly.ideal ? "/long-ideal" : r.weekly.idealShort ? "/short-ideal" : ""}`,
    })),
    suggestions: result.suggestions.map((s) => ({
      symbol: s.symbol,
      direction: s.aiAnalysis.direction,
      conviction: s.aiAnalysis.conviction,
      trade: s.optionTrade
        ? `${s.optionTrade.strategy} ${s.optionTrade.longStrike}/${s.optionTrade.shortStrike} ${s.optionTrade.expiration}`
        : null,
    })),
  });
}

export const GET = POST;

export const runtime = "nodejs";
// Full-market funnel: 1 snapshot call + ~2,500 single daily-bar calls at
// concurrency 16 ≈ 2-5 min. Cap high to absorb a slow Polygon window.
export const maxDuration = 800;
