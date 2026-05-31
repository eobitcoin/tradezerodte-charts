/**
 * LEAP pick marks — daily snapshot of every open pick's current price.
 *
 * Drives the Performance section on /research/leaps. Each tick fetches
 * the contract snapshot from Polygon for every leap_pick whose expiry
 * is still in the future, and appends a row to leap_pick_marks.
 */

import { gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leapPicks, leapPickMarks } from "@/lib/db/schema";
import { fetchContractSnapshot } from "@/lib/polygon";
import { nyTradingDay } from "@/lib/trading-day";

export interface MarkResult {
  scanned: number;
  marked: number;
  skipped: number;
  failed: number;
  errors: Array<{ contractTicker: string; message: string }>;
}

/**
 * Walk every leap_pick whose expiration_date is still in the future,
 * fetch the contract snapshot from Polygon, and append a mark row.
 *
 * Throttle: 250ms between calls. With ~10-30 open picks at steady
 * state, total runtime is under 10s.
 *
 * Returns counts + a list of errors for the cron response.
 */
export async function markOpenLeapPicks(opts: {
  perCallDelayMs?: number;
} = {}): Promise<MarkResult> {
  const perCallDelayMs = opts.perCallDelayMs ?? 250;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const today = nyTradingDay();

  const open = await db
    .select()
    .from(leapPicks)
    .where(gt(leapPicks.expirationDate, today));

  let marked = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ contractTicker: string; message: string }> = [];

  let first = true;
  for (const pick of open) {
    if (!first) await sleep(perCallDelayMs);
    first = false;

    try {
      const snap = await fetchContractSnapshot(pick.ticker, pick.contractTicker);
      if (!snap) {
        skipped++;
        continue;
      }
      const bid = snap.last_quote?.bid;
      const ask = snap.last_quote?.ask;
      const mid =
        typeof bid === "number" && typeof ask === "number" && ask > bid
          ? (bid + ask) / 2
          : null;

      // Spot from underlying_asset (equities) — index picks would
      // need a separate lookup but LEAP_WATCHLIST has none yet.
      const spot = snap.underlying_asset?.price ?? null;

      await db.insert(leapPickMarks).values({
        leapPickId: pick.id,
        underlyingPrice: spot?.toString() ?? null,
        premiumMid: mid?.toString() ?? null,
        premiumBid: typeof bid === "number" ? bid.toString() : null,
        premiumAsk: typeof ask === "number" ? ask.toString() : null,
        iv: snap.implied_volatility?.toString() ?? null,
        delta: snap.greeks?.delta?.toString() ?? null,
        openInterest: snap.open_interest ?? null,
      });
      marked++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed++;
      errors.push({ contractTicker: pick.contractTicker, message });
    }
  }

  return {
    scanned: open.length,
    marked,
    skipped,
    failed,
    errors,
  };
}

/**
 * Read helper: for a given list of leap_pick IDs, return the most
 * recent mark per pick. Used by the Performance view to compute P&L
 * vs entry without an N+1 round-trip per pick.
 *
 * One SQL trip with DISTINCT ON (leap_pick_id) — newest first.
 */
export async function fetchLatestMarksForPicks(
  pickIds: string[],
): Promise<Map<string, {
  premiumMid: number | null;
  underlyingPrice: number | null;
  markTs: Date;
  iv: number | null;
  delta: number | null;
}>> {
  const out = new Map<string, {
    premiumMid: number | null;
    underlyingPrice: number | null;
    markTs: Date;
    iv: number | null;
    delta: number | null;
  }>();
  if (pickIds.length === 0) return out;

  const rows = await db
    .selectDistinctOn([leapPickMarks.leapPickId], {
      leapPickId: leapPickMarks.leapPickId,
      premiumMid: leapPickMarks.premiumMid,
      underlyingPrice: leapPickMarks.underlyingPrice,
      markTs: leapPickMarks.markTs,
      iv: leapPickMarks.iv,
      delta: leapPickMarks.delta,
    })
    .from(leapPickMarks)
    .where(sql`${leapPickMarks.leapPickId} = ANY(${sql.raw(`ARRAY[${pickIds.map((id) => `'${id}'::uuid`).join(",")}]`)})`)
    .orderBy(leapPickMarks.leapPickId, sql`${leapPickMarks.markTs} DESC`);

  for (const r of rows) {
    out.set(r.leapPickId, {
      premiumMid: r.premiumMid ? Number(r.premiumMid) : null,
      underlyingPrice: r.underlyingPrice ? Number(r.underlyingPrice) : null,
      markTs: r.markTs,
      iv: r.iv ? Number(r.iv) : null,
      delta: r.delta ? Number(r.delta) : null,
    });
  }
  return out;
}
