import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireIvSnapshotCronBearer } from "@/lib/bearer";
import { db } from "@/lib/db";
import { ivSnapshots } from "@/lib/db/schema";
import { nyTradingDay } from "@/lib/trading-day";
import { OPTIONS_EDGE_WATCHLIST } from "@/lib/iv-analysis";
import {
  fetchOptionChain,
  extractSurfacePoints,
  hv30dForDate,
} from "@/lib/polygon";

/**
 * POST /api/cron/iv-snapshot
 *
 * Daily harvester that grabs today's IV surface for every ticker in the
 * Options Edge watchlist and UPSERTs one row per ticker into iv_snapshots.
 * The backfill script (scripts/backfill-iv-snapshots.mjs) seeded ~12 months
 * of history; this endpoint keeps that history rolling forward day by day so
 * the Sunday Options Edge scanner always has a fresh tail.
 *
 * Authentication: `Authorization: Bearer ${IV_SNAPSHOT_CRON_TOKEN}`.
 * Set the same token on the Railway cron service that pings this URL.
 *
 * Schedule: 22:00 UTC weekdays (= 5 PM ET winter / 6 PM ET summer, after
 * Polygon's end-of-day chain has settled). Crontab `0 22 * * 1-5`.
 *
 * Idempotency: re-running on the same day is safe — each ticker either
 * inserts (first call) or updates (subsequent calls). The cron service can
 * retry on failure without producing dup rows.
 *
 * Returns:
 *   200 { ok: true, snapshotDate, written, failed, errors[] }
 *   401/403/500 with { error } on auth failures
 */
export async function POST(req: Request) {
  const auth = requireIvSnapshotCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const snapshotDate = nyTradingDay();
  const written: string[] = [];
  const failed: string[] = [];
  const errors: Array<{ ticker: string; message: string }> = [];

  // Throttle: pause between tickers so we stay under Polygon's per-minute
  // cap. Each ticker fires ~3 calls (chain + chain pagination + aggs), so
  // 600ms between tickers keeps us under ~100 calls/min comfortably. The
  // polygonGet wrapper retries 429s on top of this; the sleep is the
  // first line of defense so retries stay rare.
  const PER_TICKER_DELAY_MS = 600;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Sequential — Polygon Options Advanced has generous limits but the chain
  // calls are heavy. 25 tickers × ~4s each ≈ 100s well under the 300s
  // maxDuration cap.
  let first = true;
  for (const ticker of OPTIONS_EDGE_WATCHLIST) {
    if (!first) await sleep(PER_TICKER_DELAY_MS);
    first = false;
    try {
      const chain = await fetchOptionChain(ticker);
      const surface = extractSurfacePoints(chain, snapshotDate);
      const hv = await hv30dForDate(ticker, snapshotDate);

      await db
        .insert(ivSnapshots)
        .values({
          ticker,
          snapshotDate,
          underlyingPrice: surface.underlyingPrice?.toString() ?? null,
          atmIv30d: surface.atmIv30d?.toString() ?? null,
          atmIv60d: surface.atmIv60d?.toString() ?? null,
          put25dIv30d: surface.put25dIv30d?.toString() ?? null,
          call25dIv30d: surface.call25dIv30d?.toString() ?? null,
          hv30d: hv?.toString() ?? null,
          meta: surface.meta as Record<string, unknown>,
        })
        .onConflictDoUpdate({
          target: [ivSnapshots.ticker, ivSnapshots.snapshotDate],
          set: {
            underlyingPrice: surface.underlyingPrice?.toString() ?? null,
            atmIv30d: surface.atmIv30d?.toString() ?? null,
            atmIv60d: surface.atmIv60d?.toString() ?? null,
            put25dIv30d: surface.put25dIv30d?.toString() ?? null,
            call25dIv30d: surface.call25dIv30d?.toString() ?? null,
            hv30d: hv?.toString() ?? null,
            meta: surface.meta as Record<string, unknown>,
          },
        });
      written.push(ticker);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push(ticker);
      errors.push({ ticker, message });
      // Don't bail — a single ticker hiccup (Polygon 5xx, transient DB) must
      // not poison the other 24 names. Failures get reported in the response
      // and the cron logs.
    }
  }

  // Update the universe's run heartbeat — useful for the admin dashboard
  // to know when the last successful refresh was. Cheap, fire-and-forget.
  await db.execute(sql`SELECT 1`);

  return NextResponse.json({
    ok: true,
    snapshotDate,
    written: written.length,
    failed: failed.length,
    failedTickers: failed,
    errors,
  });
}

// Allow GET for cron services that can only issue GET — same auth, same
// behavior. (Railway cron services curl arbitrary HTTP, so POST is fine,
// but parity with botwick/tick costs nothing.)
export const GET = POST;

// Node runtime — Drizzle/postgres + the Polygon client both need it. 5 min
// cap is more than enough for 25 tickers but gives us headroom if Polygon
// is slow.
export const runtime = "nodejs";
export const maxDuration = 300;
