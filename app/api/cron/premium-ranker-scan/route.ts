import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requirePremiumRankerCronBearer } from "@/lib/bearer";
import { db } from "@/lib/db";
import { premiumRankerScans } from "@/lib/db/schema";
import {
  runPremiumRankerScan,
  MIN_PRICE,
  MIN_DAY_VOLUME,
  DTE_MIN,
  DTE_MAX,
} from "@/lib/premium-ranker-scan";

/**
 * POST /api/cron/premium-ranker-scan
 *
 * Weekly full-market high-IV / premium scan. Pulls the Polygon all-tickers
 * snapshot, filters to price >= $20 + daily volume > 500k, deep-scans each
 * survivor's near-30d chain for ATM IV + best short-put premium, ranks by
 * IV (and premium), and stores the top 120 rows + 3 headline trade ideas.
 *
 * Auth: `Authorization: Bearer ${PREMIUM_RANKER_CRON_TOKEN}`.
 * Schedule: Sunday ~23:30 UTC (after Sell Puts).
 * Idempotent: UPSERTs on scan_day.
 *
 * Returns: 200 { ok, scanDay, universeSize, computedSize, truncated,
 *                timing, topByIv }
 */
export async function POST(req: Request) {
  const auth = requirePremiumRankerCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const scanDay = new Date().toISOString().slice(0, 10);
  const result = await runPremiumRankerScan(scanDay);

  const data = {
    scanDay,
    filters: { minPrice: MIN_PRICE, minDayVolume: MIN_DAY_VOLUME, dteMin: DTE_MIN, dteMax: DTE_MAX },
    rows: result.rows,
    suggestions: result.suggestions,
  };
  const meta = { timing: result.timing, truncated: result.truncated };

  await db
    .insert(premiumRankerScans)
    .values({
      scanDay,
      universeSize: result.universeSize,
      computedSize: result.computedSize,
      data,
      meta,
      runAt: new Date(),
    })
    .onConflictDoUpdate({
      target: premiumRankerScans.scanDay,
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
    truncated: result.truncated,
    timing: result.timing,
    topByIv: result.rows.slice(0, 8).map((r) => ({
      symbol: r.symbol,
      iv: `${(r.atmIv * 100).toFixed(0)}%`,
      annualizedPut: r.bestPut?.annualizedReturnPct != null ? `${r.bestPut.annualizedReturnPct.toFixed(0)}%` : null,
    })),
  });
}

export const GET = POST;

export const runtime = "nodejs";
// Full-market funnel: 1 big snapshot call + ~2,500 single-page chain calls
// at concurrency 16 ≈ 2-5 min. Cap high to absorb a slow Polygon window.
export const maxDuration = 800;
