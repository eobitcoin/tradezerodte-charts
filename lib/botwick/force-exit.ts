/**
 * Day-trade force-exit sweep — runs once when the monitor tick lands inside
 * the force-exit window (15:55–15:59 ET) AND `bot_config.day_trade_force_exit
 * = true`. Idempotent: re-running it (e.g., second tick inside the window)
 * is a no-op because all targets are already in terminal/closing states.
 *
 * What it does, in order:
 *   1. `pending` / `signal_armed` → cancel locally. No Tradier order exists
 *      for these yet, so nothing to cancel broker-side.
 *   2. `working` (entry order in flight) → cancel the Tradier order, then
 *      mark the bot_trade `cancelled`. A buy_to_open limit sitting in the
 *      book at 15:56 is a future open position we DON'T want to inherit.
 *   3. `open` → submit a MARKET sell_to_close. We don't care about price at
 *      this point; we care about being flat by 16:00. Race-safe atomic
 *      transition to `closing`; reconcile picks up the fill on the next
 *      tick(s) just like any other exit.
 *
 * Each step writes a `force_exit` (or `plan_expired` for #1) event to the
 * tape so the user can see exactly what got swept.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  botActions,
  botTrades,
  type BotConfig,
  type BotTrade,
} from "@/lib/db/schema";
import { cancelOrder, getOrderStatus, submitOrder } from "./tradier-adapter";
import { resolveOcc } from "./occ";

export type ForceExitOutcome = {
  tradeId: string;
  ticker: string;
  prevStatus: string;
  newStatus: string;
  outcome:
    | "cancelled_pending"
    | "cancelled_working_order"
    | "market_close_submitted"
    | "closing_limit_replaced_with_market"
    | "skipped_no_occ"
    | "error";
  reason?: string;
};

export async function runForceExit(cfg: BotConfig): Promise<ForceExitOutcome[]> {
  const targets = await db
    .select()
    .from(botTrades)
    .where(
      inArray(botTrades.status, [
        "pending",
        "signal_armed",
        "working",
        "open",
        "closing",
      ]),
    );

  const outcomes: ForceExitOutcome[] = [];
  for (const trade of targets) {
    switch (trade.status) {
      case "pending":
      case "signal_armed":
        outcomes.push(await cancelLocalOnly(trade));
        break;
      case "working":
        outcomes.push(await cancelWorkingEntry(trade, cfg));
        break;
      case "open":
        outcomes.push(await submitMarketClose(trade, cfg));
        break;
      case "closing":
        // Trade is already trying to close (limit exit submitted earlier in
        // the day, sitting unfilled). Cancel that limit and submit a market
        // close in its place — otherwise the day-order expires at 16:00 and
        // we carry the position overnight.
        outcomes.push(await replaceClosingLimitWithMarket(trade, cfg));
        break;
    }
  }

  if (outcomes.length > 0) {
    await logTape({
      kind: "force_exit",
      severity: "warn",
      message: `Day-trade force-exit sweep — ${outcomes.length} trade${outcomes.length === 1 ? "" : "s"} touched`,
      data: { outcomes },
    });
  }
  return outcomes;
}

async function cancelLocalOnly(trade: BotTrade): Promise<ForceExitOutcome> {
  const upd = await db
    .update(botTrades)
    .set({ status: "cancelled", closedAt: new Date() })
    .where(
      and(
        eq(botTrades.id, trade.id),
        inArray(botTrades.status, ["pending", "signal_armed"]),
      ),
    )
    .returning({ id: botTrades.id });

  if (upd.length === 0) {
    return {
      tradeId: trade.id,
      ticker: trade.sourceTicker,
      prevStatus: trade.status,
      newStatus: trade.status,
      outcome: "error",
      reason: "race: trade already progressed",
    };
  }
  await logTape({
    kind: "plan_expired",
    severity: "warn",
    message: `${trade.sourceTicker} ${trade.strategy} — force-cancelled (was ${trade.status}, end-of-day sweep)`,
    tradeId: trade.id,
    data: { reason: "day_trade_force_exit", prevStatus: trade.status },
  });
  return {
    tradeId: trade.id,
    ticker: trade.sourceTicker,
    prevStatus: trade.status,
    newStatus: "cancelled",
    outcome: "cancelled_pending",
  };
}

async function cancelWorkingEntry(trade: BotTrade, cfg: BotConfig): Promise<ForceExitOutcome> {
  if (!trade.tradierOrderId) {
    // No broker order known. Mark locally and move on.
    return cancelLocalOnly({ ...trade, status: "pending" });
  }

  const cancel = await cancelOrder(cfg.mode, trade.tradierOrderId);
  if (!cancel.ok) {
    await logTape({
      kind: "error",
      severity: "error",
      message: `${trade.sourceTicker} — Tradier cancel failed during force-exit: ${cancel.reason}`,
      tradeId: trade.id,
      data: { orderId: trade.tradierOrderId, code: cancel.code },
    });
    return {
      tradeId: trade.id,
      ticker: trade.sourceTicker,
      prevStatus: "working",
      newStatus: "working",
      outcome: "error",
      reason: cancel.reason,
    };
  }

  // Tradier accepted the cancel. Mark trade cancelled locally.
  const upd = await db
    .update(botTrades)
    .set({ status: "cancelled", closedAt: new Date() })
    .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "working")))
    .returning({ id: botTrades.id });

  if (upd.length === 0) {
    return {
      tradeId: trade.id,
      ticker: trade.sourceTicker,
      prevStatus: "working",
      newStatus: "working",
      outcome: "error",
      reason: "race: trade already progressed",
    };
  }

  await logTape({
    kind: "order_cancelled",
    severity: "warn",
    message: `${trade.sourceTicker} — entry order ${trade.tradierOrderId} cancelled (force-exit sweep)`,
    tradeId: trade.id,
    data: { orderId: trade.tradierOrderId, reason: "day_trade_force_exit" },
  });
  return {
    tradeId: trade.id,
    ticker: trade.sourceTicker,
    prevStatus: "working",
    newStatus: "cancelled",
    outcome: "cancelled_working_order",
  };
}

async function submitMarketClose(trade: BotTrade, cfg: BotConfig): Promise<ForceExitOutcome> {
  const leg = (trade.legs as Array<Record<string, unknown>>)[0];
  const isStockLeg = (leg as Record<string, unknown>)?.instrument === "stock";
  const qty = ((leg?.qty as number) ?? 1) || 1;

  // Resolve order args + a display symbol (OCC for options, ticker for stocks).
  let orderArgs: Parameters<typeof submitOrder>[1];
  let occSymbol: string;
  if (isStockLeg) {
    occSymbol = trade.sourceTicker.toUpperCase();
    // Short positions cover via buy_to_cover, longs sell.
    const isShortPos = trade.strategy === "short_stock";
    orderArgs = {
      instrument: "stock",
      underlying: trade.sourceTicker,
      side: isShortPos ? "buy_to_cover" : "sell",
      quantity: qty,
      type: "market",
      duration: "day",
    };
  } else {
    let occ = (leg?.occ_symbol as string | null) ?? null;
    if (!occ) {
      const r = resolveOcc(trade);
      if (!r.ok) {
        await logTape({
          kind: "error",
          severity: "error",
          message: `${trade.sourceTicker} — force-exit market close skipped: ${r.reason}`,
          tradeId: trade.id,
          data: { reason: r.reason },
        });
        return {
          tradeId: trade.id,
          ticker: trade.sourceTicker,
          prevStatus: "open",
          newStatus: "open",
          outcome: "skipped_no_occ",
          reason: r.reason,
        };
      }
      occ = r.occSymbol;
    }
    occSymbol = occ;
    orderArgs = {
      instrument: "option",
      underlying: trade.sourceTicker,
      optionSymbol: occSymbol,
      side: "sell_to_close",
      quantity: qty,
      type: "market",
      duration: "day",
    };
  }

  // MARKET. No price — we're done deliberating; flatten now.
  const sub = await submitOrder(cfg.mode, orderArgs);
  if (!sub.ok) {
    await logTape({
      kind: "error",
      severity: "error",
      message: `${trade.sourceTicker} — force-exit market submit failed: ${sub.reason}`,
      tradeId: trade.id,
      data: { code: sub.code, reason: sub.reason },
    });
    return {
      tradeId: trade.id,
      ticker: trade.sourceTicker,
      prevStatus: "open",
      newStatus: "open",
      outcome: "error",
      reason: sub.reason,
    };
  }

  // Atomic open → closing.
  const upd = await db
    .update(botTrades)
    .set({ status: "closing", tradierOrderId: String(sub.data.id) })
    .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "open")))
    .returning({ id: botTrades.id });
  if (upd.length === 0) {
    await logTape({
      kind: "error",
      severity: "error",
      message: `${trade.sourceTicker} — force-exit submitted order ${sub.data.id} but trade already progressed; manual reconciliation needed`,
      tradeId: trade.id,
      data: { orderId: sub.data.id, leakedExit: true },
    });
    return {
      tradeId: trade.id,
      ticker: trade.sourceTicker,
      prevStatus: "open",
      newStatus: "open",
      outcome: "error",
      reason: "race: trade not in open by the time order returned",
    };
  }

  await logTape({
    kind: "force_exit",
    severity: "warn",
    message: `${trade.sourceTicker} ${occSymbol} — MARKET sell_to_close ${qty}× (force-exit, order ${sub.data.id})`,
    tradeId: trade.id,
    data: {
      orderId: String(sub.data.id),
      occSymbol,
      qty,
      reason: "day_trade_force_exit",
    },
  });
  return {
    tradeId: trade.id,
    ticker: trade.sourceTicker,
    prevStatus: "open",
    newStatus: "closing",
    outcome: "market_close_submitted",
  };
}

/**
 * The trade is in `closing` — earlier in the day a target / stop / time_stop
 * fired and submitted a limit exit that hasn't filled. By 15:55 we know the
 * day's almost over; cancel the limit and replace with a MARKET close so
 * the position doesn't ride overnight.
 *
 * Status stays `closing` — only the order behind it changes. The reconcile
 * pass picks up the market fill on the next tick.
 */
async function replaceClosingLimitWithMarket(
  trade: BotTrade,
  cfg: BotConfig,
): Promise<ForceExitOutcome> {
  if (!trade.tradierOrderId) {
    // No broker order on file (shouldn't happen for a closing row, but if
    // somehow we got here, just submit a fresh market close).
    return submitClosingMarketReplacement(trade, cfg, null);
  }
  const cancel = await cancelOrder(cfg.mode, trade.tradierOrderId);
  if (!cancel.ok) {
    // Couldn't cancel. The limit may have just filled, OR Tradier is down.
    // Log and move on — next reconcile will catch the actual outcome.
    await logTape({
      kind: "error",
      severity: "warn",
      message: `${trade.sourceTicker} — force-exit cancel of closing limit ${trade.tradierOrderId} failed: ${cancel.reason}`,
      tradeId: trade.id,
      data: { orderId: trade.tradierOrderId, code: cancel.code },
    });
    return {
      tradeId: trade.id,
      ticker: trade.sourceTicker,
      prevStatus: "closing",
      newStatus: "closing",
      outcome: "error",
      reason: cancel.reason,
    };
  }
  return submitClosingMarketReplacement(trade, cfg, trade.tradierOrderId);
}

async function submitClosingMarketReplacement(
  trade: BotTrade,
  cfg: BotConfig,
  cancelledOrderId: string | null,
): Promise<ForceExitOutcome> {
  // Resolve order args — stock legs are simple, options need OCC resolution.
  const leg = (trade.legs as Array<Record<string, unknown>>)[0];
  const isStockLeg = (leg as Record<string, unknown>)?.instrument === "stock";
  const legQty = ((leg?.qty as number) ?? 1) || 1;

  // M3: If the just-cancelled closing limit had partially filled, only
  // close the remaining qty — otherwise we over-close into a phantom
  // short. Best-effort: query the cancelled order's exec_quantity.
  let qty = legQty;
  if (cancelledOrderId) {
    try {
      const orderStatus = await getOrderStatus(cfg.mode, cancelledOrderId);
      if (orderStatus.ok && orderStatus.data) {
        const execQty = orderStatus.data.exec_quantity;
        if (typeof execQty === "number" && execQty > 0 && execQty < legQty) {
          qty = legQty - execQty;
          await logTape({
            kind: "force_exit",
            severity: "info",
            message: `${trade.sourceTicker} — closing limit ${cancelledOrderId} partially filled ${execQty}/${legQty}; market replacement sized to remaining ${qty}`,
            tradeId: trade.id,
            data: { cancelledOrderId, execQty, legQty, remainingQty: qty },
          });
        }
      }
    } catch (e) {
      // If we can't read the cancelled order, fall back to full leg qty.
      // Worst case: we over-close by the small partially-filled amount.
      await logTape({
        kind: "error",
        severity: "warn",
        message: `${trade.sourceTicker} — could not check cancelled order partial-fill state: ${String(e)}. Using full leg.qty for replacement.`,
        tradeId: trade.id,
      });
    }
  }

  let orderArgs: Parameters<typeof submitOrder>[1];
  let occSymbol: string;
  if (isStockLeg) {
    occSymbol = trade.sourceTicker.toUpperCase();
    // Short positions cover via buy_to_cover, longs sell.
    const isShortPos = trade.strategy === "short_stock";
    orderArgs = {
      instrument: "stock",
      underlying: trade.sourceTicker,
      side: isShortPos ? "buy_to_cover" : "sell",
      quantity: qty,
      type: "market",
      duration: "day",
    };
  } else {
    let occ = (leg?.occ_symbol as string | null) ?? null;
    if (!occ) {
      const r = resolveOcc(trade);
      if (!r.ok) {
        await logTape({
          kind: "error",
          severity: "error",
          message: `${trade.sourceTicker} — force-exit closing replacement skipped: ${r.reason}`,
          tradeId: trade.id,
          data: { reason: r.reason },
        });
        return {
          tradeId: trade.id,
          ticker: trade.sourceTicker,
          prevStatus: "closing",
          newStatus: "closing",
          outcome: "skipped_no_occ",
          reason: r.reason,
        };
      }
      occ = r.occSymbol;
    }
    occSymbol = occ;
    orderArgs = {
      instrument: "option",
      underlying: trade.sourceTicker,
      optionSymbol: occSymbol,
      side: "sell_to_close",
      quantity: qty,
      type: "market",
      duration: "day",
    };
  }

  const sub = await submitOrder(cfg.mode, orderArgs);
  if (!sub.ok) {
    await logTape({
      kind: "error",
      severity: "error",
      message: `${trade.sourceTicker} — force-exit closing replacement submit failed: ${sub.reason}`,
      tradeId: trade.id,
      data: { code: sub.code, reason: sub.reason },
    });
    return {
      tradeId: trade.id,
      ticker: trade.sourceTicker,
      prevStatus: "closing",
      newStatus: "closing",
      outcome: "error",
      reason: sub.reason,
    };
  }

  // Update tradierOrderId to the new market order. Status stays "closing".
  await db
    .update(botTrades)
    .set({ tradierOrderId: String(sub.data.id) })
    .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "closing")));

  await logTape({
    kind: "force_exit",
    severity: "warn",
    message: `${trade.sourceTicker} ${occSymbol} — closing limit ${cancelledOrderId ?? "?"} replaced with MARKET sell_to_close (force-exit, order ${sub.data.id})`,
    tradeId: trade.id,
    data: {
      cancelledOrderId,
      newOrderId: String(sub.data.id),
      occSymbol,
      qty,
      reason: "day_trade_force_exit_replace_closing",
    },
  });

  return {
    tradeId: trade.id,
    ticker: trade.sourceTicker,
    prevStatus: "closing",
    newStatus: "closing",
    outcome: "closing_limit_replaced_with_market",
  };
}

async function logTape(opts: {
  kind: typeof botActions.$inferInsert.kind;
  severity: string;
  message: string;
  tradeId?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(botActions).values({
    kind: opts.kind,
    severity: opts.severity,
    message: opts.message,
    tradeId: opts.tradeId,
    data: opts.data ?? {},
  });
}
