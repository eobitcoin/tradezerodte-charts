import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { runMonitorTick } from "@/lib/botwick/monitor";

/**
 * POST /api/admin/botwick/tick
 *
 * Admin-only. Runs ONE monitoring pass:
 *   - For each ticker with a pending bot_trade, pull live Tradier data,
 *     build MarketState, evaluate entry conditions, transition matching
 *     trades to "signal_armed" + log to the Matrix tape.
 *
 * Returns the per-trade outcome summary so the UI can show the admin what
 * happened on that tick. Auto-tick (Railway cron) is Phase 3b.
 */
export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const res = await runMonitorTick({ actor: { id: admin.id } });
  if (!res.ok) {
    return NextResponse.json({ error: res.reason, code: res.code }, { status: 409 });
  }
  return NextResponse.json({ ok: true, summary: res.summary });
}
