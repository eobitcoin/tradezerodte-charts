/**
 * Broker-side reconciliation.
 *
 * Cross-checks the bot's DB state against Tradier's authoritative state on
 * every tick. Catches four classes of drift:
 *
 *   1. STUCK SUBMITTING — rows in `bot_trades.status='submitting'` that have
 *      been there longer than the stuck-threshold (typically because the
 *      process died between POST and the commit UPDATE). For each stuck row:
 *        - Look up Tradier's recent orders for a match on OCC + side.
 *        - If found → attach `tradierOrderId`, transition `submitting → working`.
 *        - If not found → release `submitting → signal_fired` so retry happens.
 *
 *   2. EXTERNALLY CLOSED — rows in `bot_trades.status='open'` whose OCC is
 *      no longer in Tradier's positions list (admin closed the position
 *      manually on the broker side). Transitions `open → closed` and
 *      best-effort attaches realizedPnlUsd from Tradier's gainloss.
 *
 *   3. ORPHAN ORDERS — Tradier has open/working/filled orders we don't know
 *      about. Logged as warning events; not auto-cancelled (the account may
 *      be used for manual trades too).
 *
 *   4. ORPHAN POSITIONS — Tradier has open positions we don't track in
 *      `bot_trades`. Logged as warning. Not auto-closed.
 *
 * The first two are corrective (touch DB state). The last two are
 * informational safety nets.
 */

import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { botActions, botTrades, type BotConfig } from "@/lib/db/schema";
import { getAccountOrders, getGainLoss, getPositions, type TradierClosedPosition } from "./tradier-adapter";
import { resolveOcc } from "./occ";

const STUCK_SUBMITTING_THRESHOLD_MS = 60_000; // 1 minute is plenty for a POST
// Settling window after a fresh fill before we'll consider an `open` trade
// "externally closed". Tradier sometimes lags 5-15s between order-fill and
// position-list update; we don't want to false-positive on a freshly opened
// trade whose position hasn't materialized yet.
const OPEN_SETTLING_MS = 90_000;

export type ReconcileOutcome = {
  ranAt: string;
  recoveredStuck: Array<{
    tradeId: string;
    ticker: string;
    action: "attached" | "released";
    orderId?: string;
    reason?: string;
  }>;
  externallyClosed: Array<{
    tradeId: string;
    ticker: string;
    occ: string;
    realizedPnlUsd: number | null;
    matchedGainloss: boolean;
  }>;
  orphanOrders: Array<{
    tradierOrderId: string;
    symbol: string | undefined;
    status: string;
    side: string;
    quantity: number;
  }>;
  orphanPositions: Array<{ symbol: string; quantity: number; costBasis: number }>;
  errors: string[];
};

export async function reconcileWithBroker(cfg: BotConfig): Promise<ReconcileOutcome> {
  const out: ReconcileOutcome = {
    ranAt: new Date().toISOString(),
    recoveredStuck: [],
    externallyClosed: [],
    orphanOrders: [],
    orphanPositions: [],
    errors: [],
  };

  // Pull Tradier's view in parallel.
  const [ordersRes, positionsRes] = await Promise.all([
    getAccountOrders(cfg.mode),
    getPositions(cfg.mode),
  ]);

  if (!ordersRes.ok) out.errors.push(`getAccountOrders: ${ordersRes.reason}`);
  if (!positionsRes.ok) out.errors.push(`getPositions: ${positionsRes.reason}`);

  const tradierOrders = ordersRes.ok ? ordersRes.data : [];
  const tradierPositions = positionsRes.ok ? positionsRes.data : [];

  // --- 1. STUCK SUBMITTING RECOVERY ---------------------------------------
  // Any row in `submitting` older than the threshold is presumed to have
  // crashed between claim and commit.
  const stuckCutoff = new Date(Date.now() - STUCK_SUBMITTING_THRESHOLD_MS);
  const stuck = await db
    .select()
    .from(botTrades)
    .where(
      and(
        eq(botTrades.status, "submitting"),
        // submittingAt is set when status flipped to submitting; older = stuck.
        lt(botTrades.submittingAt, stuckCutoff),
      ),
    );

  for (const trade of stuck) {
    const leg = (trade.legs as Array<Record<string, unknown>>)[0];
    const isStockLeg = (leg as Record<string, unknown>)?.instrument === "stock";
    // For options we match on OCC; for stocks on underlying ticker.
    let occ: string | null = null;
    if (isStockLeg) {
      occ = trade.sourceTicker.toUpperCase();
    } else {
      occ = (leg?.occ_symbol as string | null) ?? null;
      if (!occ) {
        const r = resolveOcc(trade);
        if (r.ok) occ = r.occSymbol;
      }
    }
    if (!occ) {
      // Can't match — release and let next tick try again. Better than
      // leaving stuck.
      await db
        .update(botTrades)
        .set({ status: "signal_fired" })
        .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "submitting")));
      out.recoveredStuck.push({
        tradeId: trade.id,
        ticker: trade.sourceTicker,
        action: "released",
        reason: "no OCC to match Tradier orders against",
      });
      await logTape({
        kind: "error",
        severity: "warn",
        message: `${trade.sourceTicker} — stuck 'submitting' released (no OCC for broker match)`,
        tradeId: trade.id,
        data: { tradeId: trade.id },
      });
      continue;
    }

    // Look for a recent Tradier order matching this trade.
    //  - Options: match on option_symbol + side = "buy_to_open".
    //  - Stocks long: match on (top-level) symbol + side = "buy".
    //  - Stocks short: same but side = "sell_short".
    //
    // M2: Qty equality dropped from the match condition. OCC + side + recent
    // create_date is uniquely-enough — if the row was re-pegged before the
    // crash, the leg.qty would have changed too and the strict-equality match
    // would have missed it, causing a duplicate POST on the next tick.
    const isShortLeg = isStockLeg && (trade.strategy === "short_stock" || (leg as Record<string, unknown>)?.side === "sell_short");
    const expectedEquitySide = isShortLeg ? "sell_short" : "buy";
    const matches = isStockLeg
      ? tradierOrders.filter(
          (o) =>
            o.symbol === occ &&
            o.class === "equity" &&
            o.side === expectedEquitySide,
        )
      : tradierOrders.filter(
          (o) =>
            o.option_symbol === occ &&
            o.side === "buy_to_open",
        );
    // Prefer the most recently created match (Tradier IDs increase monotonically).
    matches.sort(
      (a, b) =>
        new Date(b.create_date ?? 0).getTime() - new Date(a.create_date ?? 0).getTime(),
    );
    const found = matches[0];

    if (found) {
      // Attach the orderId and resume normal lifecycle. reconcileWorkingOrders
      // (called later in the tick) will pick up the fill status next.
      const updated = await db
        .update(botTrades)
        .set({
          status: "working",
          tradierOrderId: String(found.id),
          submittedAt: trade.submittedAt ?? new Date(),
        })
        .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "submitting")))
        .returning({ id: botTrades.id });
      if (updated.length > 0) {
        out.recoveredStuck.push({
          tradeId: trade.id,
          ticker: trade.sourceTicker,
          action: "attached",
          orderId: String(found.id),
        });
        await logTape({
          kind: "order_submitted",
          severity: "warn",
          message: `${trade.sourceTicker} — stuck 'submitting' recovered: attached Tradier order ${found.id}. (Process likely crashed between submit and commit.)`,
          tradeId: trade.id,
          data: { tradierOrderId: String(found.id), recovery: true, occ },
        });
      }
    } else {
      // No matching order at Tradier → the POST never happened or was
      // rejected before assigning an ID. Release the claim for retry.
      const updated = await db
        .update(botTrades)
        .set({ status: "signal_fired" })
        .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, "submitting")))
        .returning({ id: botTrades.id });
      if (updated.length > 0) {
        out.recoveredStuck.push({
          tradeId: trade.id,
          ticker: trade.sourceTicker,
          action: "released",
          reason: "no matching Tradier order; releasing claim for retry",
        });
        await logTape({
          kind: "risk_block",
          severity: "warn",
          message: `${trade.sourceTicker} — stuck 'submitting' released, no Tradier order found for ${occ}. Next tick will retry.`,
          tradeId: trade.id,
          data: { occ },
        });
      }
    }
  }

  // --- 2. POSITION-GONE TRADES (open + closing) ---------------------------
  // For every trade we believe is live (`open` or `closing`), check whether
  // Tradier still has the underlying option position. Two cases mark a
  // trade closed:
  //
  //   - `open` trade, position gone: admin closed it manually at the broker,
  //     OR (most commonly for 0DTE) the option expired and Tradier dropped it.
  //
  //   - `closing` trade, position gone: our exit order completed but the
  //     normal order-status path (`reconcileWorkingOrders`) didn't catch it.
  //     Typical reasons: 0DTE expired worthless before our limit was filled,
  //     Tradier auto-cancelled the exit at EOD with the position already
  //     gone, or the orderId went stale and order-fetch returns "missing".
  //
  // Both paths attach realized P&L from Tradier's gainloss when we can find
  // a matching row. The race-safe update preserves whatever status we read.
  if (positionsRes.ok) {
    const liveTrades = await db
      .select()
      .from(botTrades)
      .where(inArray(botTrades.status, ["open", "closing"]));

    // Skip if nothing to check — saves a Tradier gainloss call.
    if (liveTrades.length > 0) {
      const positionOccs = new Set<string>();
      for (const p of tradierPositions) {
        if (p.quantity !== 0) positionOccs.add(p.symbol);
      }
      const settlingCutoff = new Date(Date.now() - OPEN_SETTLING_MS);

      // Pull today's + yesterday's gainloss so we can attach P&L. One call.
      let gainlossRows: TradierClosedPosition[] = [];
      const start = ymdDaysAgo(2);
      const end = ymdDaysAgo(0);
      const glRes = await getGainLoss(cfg.mode, { start, end });
      if (glRes.ok) gainlossRows = glRes.data;
      else out.errors.push(`gainloss (for external-close): ${glRes.reason}`);

      for (const trade of liveTrades) {
        const priorStatus = trade.status; // "open" or "closing"

        // For `open` trades, don't false-positive a freshly filled entry
        // still propagating to Tradier's positions feed. `closing` trades
        // have already been live for a tick, no settling guard needed.
        if (
          priorStatus === "open" &&
          trade.filledAt &&
          new Date(trade.filledAt).getTime() > settlingCutoff.getTime()
        ) {
          continue;
        }
        const leg = (trade.legs as Array<Record<string, unknown>>)[0];
        let occ: string | null = (leg?.occ_symbol as string | null) ?? null;
        if (!occ) {
          const r = resolveOcc(trade);
          if (r.ok) occ = r.occSymbol;
        }
        if (!occ) continue; // can't match without an OCC

        // Tradier confirms the position is still there → nothing to do.
        if (positionOccs.has(occ)) continue;

        // Position is gone. Try to find a matching gainloss row to compute P&L.
        // Match by symbol; prefer the most recent close.
        const matches = gainlossRows
          .filter((g) => g.symbol === occ)
          .sort(
            (a, b) =>
              new Date(b.close_date ?? 0).getTime() - new Date(a.close_date ?? 0).getTime(),
          );
        const match = matches[0];
        const realizedPnlUsd =
          match && Number.isFinite(match.gain_loss) ? Number(match.gain_loss) : null;
        const exitFillUsd =
          match && Number.isFinite(match.proceeds) && Number.isFinite(match.quantity) && match.quantity !== 0
            ? Number(match.proceeds) / Math.abs(match.quantity) / 100
            : null;
        const closedAt = match?.close_date ? new Date(match.close_date) : new Date();

        // Race-safe transition → closed. The WHERE clause guards against
        // anything else (force-exit, reconcileWorkingOrders, manual close)
        // winning the race; if it did, leave the new state alone.
        const updated = await db
          .update(botTrades)
          .set({
            status: "closed",
            closedAt,
            realizedPnlUsd: realizedPnlUsd != null ? realizedPnlUsd.toFixed(2) : null,
            exitFillUsd: exitFillUsd != null ? exitFillUsd.toFixed(4) : null,
          })
          .where(and(eq(botTrades.id, trade.id), eq(botTrades.status, priorStatus)))
          .returning({ id: botTrades.id });

        if (updated.length === 0) continue;

        out.externallyClosed.push({
          tradeId: trade.id,
          ticker: trade.sourceTicker,
          occ,
          realizedPnlUsd,
          matchedGainloss: !!match,
        });
        const sweptFromClosing = priorStatus === "closing";
        await logTape({
          kind: "force_exit",
          severity: realizedPnlUsd != null && realizedPnlUsd < 0 ? "warn" : "info",
          message: sweptFromClosing
            ? `${trade.sourceTicker} ${occ} — closing → closed via reconcile (exit completed; order-status path didn't catch it)${
                match
                  ? `. Matched gainloss: P&L ${realizedPnlUsd! >= 0 ? "+" : ""}$${realizedPnlUsd!.toFixed(2)}.`
                  : ". No matching gainloss row found yet — P&L unknown."
              }`
            : `${trade.sourceTicker} ${occ} — position closed externally at Tradier${
                match
                  ? `. Matched gainloss: P&L ${realizedPnlUsd! >= 0 ? "+" : ""}$${realizedPnlUsd!.toFixed(2)}.`
                  : ". No matching gainloss row found yet — P&L unknown; check Tradier."
              }`,
          tradeId: trade.id,
          data: {
            occ,
            externalClose: !sweptFromClosing,
            sweptFromClosing,
            matchedGainloss: !!match,
            realizedPnlUsd,
            exitFillUsd,
            tradierMatch: match
              ? {
                  close_date: match.close_date,
                  proceeds: match.proceeds,
                  cost: match.cost,
                  quantity: match.quantity,
                  gain_loss: match.gain_loss,
                  gain_loss_percent: match.gain_loss_percent,
                }
              : null,
          },
        });
      }
    }
  }

  // --- 3. ORPHAN ORDER DETECTION ------------------------------------------
  // Any Tradier order on this account whose ID isn't tracked in `bot_trades`.
  // Conservative: log only. We don't auto-cancel because the user may also
  // be trading the same account manually.
  if (ordersRes.ok && tradierOrders.length > 0) {
    const dbOrderIds = await db
      .select({ id: botTrades.tradierOrderId })
      .from(botTrades)
      .where(inArray(botTrades.status, ["working", "submitting", "open", "closing"]));
    const knownOrderIds = new Set(
      dbOrderIds.map((r) => r.id).filter((id): id is string => !!id),
    );

    const interestingStatuses = new Set(["open", "pending", "partially_filled"]);
    for (const o of tradierOrders) {
      const idStr = String(o.id);
      if (knownOrderIds.has(idStr)) continue;
      if (!interestingStatuses.has(String(o.status).toLowerCase())) continue;
      out.orphanOrders.push({
        tradierOrderId: idStr,
        symbol: o.option_symbol,
        status: String(o.status),
        side: String(o.side),
        quantity: o.quantity,
      });
    }
    if (out.orphanOrders.length > 0) {
      await logTape({
        kind: "error",
        severity: "warn",
        message: `Broker reconcile: ${out.orphanOrders.length} working Tradier order(s) not in DB. Manual review suggested.`,
        data: { orphans: out.orphanOrders },
      });
    }
  }

  // --- 4. ORPHAN POSITION DETECTION ---------------------------------------
  if (positionsRes.ok && tradierPositions.length > 0) {
    const dbOcc = await db
      .select({ legs: botTrades.legs })
      .from(botTrades)
      .where(inArray(botTrades.status, ["working", "submitting", "open", "closing"]));
    const knownOcc = new Set<string>();
    for (const row of dbOcc) {
      const legs = (row.legs as Array<Record<string, unknown>>) ?? [];
      for (const l of legs) {
        if (typeof l?.occ_symbol === "string") knownOcc.add(l.occ_symbol);
      }
    }
    for (const p of tradierPositions) {
      if (p.quantity === 0) continue; // Tradier briefly reports 0-qty mid-close
      if (knownOcc.has(p.symbol)) continue;
      out.orphanPositions.push({
        symbol: p.symbol,
        quantity: p.quantity,
        costBasis: p.cost_basis,
      });
    }
    if (out.orphanPositions.length > 0) {
      await logTape({
        kind: "error",
        severity: "warn",
        message: `Broker reconcile: ${out.orphanPositions.length} Tradier position(s) not tracked in DB. Manual review suggested.`,
        data: { orphans: out.orphanPositions },
      });
    }
  }

  return out;
}

/** YYYY-MM-DD for "today − n days" in America/New_York. */
function ymdDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
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

