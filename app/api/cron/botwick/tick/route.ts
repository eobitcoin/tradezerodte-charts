import { NextResponse } from "next/server";
import { requireBotwickCronBearer } from "@/lib/bearer";
import { runMonitorTick } from "@/lib/botwick/monitor";
import { getMarketHoursPhase } from "@/lib/botwick/market-hours";

/**
 * POST /api/cron/botwick/tick
 *
 * Runs ONE monitoring pass from a scheduled job (Railway cron, GH Actions,
 * upstash QStash — anything that can curl a URL with a bearer header).
 * Distinct from /api/admin/botwick/tick which is session-authed for an
 * admin clicking a button.
 *
 * Authentication: `Authorization: Bearer ${BOTWICK_CRON_TOKEN}`.
 *
 * Gate: skips fast (no Tradier calls, no DB writes) outside regular trading
 * hours. The cron schedule SHOULD already respect market hours, but we
 * defense-in-depth at the endpoint so a misconfigured cron can't burn quota.
 *
 * Returns:
 *   200 { ok: true, skipped: true, phase, message } — outside RTH
 *   200 { ok: true, skipped: false, summary }       — tick ran
 *   200 { ok: true, skipped: true, reason: "bot_..." }    — bot off / killed / etc
 *   401/403/500 with { error } on auth failures
 */
export async function POST(req: Request) {
  const auth = requireBotwickCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const phase = getMarketHoursPhase();
  if (phase !== "rth") {
    return NextResponse.json({
      ok: true,
      skipped: true,
      phase,
      message: `skipped: market is ${phase.replace("_", "-")}`,
    });
  }

  const res = await runMonitorTick({
    actor: { id: "cron" },
  });
  if (!res.ok) {
    // Not a failure to fail loud about — most "not ok" cases are bot
    // disabled / mode off / kill switch. We surface them with 200 so the
    // cron doesn't retry / page on benign config.
    return NextResponse.json({ ok: true, skipped: true, reason: res.code, detail: res.reason });
  }

  return NextResponse.json({ ok: true, skipped: false, summary: res.summary });
}

// Tradier rate limits are forgiving but not infinite — cap concurrency at the
// edge. Allow GET for trivial cron services that can't easily POST.
export const GET = POST;
