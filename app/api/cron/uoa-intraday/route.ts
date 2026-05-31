import { NextResponse } from "next/server";
import { requireUoaCronBearer } from "@/lib/bearer";
import { runUoaScan } from "@/lib/uoa";

/**
 * POST /api/cron/uoa-intraday
 *
 * Intraday Unusual Activity refresh. Re-runs the watchlist scan with
 * a narrow lookback (last 15 minutes) so newly-printed flow lands in
 * uoa_prints within minutes of hitting the tape. Drives the "Latest
 * intraday" banner on /research/unusual-activity.
 *
 * Same filter as the EOD scan (premium ≥ $50k, OI mult ≥ 3×, clear
 * aggressor). Same persistence (uoa_prints). Does NOT touch uoa_scans
 * — the EOD cron owns that summary row.
 *
 * Authentication: `Authorization: Bearer ${UOA_CRON_TOKEN}` (same token
 * as uoa-daily — both are scan-only, no destructive side effects).
 *
 * Schedule: every 5 minutes during RTH. Crontab `*\/5 13-21 * * 1-5`
 * (covers 9 AM – 5 PM ET across both EST and EDT). Outside RTH the
 * Polygon trades endpoint returns nothing, so the scan is effectively
 * a no-op even if the cron over-fires.
 *
 * Idempotency: the uoa_prints unique index on (contract, ts, size,
 * price) dedupes against the EOD pass + prior intraday ticks. Re-runs
 * never produce duplicate rows.
 *
 * Returns:
 *   200 { ok: true, scanDay, lookbackMinutes, printsWritten,
 *         printsSurviving, tickersWithPrints, errors }
 */
export async function POST(req: Request) {
  const auth = requireUoaCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  // 15-minute window — slight overlap with the 5-min cron interval is
  // intentional. A trade printed at minute :04 might land in Polygon's
  // tape by minute :07; the next cron at :05 wouldn't see it. Pulling
  // the last 15 min on every tick ensures nothing slips through, and
  // the unique-index dedup makes re-pulls cheap.
  //
  // Polygon expects nanoseconds; we compute it as ms × 1e6 (safe under
  // Number.MAX_SAFE_INTEGER until year ~2255, so plain Number arithmetic
  // is fine — no BigInt needed).
  const lookbackMinutes = 15;
  const tsGteNs = (Date.now() - lookbackMinutes * 60_000) * 1_000_000;

  const scan = await runUoaScan({
    tsGteNs,
    // Intraday is time-sensitive — shorter per-ticker pause so the
    // 25-ticker sweep finishes well inside the 5-min cron window.
    // Each ticker only fetches ~1-2 trades in a 15-min window, so the
    // total Polygon load is much lighter than the EOD scan.
    perTickerDelayMs: 200,
    topN: 25,
  });

  return NextResponse.json({
    ok: true,
    scanDay: scan.scanDay,
    lookbackMinutes,
    printsWritten: scan.printsWritten,
    printsSurviving: scan.printsSurviving,
    tickersWithPrints: scan.tickersWithPrints,
    errors: scan.errors,
  });
}

// Allow GET for cron services that can only issue GET.
export const GET = POST;

export const runtime = "nodejs";
// 5-min cron interval — cap runtime at 4 min so we never overlap with
// the next tick. 25 tickers × ~1.5s each = ~38s typically.
export const maxDuration = 240;
