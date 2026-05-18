import { NextResponse } from "next/server";
import { requireIngestBearer } from "@/lib/bearer";
import { getScansForDay } from "@/lib/scans";
import { mergeDayScans } from "@/lib/merge-trades";
import { settleAllTrades } from "@/lib/settlement-engine";

export const runtime = "nodejs";

/**
 * GET /api/settlement/compute?day=YYYY-MM-DD
 *
 * Bearer-protected. Reads the merged trade plan for the given trading day
 * (premarket + market_open + analysis overlays), then runs the deterministic
 * settlement engine against Tradier intraday option premium bars.
 *
 * Returns the engine's per-trade verdicts plus the merged trade objects so
 * the caller (the post-close settlement routine) can:
 *   1. write LLM commentary per trade using the deterministic verdict as the
 *      anchor;
 *   2. POST a settlement post with each verdict's outcome + pnl_pct +
 *      actual_entry + actual_exit attached, and the LLM narrative in
 *      `result_notes`.
 *
 * Settlement is a read-only computation on this endpoint — actual persistence
 * happens via the existing POST /api/posts (scan_kind="settlement").
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const auth = requireIngestBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const url = new URL(req.url);
  const day = url.searchParams.get("day");
  if (!day || !DATE_RE.test(day)) {
    return NextResponse.json(
      { error: "missing or invalid `day` (must be YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  const scans = await getScansForDay(day);
  if (!scans.premarket) {
    return NextResponse.json(
      {
        error: `no premarket scan for ${day} — nothing to settle`,
        trading_day: day,
      },
      { status: 404 },
    );
  }

  const { trades } = mergeDayScans({
    premarket: scans.premarket,
    marketOpen: scans.marketOpen,
    analysis: scans.analysis,
    // Don't fold settlement into itself — we're computing a fresh verdict.
    settlement: null,
  });
  // Skip killed trades — they never executed, no outcome to compute.
  const livePlan = trades.filter((t) => t.status !== "killed");
  const verdicts = await settleAllTrades(livePlan, day);

  return NextResponse.json({
    trading_day: day,
    plan_count: trades.length,
    live_count: livePlan.length,
    killed_count: trades.length - livePlan.length,
    verdicts: verdicts.map((v, i) => ({
      ...v,
      // Echo the merged trade fields the routine needs to write commentary,
      // so it doesn't have to fetch the plan separately.
      trade: {
        ticker: livePlan[i].ticker,
        direction: livePlan[i].direction,
        strike: livePlan[i].strike,
        expiry: livePlan[i].expiry,
        entry_zone: livePlan[i].entry_zone,
        entry_trigger: livePlan[i].entry_trigger,
        target1: livePlan[i].target1,
        target2: livePlan[i].target2,
        stop: livePlan[i].stop,
        time_stop: livePlan[i].time_stop,
        rationale: livePlan[i].rationale,
        grade: livePlan[i].grade,
        rank: livePlan[i].rank,
        source: livePlan[i].source,
        status: livePlan[i].status,
      },
    })),
  });
}
