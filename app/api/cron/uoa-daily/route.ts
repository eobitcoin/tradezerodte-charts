import { NextResponse } from "next/server";
import { requireUoaCronBearer } from "@/lib/bearer";
import { runUoaScan, publishDailyUoaSummary } from "@/lib/uoa";

/**
 * POST /api/cron/uoa-daily
 *
 * End-of-day Unusual Options Activity scanner. Walks the watchlist,
 * filters the day's tape for prints that cleared the unusual-activity
 * bar (premium > $50k, OI mult > 3×, clear aggressor), persists them
 * to uoa_prints, and UPSERTs the day's summary into uoa_scans.
 *
 * Authentication: `Authorization: Bearer ${UOA_CRON_TOKEN}`.
 *
 * Schedule: 21:15 UTC weekdays (= 4:15 PM ET winter / 5:15 PM ET summer,
 * 15 min after market close so the chain settles). Crontab `15 21 * * 1-5`.
 *
 * Idempotency: safe to re-run. The uoa_prints unique index dedupes by
 * (contract_ticker, print_ts, size, price) so intraday-cron writes
 * don't clash. The uoa_scans UPSERT just refreshes the summary.
 *
 * Returns:
 *   200 { ok: true, scanDay, universeSize, printsWritten, printsSurviving,
 *         tickersWithPrints, classificationCounts, errors }
 *   401/403/500 with { error } on auth failures
 */
export async function POST(req: Request) {
  const auth = requireUoaCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const scan = await runUoaScan({ perTickerDelayMs: 600, topN: 25 });
  const published = await publishDailyUoaSummary({
    scanDay: scan.scanDay,
    topN: 25,
  });

  return NextResponse.json({
    ok: true,
    scanDay: scan.scanDay,
    universeSize: scan.universeSize,
    printsWritten: scan.printsWritten,
    printsSurviving: scan.printsSurviving,
    tickersWithPrints: scan.tickersWithPrints,
    classificationCounts: published.classificationCounts,
    topCount: published.topPrints.length,
    errors: scan.errors,
  });
}

// Allow GET for cron services that can only issue GET.
export const GET = POST;

// Node runtime. The scan walks 25 tickers × up to 20 contracts each ×
// trades fetch — bounded to ~2-3 minutes with the 600ms per-ticker /
// 120ms per-contract throttle. 5-min cap is comfortable headroom.
export const runtime = "nodejs";
export const maxDuration = 300;
