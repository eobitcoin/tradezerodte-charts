import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireEarningsCronBearer } from "@/lib/bearer";
import { db } from "@/lib/db";
import { earningsScans } from "@/lib/db/schema";
import { fetchUpcomingEarnings } from "@/lib/finnhub";
import { runEarningsScan } from "@/lib/earnings-scans";

/**
 * POST /api/cron/earnings-scan
 *
 * Weekly cron: pulls the upcoming earnings calendar for the next 7
 * days, walks each ticker, computes historical EE stats + current
 * ATM IV + implied move, scores each of the four strategies, and
 * UPSERTs the scan row keyed by Monday of the scan week.
 *
 * Auth: `Authorization: Bearer ${EARNINGS_CRON_TOKEN}`.
 *
 * Schedule: Sunday evening so it's ready for Monday open. Crontab
 * `0 22 * * 0` (Sunday 22:00 UTC = 5/6 PM ET).
 *
 * Idempotency: UPSERTs on scan_week. Safe to re-run.
 *
 * Universe: all US-listed companies reporting in the next 7 days,
 * filtered by total chain OI ≥ 5,000 (drops illiquid names where
 * the option strategies wouldn't fill cleanly anyway).
 *
 * Returns:
 *   200 { ok, scanWeek, universeSize, computedSize, topByStraddle, topByCondor, errors[] }
 */
export async function POST(req: Request) {
  const auth = requireEarningsCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  // Compute the scan window — Monday of the UPCOMING work week through
  // Friday. The cron runs Sunday evening; we want next week's calendar,
  // not the week that just ended.
  //
  //   Sunday   (0) → Monday is +1
  //   Saturday (6) → Monday is +2
  //   Mon-Fri (1-5) → back to that week's Monday (0, -1, -2, -3, -4)
  const today = new Date();
  const day = today.getUTCDay(); // 0 = Sunday
  const daysToMonday =
    day === 0 ? 1 : day === 6 ? 2 : -(day - 1);
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() + daysToMonday);
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  const fromIso = monday.toISOString().slice(0, 10);
  const toIso = friday.toISOString().slice(0, 10);

  let events;
  try {
    events = await fetchUpcomingEarnings({ from: fromIso, to: toIso });
  } catch (err) {
    return NextResponse.json(
      { error: `Finnhub: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  // Dedup by symbol (Finnhub occasionally double-lists).
  const seen = new Set<string>();
  const unique = events.filter((e) => {
    if (seen.has(e.symbol)) return false;
    seen.add(e.symbol);
    return true;
  });

  const tickers = await runEarningsScan(unique, { perEventDelayMs: 600 });

  // Sort by best-of-any strategy descending for a useful default order.
  tickers.sort((a, b) => {
    const aMax = Math.max(
      a.strategies.rush.score,
      a.strategies.condor.score,
      a.strategies.straddle.score,
      a.strategies.breakout.score,
    );
    const bMax = Math.max(
      b.strategies.rush.score,
      b.strategies.condor.score,
      b.strategies.straddle.score,
      b.strategies.breakout.score,
    );
    return bMax - aMax;
  });

  await db
    .insert(earningsScans)
    .values({
      scanWeek: fromIso,
      universeSize: unique.length,
      computedSize: tickers.length,
      data: { coveredFrom: fromIso, coveredTo: toIso, tickers },
      meta: {},
      runAt: new Date(),
    })
    .onConflictDoUpdate({
      target: earningsScans.scanWeek,
      set: {
        universeSize: unique.length,
        computedSize: tickers.length,
        data: { coveredFrom: fromIso, coveredTo: toIso, tickers },
        runAt: new Date(),
        updatedAt: sql`now()`,
      },
    });

  // Headline previews for the cron response.
  const topByStraddle = [...tickers]
    .sort((a, b) => b.strategies.straddle.score - a.strategies.straddle.score)
    .slice(0, 5)
    .map((t) => `${t.symbol} (${t.strategies.straddle.score})`);
  const topByCondor = [...tickers]
    .sort((a, b) => b.strategies.condor.score - a.strategies.condor.score)
    .slice(0, 5)
    .map((t) => `${t.symbol} (${t.strategies.condor.score})`);

  return NextResponse.json({
    ok: true,
    scanWeek: fromIso,
    coveredTo: toIso,
    universeSize: unique.length,
    computedSize: tickers.length,
    topByStraddle,
    topByCondor,
  });
}

export const GET = POST;

export const runtime = "nodejs";
// ~150 tickers × ~3-5s each (chain + bars + earnings history) ≈ 8-12 min
// max during heavy weeks. 10-min cap fits the typical case; tight weeks
// might need a chunked re-run.
export const maxDuration = 600;
