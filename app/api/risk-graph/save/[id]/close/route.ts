import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  tradeIdeas,
  type TradeIdeaLeg,
  type TradeIdeaClosingLeg,
} from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { fetchContractSnapshot } from "@/lib/polygon";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * POST /api/risk-graph/save/[id]/close
 *
 * Closes a saved trade idea at current market prices and books a
 * realized P&L. Walks each leg, fetches the contract snapshot from
 * Polygon, computes the closing mid (or falls back to bid/ask), and
 * sums the per-leg P&Ls into a total realized number.
 *
 * Per-leg P&L formula:
 *   sign × qty × 100 × (closeMid − entryPrice)
 * where sign = +1 for long, −1 for short. The sign captures direction:
 * long calls gain when price rises (close > entry); short calls gain
 * when price falls (close < entry).
 *
 * Auth-gated; any signed-in user can close. Idempotent at the trade
 * level — a second close call on the same idea returns 409.
 *
 * Returns:
 *   200 { ok: true, realizedPnl, closingLegs }
 *   400 { error }   — malformed id or empty legs
 *   401 { error }   — not signed in
 *   404 { error }   — trade not found
 *   409 { error }   — already closed
 *   502 { error }   — Polygon couldn't price one or more legs
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const [trade] = await db
    .select()
    .from(tradeIdeas)
    .where(eq(tradeIdeas.id, id))
    .limit(1);
  if (!trade) {
    return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  }
  if (trade.status !== "open") {
    return NextResponse.json(
      { error: `Trade is already ${trade.status}` },
      { status: 409 },
    );
  }

  const legs = trade.legs as TradeIdeaLeg[];
  if (!Array.isArray(legs) || legs.length === 0) {
    return NextResponse.json({ error: "Trade has no legs" }, { status: 400 });
  }

  // Price every leg via the contract snapshot endpoint. A single
  // unpriceable leg fails the whole close — the user can retry after
  // the chain refreshes (or unwind the legs manually on their broker).
  const closingLegs: TradeIdeaClosingLeg[] = [];
  let realized = 0;
  const failures: string[] = [];

  for (const leg of legs) {
    if (!leg.contractTicker) {
      failures.push(`(${leg.type} ${leg.strike} ${leg.expiration}: no contract ticker)`);
      continue;
    }
    const snap = await fetchContractSnapshot(trade.ticker, leg.contractTicker).catch(
      () => null,
    );
    if (!snap) {
      failures.push(leg.contractTicker);
      continue;
    }
    const bid = snap.last_quote?.bid ?? null;
    const ask = snap.last_quote?.ask ?? null;
    const mid =
      typeof bid === "number" &&
      typeof ask === "number" &&
      ask >= bid &&
      ask > 0
        ? (bid + ask) / 2
        : null;

    // Fall back: prefer mid → ask (worst long fill) → bid (worst short fill).
    // Closing is "the other side": long closes by selling (gets bid), short
    // closes by buying (pays ask). We use mid when available because it's a
    // reasonable estimate without assuming who's the price-taker.
    const closePrice = mid ?? bid ?? ask;
    if (closePrice == null) {
      failures.push(leg.contractTicker);
      continue;
    }

    const sign = leg.side === "long" ? +1 : -1;
    const legPnl = sign * leg.qty * 100 * (closePrice - leg.entryPrice);
    realized += legPnl;

    closingLegs.push({
      contractTicker: leg.contractTicker,
      closePrice,
      closeBid: bid,
      closeAsk: ask,
      closeIv: snap.implied_volatility ?? null,
      legPnl,
    });
  }

  if (failures.length > 0) {
    return NextResponse.json(
      {
        error: `Could not price ${failures.length} leg(s): ${failures.join(", ")}. Try again in a few minutes.`,
      },
      { status: 502 },
    );
  }

  await db
    .update(tradeIdeas)
    .set({
      status: "closed",
      closedAt: new Date(),
      closingLegs,
      realizedPnl: realized.toFixed(2),
      updatedAt: sql`now()`,
    })
    .where(eq(tradeIdeas.id, id));

  return NextResponse.json({
    ok: true,
    realizedPnl: realized,
    closingLegs,
  });
}
