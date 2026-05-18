import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { botActions, botConfig, botTrades } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";
import { getGainLoss, getPositions, submitOrder } from "@/lib/botwick/tradier-adapter";
import { resolveOcc } from "@/lib/botwick/occ";
import { checkFourOfFourGate } from "@/lib/botwick/oms";
import { withAdvisoryLock, LOCK_IDS } from "@/lib/db/advisory-lock";

/**
 * POST /api/admin/botwick/trades/[id]/close
 *
 * Admin-only. Submits a MARKET sell_to_close for an `open` bot trade and
 * race-safely transitions it to `closing`. The follow-up fill / status is
 * picked up by the normal `reconcileWorkingOrders` path on the next tick.
 *
 * Why MARKET (not limit-at-mid): the operator is manually pulling the trigger
 * because *something is wrong*. Fill certainty matters more than a half-cent
 * of price; mirrors the force-exit and stop-loss behavior.
 *
 * Failure modes:
 *   - 403: not admin
 *   - 404: trade not found
 *   - 409: trade not in `open` status (already closing/closed/etc.)
 *   - 500: Tradier rejected or no-OCC etc. The trade stays `open` so the
 *          admin can retry.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "missing trade id" }, { status: 400 });

  // B3: Acquire the same advisory lock the monitor tick uses. Prevents the
  // tick (which mutates plan.runtime + leg.qty + status) from racing this
  // route's status flip + order submit. Lock is non-blocking — a tick in
  // flight makes us fail-fast and the admin can click again in a moment.
  const lock = await withAdvisoryLock(LOCK_IDS.BOTWICK_MONITOR_TICK, async () => {
    return await runManualClose(id, admin.id);
  });
  if (!lock.ok) {
    return NextResponse.json(
      { error: "monitor tick in progress; retry in a second", code: "lock_unavailable" },
      { status: 503 },
    );
  }
  return lock.data;
}

async function runManualClose(id: string, adminId: string): Promise<Response> {
  const [trade] = await db.select().from(botTrades).where(eq(botTrades.id, id)).limit(1);
  if (!trade) return NextResponse.json({ error: "trade not found" }, { status: 404 });
  if (trade.status !== "open") {
    return NextResponse.json(
      {
        error: `trade is in status '${trade.status}' (not 'open'); cannot manually close`,
      },
      { status: 409 },
    );
  }

  const [cfg] = await db.select().from(botConfig).where(eq(botConfig.id, "default")).limit(1);
  if (!cfg) {
    return NextResponse.json({ error: "bot_config row missing" }, { status: 500 });
  }

  // Same 4-of-4 gate as automated submits — even on manual closes we honor
  // the kill switch + mode-off + live-confirmation rails.
  const gate = checkFourOfFourGate(cfg);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason, code: gate.code }, { status: 400 });
  }
  const admin = { id: adminId };

  const leg = (trade.legs as Array<Record<string, unknown>>)[0];
  const isStockLeg = (leg as Record<string, unknown>)?.instrument === "stock";
  // For stock legs `assetSymbol` is the underlying ticker; for options it's
  // the OCC. Both share the same pre-flight + commit + tape logic below.
  let occSymbol: string | null = null;
  if (isStockLeg) {
    occSymbol = trade.sourceTicker.toUpperCase();
  } else {
    occSymbol = (leg?.occ_symbol as string | null) ?? null;
    if (!occSymbol) {
      const r = resolveOcc(trade);
      if (!r.ok) {
        return NextResponse.json({ error: `cannot resolve OCC: ${r.reason}` }, { status: 500 });
      }
      occSymbol = r.occSymbol;
    }
  }
  const legQty = ((leg?.qty as number) ?? 1) || 1;

  // PRE-FLIGHT — verify Tradier still has the position before submitting any
  // close order. If the position is gone (admin already closed manually at the
  // broker, or it never opened, etc.), DO NOT submit a sell_to_close: Tradier
  // would reject it, and worst-case we'd create a phantom short. Instead,
  // reconcile the DB to `closed` and attach P&L from gainloss when we can.
  const posRes = await getPositions(cfg.mode);
  if (!posRes.ok) {
    return NextResponse.json(
      {
        error: `cannot verify position at Tradier before submitting close: ${posRes.reason}. Refusing to send order blind.`,
        code: posRes.code,
      },
      { status: 502 },
    );
  }
  // H7: Use Tradier's reported position size as the truth (long stock = +qty,
  // short stock = -qty). Falls back to leg.qty if we can't find a match. This
  // protects against partial-fill drift and against over-covering a short
  // that's smaller than expected.
  const matchingPos = posRes.data.find((p) => p.symbol === occSymbol && p.quantity !== 0);
  const positionExists = matchingPos != null;
  const qty = matchingPos ? Math.abs(matchingPos.quantity) : legQty;

  if (!positionExists) {
    // No position to close. Reconcile DB without sending an order.
    let realizedPnlUsd: number | null = null;
    let exitFillUsd: number | null = null;
    let closedAt = new Date();
    let matchedGainloss = false;

    // Best-effort: pull last 2 days of gainloss to attach P&L.
    const gl = await getGainLoss(cfg.mode, { start: ymdDaysAgo(2), end: ymdDaysAgo(0) });
    if (gl.ok) {
      const matches = gl.data
        .filter((g) => g.symbol === occSymbol)
        .sort(
          (a, b) =>
            new Date(b.close_date ?? 0).getTime() -
            new Date(a.close_date ?? 0).getTime(),
        );
      const match = matches[0];
      if (match) {
        matchedGainloss = true;
        if (Number.isFinite(match.gain_loss)) realizedPnlUsd = Number(match.gain_loss);
        if (
          Number.isFinite(match.proceeds) &&
          Number.isFinite(match.quantity) &&
          match.quantity !== 0
        ) {
          exitFillUsd = Number(match.proceeds) / Math.abs(match.quantity) / 100;
        }
        if (match.close_date) closedAt = new Date(match.close_date);
      }
    }

    const upd = await db
      .update(botTrades)
      .set({
        status: "closed",
        closedAt,
        realizedPnlUsd: realizedPnlUsd != null ? realizedPnlUsd.toFixed(2) : null,
        exitFillUsd: exitFillUsd != null ? exitFillUsd.toFixed(4) : null,
      })
      .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "open")))
      .returning({ id: botTrades.id });

    await db.insert(botActions).values({
      kind: "force_exit",
      severity: matchedGainloss && realizedPnlUsd != null && realizedPnlUsd < 0 ? "warn" : "info",
      message: `${trade.sourceTicker} ${occSymbol} — manual close requested by BotWick Admin but Tradier reports no matching position. Reconciled DB to closed${
        matchedGainloss
          ? `. Matched gainloss P&L ${realizedPnlUsd! >= 0 ? "+" : ""}$${realizedPnlUsd!.toFixed(2)}.`
          : ". No gainloss row found yet — P&L unknown; check Tradier P&L tab."
      } NO order was submitted.`,
      tradeId: trade.id,
      data: {
        actor: admin.id,
        occSymbol,
        manualClose: true,
        positionAbsent: true,
        matchedGainloss,
        realizedPnlUsd,
        exitFillUsd,
        orderSubmitted: false,
      },
    });

    return NextResponse.json({
      ok: true,
      tradeId: trade.id,
      occSymbol,
      qty,
      orderId: null,
      newStatus: "closed",
      positionAbsent: true,
      matchedGainloss,
      realizedPnlUsd,
      note:
        "No matching position at Tradier — likely already closed externally. Trade reconciled to 'closed' without submitting a duplicate exit order.",
      raceWithReconcile: upd.length === 0,
    });
  }

  // Position confirmed present at Tradier — proceed with normal close path.
  const sub = await submitOrder(
    cfg.mode,
    isStockLeg
      ? {
          instrument: "stock",
          underlying: trade.sourceTicker,
          side: trade.strategy === "short_stock" ? "buy_to_cover" : "sell",
          quantity: qty,
          type: "market",
          duration: "day",
        }
      : {
          instrument: "option",
          underlying: trade.sourceTicker,
          optionSymbol: occSymbol,
          side: "sell_to_close",
          quantity: qty,
          type: "market",
          duration: "day",
        },
  );
  if (!sub.ok) {
    await db.insert(botActions).values({
      kind: "error",
      severity: "error",
      message: `${trade.sourceTicker} ${occSymbol} — manual close submit failed: ${sub.reason}`,
      tradeId: trade.id,
      data: { actor: admin.id, code: sub.code, reason: sub.reason, manualClose: true },
    });
    return NextResponse.json({ error: sub.reason, code: sub.code }, { status: 502 });
  }

  // Race-safe open → closing.
  const upd = await db
    .update(botTrades)
    .set({ status: "closing", tradierOrderId: String(sub.data.id) })
    .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "open")))
    .returning({ id: botTrades.id });

  if (upd.length === 0) {
    // Something else (force-exit, broker-reconcile) won the race. The Tradier
    // order is now live; cancel it to avoid double-closing.
    await db.insert(botActions).values({
      kind: "error",
      severity: "error",
      message: `${trade.sourceTicker} — manual close: order ${sub.data.id} submitted but trade no longer in 'open'. Cancelling to avoid duplicate exit.`,
      tradeId: trade.id,
      data: { actor: admin.id, orderId: String(sub.data.id), race: true },
    });
    // Best-effort cancel; failures will surface via broker-reconcile.
    try {
      const { cancelOrder } = await import("@/lib/botwick/tradier-adapter");
      await cancelOrder(cfg.mode, sub.data.id);
    } catch {
      /* swallow */
    }
    return NextResponse.json(
      { error: "race: trade no longer in 'open' state when commit ran; cancelled the duplicate exit order" },
      { status: 409 },
    );
  }

  await db.insert(botActions).values({
    kind: "force_exit",
    severity: "warn",
    message: `${trade.sourceTicker} ${occSymbol} — MARKET sell_to_close ${qty}× (manual close by BotWick Admin, order ${sub.data.id})`,
    tradeId: trade.id,
    data: {
      actor: admin.id,
      orderId: String(sub.data.id),
      occSymbol,
      qty,
      reason: "manual_close",
    },
  });

  return NextResponse.json({
    ok: true,
    tradeId: trade.id,
    occSymbol,
    qty,
    orderId: String(sub.data.id),
    newStatus: "closing",
  });
}

/** YYYY-MM-DD for "today − n days" in America/New_York. Used to scope gainloss
 *  lookups when reconciling a position that's already gone at Tradier. */
function ymdDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
