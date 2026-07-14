import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireBotwickAnalysisCronBearer } from "@/lib/bearer";
import { db } from "@/lib/db";
import { botwickScans } from "@/lib/db/schema";
import { runBotwickScan, BOTWICK_TICKERS } from "@/lib/botwick-analysis";
import { nyTradingDay } from "@/lib/trading-day";

/**
 * POST /api/cron/botwick-analysis
 *
 * Daily 6AM ET Finora-style SMC analysis over the fixed 21-name BotWick
 * universe. Per ticker: hourly + daily Polygon bars → indicator scorecard +
 * Smart-Money levels + deterministic narrative + defined-risk options idea.
 * Surfaced as the first tab on the Today page.
 *
 * Auth: `Authorization: Bearer ${BOTWICK_ANALYSIS_CRON_TOKEN}`.
 * Schedule: weekdays 6:00 AM ET (10:00 UTC during EDT).
 * Idempotent: UPSERTs on scan_day.
 */
export async function POST(req: Request) {
  const auth = requireBotwickAnalysisCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const scanDay = nyTradingDay();
  const result = await runBotwickScan();

  const data = {
    scanDay,
    tickers: [...BOTWICK_TICKERS],
    reports: result.reports,
  };
  const meta = {
    timing: result.timing,
    failed: result.reports.filter((r) => !r.ok).map((r) => ({ symbol: r.symbol, error: r.error })),
  };

  await db
    .insert(botwickScans)
    .values({
      scanDay,
      universeSize: BOTWICK_TICKERS.length,
      computedSize: result.okCount,
      data,
      meta,
      runAt: new Date(),
    })
    .onConflictDoUpdate({
      target: botwickScans.scanDay,
      set: {
        universeSize: BOTWICK_TICKERS.length,
        computedSize: result.okCount,
        data,
        // MERGE into existing meta rather than replace — meta.tweets holds the
        // day's posted-tweet ledger, and clobbering it on a re-run would let
        // the tweets cron double-post.
        meta: sql`coalesce(${botwickScans.meta}, '{}'::jsonb) || ${JSON.stringify(meta)}::jsonb`,
        runAt: new Date(),
        updatedAt: sql`now()`,
      },
    });

  return NextResponse.json({
    ok: true,
    scanDay,
    universeSize: BOTWICK_TICKERS.length,
    computedSize: result.okCount,
    timing: result.timing,
    failed: meta.failed,
    biases: result.reports
      .filter((r) => r.ok)
      .map((r) => ({ symbol: r.symbol, price: r.price, bias: r.bias })),
  });
}

export const GET = POST;

export const runtime = "nodejs";
// 21 tickers × (2 paged bar pulls + 1 snapshot) at concurrency 6 ≈ 30-90s.
export const maxDuration = 300;
