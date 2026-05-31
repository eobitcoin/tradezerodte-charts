import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireLeapCronBearer } from "@/lib/bearer";
import { db } from "@/lib/db";
import { leapPicks, leapScans } from "@/lib/db/schema";
import { nyTradingDay } from "@/lib/trading-day";
import {
  LEAP_WATCHLIST,
  MIN_COMPOSITE,
  scanLeapUniverse,
  toPickSummary,
} from "@/lib/leap-scanner";

/**
 * POST /api/cron/leap-scan
 *
 * Weekly Cheap LEAPs scan. Walks the 15-ticker quality universe,
 * computes three scores per ticker (IV rank, fundamentals, setup),
 * picks the best 14-20mo 25Δ call for those that clear the bar, and
 * persists both per-pick rows + a summary scan row.
 *
 * Authentication: `Authorization: Bearer ${LEAP_CRON_TOKEN}`.
 *
 * Schedule: weekly. Crontab `0 22 * * 0` (Sunday 22:00 UTC = 5 PM ET
 * winter / 6 PM ET summer). Vol regime moves slowly so daily would
 * be overkill; a weekly post matches how LEAPs are actually held.
 *
 * Idempotency: leap_scans UPSERTs on scan_day. leap_picks DELETEs
 * existing rows for the scan_day before INSERTing — re-running a
 * scan replaces its picks cleanly.
 *
 * Returns:
 *   200 { ok: true, scanDay, universeSize, candidates, picksPublished,
 *         passedThreshold, contractsFound, topPick, errors }
 *   401/403/500 with { error } on auth failures
 */
export async function POST(req: Request) {
  const auth = requireLeapCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const scanDay = nyTradingDay();
  const results = await scanLeapUniverse({ perTickerDelayMs: 600 });

  const passedThreshold = results.filter((r) => r.composite >= MIN_COMPOSITE);
  const withContract = passedThreshold.filter((r) => r.contract !== null);
  const picks = withContract
    .map(toPickSummary)
    .filter((p): p is NonNullable<ReturnType<typeof toPickSummary>> => p !== null);

  // Replace prior picks for this scan_day so a re-run produces a
  // clean set (no orphans from earlier composite thresholds).
  await db.delete(leapPicks).where(sql`scan_day = ${scanDay}`);

  for (const r of withContract) {
    const c = r.contract!;
    await db.insert(leapPicks).values({
      scanDay,
      ticker: r.ticker,
      contractTicker: c.contractTicker,
      expirationDate: c.expirationDate,
      strike: c.strike.toString(),
      dteDays: c.dteDays,
      underlyingPrice: c.underlyingPrice.toString(),
      premiumMid: c.premiumMid?.toString() ?? null,
      premiumBid: c.premiumBid?.toString() ?? null,
      premiumAsk: c.premiumAsk?.toString() ?? null,
      iv: c.iv?.toString() ?? null,
      delta: c.delta?.toString() ?? null,
      gamma: c.gamma?.toString() ?? null,
      theta: c.theta?.toString() ?? null,
      vega: c.vega?.toString() ?? null,
      openInterest: c.openInterest ?? null,
      ivRank: r.ivRank?.toFixed(2) ?? null,
      qualityScore: r.qualityScore?.toFixed(2) ?? null,
      setupScore: r.setupScore?.toFixed(2) ?? null,
      compositeScore: r.composite.toFixed(2),
      fundamentals: {
        revenueTtm: r.fundamentals?.revenueTtm ?? null,
        revenueYoyPct: r.fundamentals?.revenueYoyPct ?? null,
        grossMarginPct: r.fundamentals?.grossMarginPct ?? null,
        operatingIncomeTtm: r.fundamentals?.operatingIncomeTtm ?? null,
        cashAndSt: r.fundamentals?.cashAndSt ?? null,
        runwayQuarters: r.fundamentals?.runwayQuarters ?? null,
        qualityReasons: r.qualityReasons,
        setup: r.setup,
      },
      meta: { errors: r.errors },
    });
  }

  // Summary row.
  const title = `Cheap LEAPs — ${new Date(`${scanDay}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`;

  const summary =
    picks.length === 0
      ? "No tickers cleared the cheap-LEAPs bar this week. Vol is bid across the watchlist or the fundamental/setup filters didn't align. Check back next Sunday — the regime usually shifts within 2-3 weeks."
      : `**${picks.length}** pick${picks.length === 1 ? "" : "s"} cleared the cheap-LEAPs bar (composite ≥ ${MIN_COMPOSITE}). Top: **${picks[0].ticker}** ${picks[0].strike}C ${picks[0].expirationDate} at composite ${picks[0].compositeScore.toFixed(0)}. Each pick combines low IV rank, solid fundamentals, and a healthy pullback within an uptrend.`;

  await db
    .insert(leapScans)
    .values({
      scanDay,
      title,
      summary,
      picks,
      universeSize: LEAP_WATCHLIST.length,
      runAt: new Date(),
      meta: {
        candidates: results.length,
        passedThreshold: passedThreshold.length,
        contractsFound: withContract.length,
      },
    })
    .onConflictDoUpdate({
      target: leapScans.scanDay,
      set: {
        title,
        summary,
        picks,
        runAt: new Date(),
        meta: {
          candidates: results.length,
          passedThreshold: passedThreshold.length,
          contractsFound: withContract.length,
        },
        updatedAt: sql`now()`,
      },
    });

  const allErrors = results.flatMap((r) => r.errors.map((e) => ({ ticker: r.ticker, message: e })));

  return NextResponse.json({
    ok: true,
    scanDay,
    universeSize: LEAP_WATCHLIST.length,
    candidates: results.length,
    passedThreshold: passedThreshold.length,
    contractsFound: withContract.length,
    picksPublished: picks.length,
    topPick:
      picks.length > 0
        ? `${picks[0].ticker} ${picks[0].strike}C ${picks[0].expirationDate}`
        : null,
    errors: allErrors,
  });
}

export const GET = POST;

export const runtime = "nodejs";
// 15 tickers × ~5s each (IV query + SEC fetch + bars + maybe chain)
// ≈ 75s typical. 4 min cap is generous.
export const maxDuration = 300;
