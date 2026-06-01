import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireSellPutsCronBearer } from "@/lib/bearer";
import { db } from "@/lib/db";
import { sellPutScans } from "@/lib/db/schema";
import { runSellPutsScan } from "@/lib/sell-puts-scan";

/**
 * POST /api/cron/sell-puts-scan
 *
 * Weekly cron: walks the locked Sell Puts universe (~53 large/mega-cap
 * US equities + index ETFs), pulls each ticker's chain via Polygon,
 * picks the best short put in the 21–45 DTE window scored by
 * `P(profit) × (credit / close)`, and UPSERTs the scan row keyed by
 * the scan date (UTC).
 *
 * Auth: `Authorization: Bearer ${SELL_PUTS_CRON_TOKEN}`.
 *
 * Schedule: Sunday 23:00 UTC (6/7 PM ET), after the Earnings Scans run.
 *
 * Idempotency: UPSERTs on scan_day. Safe to re-run.
 *
 * Returns:
 *   200 { ok, scanDay, universeSize, computedSize, topPicks }
 */
export async function POST(req: Request) {
  const auth = requireSellPutsCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const today = new Date();
  const scanDay = today.toISOString().slice(0, 10);

  const result = await runSellPutsScan(scanDay, { perTickerDelayMs: 400 });

  await db
    .insert(sellPutScans)
    .values({
      scanDay,
      universeSize: result.universeSize,
      computedSize: result.computedSize,
      data: {
        scanDay,
        dteRange: { min: 21, max: 45 },
        picks: result.picks,
      },
      meta: {},
      runAt: new Date(),
    })
    .onConflictDoUpdate({
      target: sellPutScans.scanDay,
      set: {
        universeSize: result.universeSize,
        computedSize: result.computedSize,
        data: {
          scanDay,
          dteRange: { min: 21, max: 45 },
          picks: result.picks,
        },
        runAt: new Date(),
        updatedAt: sql`now()`,
      },
    });

  // Headline preview for the cron response — top 5 from the Balanced
  // tier (the wheel-strategy sweet spot).
  const topPicks = result.picks
    .filter((p) => p.expectedRoiScore != null && p.tier === "balanced")
    .slice(0, 5)
    .map(
      (p) =>
        `${p.symbol} ${p.strike}P ${p.expiration} ` +
        `(${p.probabilityOfProfit != null ? (p.probabilityOfProfit * 100).toFixed(0) : "?"}% PoP, ` +
        `+${p.creditToClosePct?.toFixed(2)}%)`,
    );

  return NextResponse.json({
    ok: true,
    scanDay,
    universeSize: result.universeSize,
    computedSize: result.computedSize,
    topPicks,
  });
}

export const GET = POST;

export const runtime = "nodejs";
// ~53 tickers × ~3-4s each (chain fetch + scoring) ≈ 3-4 min worst case.
// Plenty of headroom under the 10-min default.
export const maxDuration = 600;
