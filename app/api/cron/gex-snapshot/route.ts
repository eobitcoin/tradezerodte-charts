import { NextResponse } from "next/server";
import { requireGexCronBearer } from "@/lib/bearer";
import { db } from "@/lib/db";
import { gexSnapshots } from "@/lib/db/schema";
import { GEX_WATCHLIST, computeGexSnapshot } from "@/lib/gex";

/**
 * POST /api/cron/gex-snapshot
 *
 * Walks the GEX watchlist (3 indexes + 10 single names), pulls each
 * ticker's options chain, aggregates per-strike dealer gamma, finds
 * the zero-gamma flip, and INSERTs one snapshot row per ticker into
 * gex_snapshots.
 *
 * Authentication: `Authorization: Bearer ${GEX_CRON_TOKEN}`.
 *
 * Schedule: every 5 minutes during RTH. Crontab `*\/5 13-21 * * 1-5`
 * (covers 9 AM – 5 PM ET across both EST and EDT). Outside RTH the
 * chain greeks are stale but valid, so the endpoint still works — the
 * cron just doesn't fire then.
 *
 * Idempotency: each tick INSERTs a new row (snapshots are time series,
 * not UPSERTs). Re-running the same minute writes duplicate rows; the
 * detail page reads `latest` by (ticker, ts desc) so it picks the
 * freshest. If duplicate rows become a problem we can add a unique
 * constraint on (ticker, ts truncated to minute).
 *
 * Returns:
 *   200 { ok: true, snapshotTs, written, failed, errors[] }
 */
export async function POST(req: Request) {
  const auth = requireGexCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const snapshotTs = new Date();
  const written: string[] = [];
  const failed: string[] = [];
  const errors: Array<{ ticker: string; message: string }> = [];

  // Sequential with light throttle — 13 tickers, 1 chain call each
  // (plus pagination for indexes). 400ms gap keeps total runtime
  // under ~30s while staying well clear of the per-minute Polygon cap.
  const PER_TICKER_DELAY_MS = 400;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let first = true;
  for (const ticker of GEX_WATCHLIST) {
    if (!first) await sleep(PER_TICKER_DELAY_MS);
    first = false;
    try {
      const result = await computeGexSnapshot(ticker);
      if (!result) {
        failed.push(ticker);
        errors.push({
          ticker,
          message: "computeGexSnapshot returned null (empty chain or no spot)",
        });
        continue;
      }
      await db.insert(gexSnapshots).values({
        ticker,
        ts: snapshotTs,
        spot: result.spot.toString(),
        totalGex: result.totalGex.toFixed(2),
        zeroGammaStrike: result.zeroGammaStrike?.toString() ?? null,
        zeroGammaPct: result.zeroGammaPct?.toFixed(2) ?? null,
        gexByStrike: result.gexByStrike,
        contractsScanned: result.contractsScanned,
        expiriesScanned: result.expiriesScanned,
      });
      written.push(ticker);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push(ticker);
      errors.push({ ticker, message });
    }
  }

  return NextResponse.json({
    ok: true,
    snapshotTs: snapshotTs.toISOString(),
    written: written.length,
    failed: failed.length,
    failedTickers: failed,
    errors,
  });
}

export const GET = POST;

export const runtime = "nodejs";
// 5-min cron; cap runtime at 4 min so we never overlap. Typical
// runtime ~25s for 13 tickers.
export const maxDuration = 240;
