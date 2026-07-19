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
 * ASYNC BY DESIGN: the scan walks each event sequentially with a 600ms
 * delay (Finnhub 60/min rate-limit pacing — cannot be parallelized away),
 * so a full week takes 5-20 minutes. Railway's edge proxy severs HTTP
 * responses at ~5 minutes (observed: curl 502 at +5:01), so this endpoint
 * validates, kicks the scan off in the background, and returns 202
 * immediately. Completion lands in the earnings_scans row + deploy logs.
 *
 * Returns:
 *   202 { accepted, scanWeek, universeSize }   — scan started
 *   409 { error }                              — a scan is already running
 */
/** In-flight guard — one scan at a time. Module-level is fine here: the app
 *  runs as a single long-lived Node process on Railway. Stale entries clear
 *  after 40 min in case a background run dies without the finally firing. */
let inFlight: { scanWeek: string; startedAt: number } | null = null;

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

  // One at a time — a re-trigger while a run is in flight would double-hammer
  // Finnhub/Polygon and race the UPSERT.
  if (inFlight && Date.now() - inFlight.startedAt < 40 * 60_000) {
    return NextResponse.json(
      {
        error: `earnings scan for ${inFlight.scanWeek} already running (${Math.round((Date.now() - inFlight.startedAt) / 60000)} min in)`,
      },
      { status: 409 },
    );
  }
  inFlight = { scanWeek: fromIso, startedAt: Date.now() };

  // Fire-and-forget: Railway runs a persistent Node server, so this promise
  // keeps executing after the response is sent. Completion is observable in
  // the earnings_scans row (runAt/updatedAt) and the deploy logs.
  void (async () => {
    const started = Date.now();
    console.log(`[earnings-scan] background run started — week ${fromIso}, ${unique.length} events`);
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
    console.log(
      `[earnings-scan] completed — week ${fromIso}, ${tickers.length}/${unique.length} tickers in ${Math.round((Date.now() - started) / 1000)}s`,
    );
  })()
    .catch((err) => {
      console.error(`[earnings-scan] background run FAILED — week ${fromIso}:`, err);
    })
    .finally(() => {
      inFlight = null;
    });

  return NextResponse.json(
    {
      accepted: true,
      scanWeek: fromIso,
      coveredTo: toIso,
      universeSize: unique.length,
      note: "scan running in background (~5-20 min); earnings_scans row upserts on completion",
    },
    { status: 202 },
  );
}

export const GET = POST;

export const runtime = "nodejs";
// The response returns in ~2s (calendar fetch only); the scan itself runs
// detached from the request. maxDuration guards just the synchronous part.
export const maxDuration = 60;
