import { NextResponse } from "next/server";
import { requireLeapCronBearer } from "@/lib/bearer";
import { markOpenLeapPicks } from "@/lib/leap-marks";

/**
 * POST /api/cron/leap-marks
 *
 * Daily mark cron for the Cheap LEAPs performance tracker. Walks
 * every leap_pick whose expiration is still in the future, fetches
 * its current contract snapshot from Polygon, and appends a row to
 * leap_pick_marks. The Performance section on /research/leaps reads
 * the latest mark per pick and computes P&L vs the entry premium
 * stored on the leap_picks row.
 *
 * Reuses LEAP_CRON_TOKEN (same scope — both endpoints only read/write
 * leap_* tables, so one token is sufficient).
 *
 * Schedule: weekdays 5 PM ET after market close. Crontab `0 22 * * 1-5`
 * (22:00 UTC = 5 PM ET winter / 6 PM ET summer).
 *
 * Returns:
 *   200 { ok: true, scanned, marked, skipped, failed, errors[] }
 */
export async function POST(req: Request) {
  const auth = requireLeapCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const result = await markOpenLeapPicks();
  return NextResponse.json({
    ok: true,
    ...result,
  });
}

export const GET = POST;

export const runtime = "nodejs";
// At steady state ~15-30 open picks × ~300ms each ≈ 9s. 2-min cap
// is way more than enough.
export const maxDuration = 120;
