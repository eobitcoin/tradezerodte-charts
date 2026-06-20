import { NextResponse } from "next/server";
import { requireSectorFlowCronBearer } from "@/lib/bearer";
import { runSectorFlowScan } from "@/lib/sector-flow";

/**
 * POST /api/cron/sector-flow
 *
 * Pulls the just-closed 5-min window of stock trades + NBBO for the
 * 22-name sector + index + Mag 7 universe, classifies every print via
 * the same aggressor rule UOA uses, aggregates per ticker, and upserts
 * one row per (ticker, window_start) into sector_flow_bars.
 *
 * Schedule: every 5 minutes during RTH. Crontab `*\/5 13-21 * * 1-5`
 * (covers 9 AM – 5 PM ET across EST and EDT — Railway's cron minimum
 * is 5 min so this is the tightest cadence available). Outside RTH the
 * trades endpoint returns nothing and the scan writes no rows.
 *
 * Authentication: `Authorization: Bearer ${SECTOR_FLOW_CRON_TOKEN}`.
 *
 * Idempotency: the (ticker, window_start) unique index + upsert means
 * a missed tick gets backfilled on the next run if the same window
 * boundary is still in scope. Re-runs against the same window cleanly
 * overwrite the row with the freshest aggregate.
 *
 * The handler also runs a rolling-retention DELETE that prunes rows
 * older than 8 days, keeping the table at ~14k live rows (22 tickers
 * × ~78 RTH windows × 8 days).
 *
 * Returns: 200 { ok: true, windowStart, windowEnd, universeSize,
 *                written, errors }
 */
export async function POST(req: Request) {
  const auth = requireSectorFlowCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const scan = await runSectorFlowScan({});

  return NextResponse.json({
    ok: true,
    windowStart: new Date(scan.windowStartMs).toISOString(),
    windowEnd: new Date(scan.windowEndMs).toISOString(),
    universeSize: scan.universeSize,
    written: scan.written,
    errors: scan.errors,
  });
}

// Allow GET for cron services that can only issue GET.
export const GET = POST;

export const runtime = "nodejs";
// 5-min cron interval — cap runtime at ~270s so we have margin against
// a slow Polygon page. 22 tickers × ~5s (5-min window is heavier than
// 2-min) + 250ms spacing ≈ 110-130s typical.
export const maxDuration = 270;
