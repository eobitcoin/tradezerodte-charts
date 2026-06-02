import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireCalendarCronBearer } from "@/lib/bearer";
import { db } from "@/lib/db";
import { calendarScans } from "@/lib/db/schema";
import { runCalendarScan } from "@/lib/calendar-scan";

/**
 * POST /api/cron/calendar-scan
 *
 * Weekly cron: walks the locked large-cap universe and ranks long-
 * calendar spread opportunities (sell ~30 DTE front ATM call, buy
 * ~90 DTE back ATM call at same strike). UPSERTs into calendar_scans
 * keyed by scan_day.
 *
 * Auth: `Authorization: Bearer ${CALENDAR_CRON_TOKEN}`.
 * Schedule: Sunday 23:30 UTC (6:30/7:30 PM ET), after the Sell Puts
 *   cron at 23:00.
 *
 * Returns:
 *   200 { ok, scanDay, universeSize, computedSize, topPicks }
 */
export async function POST(req: Request) {
  const auth = requireCalendarCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const scanDay = new Date().toISOString().slice(0, 10);
  const result = await runCalendarScan(scanDay, { perTickerDelayMs: 400 });

  await db
    .insert(calendarScans)
    .values({
      scanDay,
      universeSize: result.universeSize,
      computedSize: result.computedSize,
      data: {
        scanDay,
        frontDteRange: { min: 20, max: 40 },
        backDteRange: { min: 60, max: 120 },
        picks: result.picks,
      },
      meta: {},
      runAt: new Date(),
    })
    .onConflictDoUpdate({
      target: calendarScans.scanDay,
      set: {
        universeSize: result.universeSize,
        computedSize: result.computedSize,
        data: {
          scanDay,
          frontDteRange: { min: 20, max: 40 },
          backDteRange: { min: 60, max: 120 },
          picks: result.picks,
        },
        runAt: new Date(),
        updatedAt: sql`now()`,
      },
    });

  const topPicks = result.picks
    .filter((p) => p.skipReason === "ok" && p.compositeScore != null)
    .slice(0, 5)
    .map(
      (p) =>
        `${p.symbol} ${p.strike}C ${p.frontExpiration}/${p.backExpiration} ` +
        `(score ${p.compositeScore}, IVR ${p.ivRank}%, TS ${p.termStructureRatio?.toFixed(2)})`,
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
// ~53 tickers × ~4s each (chain + earnings + IV rank query) ≈ 4-5 min.
// 10-min cap is comfortable headroom.
export const maxDuration = 600;
