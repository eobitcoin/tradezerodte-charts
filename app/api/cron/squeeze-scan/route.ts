import { NextResponse } from "next/server";
import { requireSqueezeCronBearer } from "@/lib/bearer";
import { runSqueezeScan, SQUEEZE_UNIVERSE } from "@/lib/squeeze";

/**
 * POST /api/cron/squeeze-scan
 *
 * Walks the curated ~150-name squeeze universe, pulls FINRA short interest
 * + Polygon ticker overview + 30-day price action for each, scores them
 * on the composite (SI%, DTC, momentum, IV rank) index, and persists the
 * top 25 to squeeze_scans (UPSERT on scan_day).
 *
 * Schedule: weekly Sunday afternoon. Crontab `30 18 * * 0` (Sunday 2:30 PM
 * ET in EDT, 1:30 PM ET in EST). FINRA SI updates twice a month; daily
 * cadence wouldn't add new signal, so weekly is the sweet spot.
 *
 * Authentication: `Authorization: Bearer ${SQUEEZE_CRON_TOKEN}`.
 *
 * Wall-clock: ~150 tickers × 4 polygon calls each + 250ms throttle ≈
 * 8-12 min. Each call is small (single-page).
 *
 * Returns: 200 { ok, scanDay, universeSize, rankedSize, topTickers, errors }
 */
export async function POST(req: Request) {
  const auth = requireSqueezeCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const scan = await runSqueezeScan({});

  return NextResponse.json({
    ok: true,
    scanDay: scan.scanDay,
    universeSize: scan.universeSize,
    rankedSize: scan.rankedSize,
    topTickers: scan.ranked.slice(0, 10).map((c) => ({
      ticker: c.ticker,
      composite: c.compositeScore,
      siPct: c.shortInterestPctSO,
      dtc: c.daysToCover,
    })),
    errors: scan.errors,
    universeKnown: SQUEEZE_UNIVERSE.length,
  });
}

// Allow GET for cron services that can only issue GET.
export const GET = POST;

export const runtime = "nodejs";
// Weekly cron — no overlap concern. 15-min cap absorbs slow Polygon pages.
export const maxDuration = 900;
