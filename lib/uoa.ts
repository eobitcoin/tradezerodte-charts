/**
 * Unusual Options Activity (UOA) scanner.
 *
 * Walks the watchlist, pulls each ticker's option chain, identifies
 * contracts with elevated day-volume vs prior-day OI, fetches their
 * trade tape, filters to "smart money" prints, classifies aggressor
 * side, and persists the survivors to uoa_prints. The daily cron then
 * snapshots the top N into a uoa_scans row that the page renders.
 *
 * Filter bar (the "unusual" definition):
 *   1. Premium ≥ $50,000  (size × price × 100)
 *   2. OI multiplier ≥ 3× (size > 3 × prior-day OI for that contract)
 *   3. Clear aggressor    (price within 1c of bid OR ask; midmarket
 *                         fills are dropped — they don't carry signal)
 *
 * Universe: reuses OPTIONS_EDGE_WATCHLIST (25 tickers). Same Polygon
 * API surface as the IV snapshot cron, same rate-limit profile.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import {
  uoaPrints,
  uoaScans,
  type UoaClassification,
  type UoaPrintSummary,
} from "@/lib/db/schema";
import {
  fetchOptionChain,
  fetchOptionTrades,
  classifyAggressor,
  isSweep,
} from "@/lib/polygon";
import { OPTIONS_EDGE_WATCHLIST } from "@/lib/iv-analysis";
import { nyTradingDay } from "@/lib/trading-day";

const NY_TZ = "America/New_York";

/** Format a JS Date as the NY-tz calendar date (YYYY-MM-DD). */
function nyDateOf(d: Date): string {
  return formatInTimeZone(d, NY_TZ, "yyyy-MM-dd");
}

/**
 * Pick the most-common NY-tz date among an array of trade prints.
 * Used to derive scan_day from the data itself — on a weekday production
 * run this matches today's NY date; on a weekend smoke test it matches
 * Friday (the most recent actual session). Falls back to today's NY
 * date when there are no prints at all.
 */
function dominantNyDate(prints: UoaPrintSummary[], fallback: string): string {
  if (prints.length === 0) return fallback;
  const counts = new Map<string, number>();
  for (const p of prints) {
    const d = nyDateOf(new Date(p.printTs));
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best = fallback;
  let bestN = 0;
  for (const [d, n] of counts) {
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

/** Reuse the Options Edge 25 — same Polygon usage profile. */
export const UOA_WATCHLIST = OPTIONS_EDGE_WATCHLIST;

/** Minimum total notional for a print to clear the bar. */
export const MIN_PREMIUM_USD = 50_000;

/** Minimum size-vs-OI multiplier. 3× means the print is at least 3
 *  times the prior day's open interest on that exact strike/expiry. */
export const MIN_OI_MULTIPLIER = 3;

/** Skip contracts whose day-volume is below this — keeps the trades
 *  endpoint call count bounded. A contract with <500 day-volume can't
 *  produce a $50k+ print at reasonable prices. */
const MIN_CONTRACT_DAY_VOLUME = 500;

/** Don't fetch trades for more than this many contracts per ticker.
 *  The chain returns the highest-volume contracts first when we sort. */
const MAX_CONTRACTS_PER_TICKER = 20;

/**
 * Classify a print as bullish/bearish based on side + contract type.
 *
 *   buy call  → bullish_call_buy
 *   buy put   → bearish_put_buy
 *   sell call → call_sell      (short call — typically bearish or
 *                                covered)
 *   sell put  → put_sell       (short put — typically bullish or
 *                                cash-secured)
 *
 * "ambiguous" aggressor side returns "ambiguous" classification.
 */
function classifyPrint(
  side: "buy" | "sell" | "ambiguous",
  contractType: "call" | "put",
): UoaClassification {
  if (side === "ambiguous") return "ambiguous";
  if (side === "buy" && contractType === "call") return "bullish_call_buy";
  if (side === "buy" && contractType === "put") return "bearish_put_buy";
  if (side === "sell" && contractType === "call") return "call_sell";
  return "put_sell";
}

/** Result shape from runUoaScan(). */
export interface UoaScanResult {
  scanDay: string;
  universeSize: number;
  printsWritten: number;
  printsSurviving: number;
  topPrints: UoaPrintSummary[];
  tickersWithPrints: string[];
  errors: Array<{ ticker: string; message: string }>;
}

/**
 * Walk the watchlist, run the scan, persist filtered prints, return
 * a structured summary. Used by both the EOD daily cron and the
 * intraday 5-min cron — the intraday variant just passes a tighter
 * time window via `tsGteNs`.
 *
 * `tsGteNs` (optional) — when set, only fetch trades after this
 * nanosecond timestamp. Used by the 5-min intraday cron to scope
 * the trades endpoint to the last window.
 *
 * `perTickerDelayMs` (default 600) — sleep between tickers to stay
 * under Polygon's per-minute cap. Mirrors the IV snapshot cron.
 */
export async function runUoaScan(opts: {
  tsGteNs?: number;
  perTickerDelayMs?: number;
  topN?: number;
} = {}): Promise<UoaScanResult> {
  const perTickerDelayMs = opts.perTickerDelayMs ?? 600;
  const topN = opts.topN ?? 25;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const tickersWithPrints: string[] = [];
  const errors: Array<{ ticker: string; message: string }> = [];
  let printsWritten = 0;
  const allSurviving: UoaPrintSummary[] = [];

  let first = true;
  for (const ticker of UOA_WATCHLIST) {
    if (!first) await sleep(perTickerDelayMs);
    first = false;

    try {
      // 1. Pull the chain. Filter to contracts with non-trivial volume.
      const chain = await fetchOptionChain(ticker);
      const candidates = chain
        .filter((c) => (c.day?.volume ?? 0) >= MIN_CONTRACT_DAY_VOLUME)
        .sort((a, b) => (b.day?.volume ?? 0) - (a.day?.volume ?? 0))
        .slice(0, MAX_CONTRACTS_PER_TICKER);

      if (candidates.length === 0) continue;

      const underlyingPrice = candidates[0].underlying_asset?.price ?? null;

      // 2. For each candidate contract, pull its trades. Throttle
      //    sub-loop too — high-volume tickers (SPY) can have 20 hot
      //    contracts so we can't hammer.
      for (const contract of candidates) {
        await sleep(120);
        const contractTicker = contract.details.ticker;
        const trades = await fetchOptionTrades(contractTicker, {
          tsGteNs: opts.tsGteNs,
          limit: 1000,
          maxPages: 3,
        });
        if (trades.length === 0) continue;

        const bid = contract.last_quote?.bid ?? null;
        const ask = contract.last_quote?.ask ?? null;
        const priorDayOi = contract.open_interest ?? null;

        for (const t of trades) {
          // Premium filter — cheap rejection before the math.
          const premium = t.price * t.size * 100;
          if (premium < MIN_PREMIUM_USD) continue;

          // OI multiplier filter.
          let oiMult: number | null = null;
          if (priorDayOi && priorDayOi > 0) {
            oiMult = t.size / priorDayOi;
            if (oiMult < MIN_OI_MULTIPLIER) continue;
          } else {
            // No OI baseline — accept only if premium is very large
            // (a meaningful print regardless of OI).
            if (premium < MIN_PREMIUM_USD * 4) continue;
          }

          // Aggressor classification. Drop midmarket fills.
          const side = classifyAggressor(t.price, bid, ask);
          if (side === "ambiguous") continue;

          const classification = classifyPrint(side, contract.details.contract_type);
          const printTs = t.participant_timestamp
            ? new Date(t.participant_timestamp / 1e6)
            : t.sip_timestamp
              ? new Date(t.sip_timestamp / 1e6)
              : null;
          if (!printTs || isNaN(printTs.getTime())) continue;

          const pctFromSpot = underlyingPrice
            ? ((contract.details.strike_price - underlyingPrice) / underlyingPrice) * 100
            : null;

          // 3. UPSERT-by-natural-key. The unique index
          //    (contract_ticker, print_ts, size, price) dedupes against
          //    the EOD cron re-fetching trades the intraday cron
          //    already wrote. On conflict, do nothing.
          try {
            await db
              .insert(uoaPrints)
              .values({
                printTs,
                underlying: ticker,
                contractTicker,
                expirationDate: contract.details.expiration_date,
                strike: contract.details.strike_price.toString(),
                contractType: contract.details.contract_type,
                side,
                size: t.size,
                price: t.price.toString(),
                premiumUsd: premium.toFixed(2),
                bidAtTrade: bid?.toString() ?? null,
                askAtTrade: ask?.toString() ?? null,
                isSweep: isSweep(t.conditions),
                conditions: t.conditions ?? [],
                priorDayOi: priorDayOi ?? null,
                oiMultiplier: oiMult?.toFixed(2) ?? null,
                classification,
                pctFromSpot: pctFromSpot?.toFixed(2) ?? null,
                underlyingPriceAtTrade: underlyingPrice?.toString() ?? null,
                meta: {
                  exchange: t.exchange,
                  sequence_number: t.sequence_number,
                },
              })
              .onConflictDoNothing();
            printsWritten++;
            allSurviving.push({
              printTs: printTs.toISOString(),
              underlying: ticker,
              contractTicker,
              expirationDate: contract.details.expiration_date,
              strike: contract.details.strike_price,
              contractType: contract.details.contract_type,
              side,
              size: t.size,
              price: t.price,
              premiumUsd: premium,
              isSweep: isSweep(t.conditions),
              oiMultiplier: oiMult,
              classification,
              pctFromSpot,
              underlyingPriceAtTrade: underlyingPrice,
            });
          } catch (insertErr) {
            // Single-row write failure should not poison the rest.
            const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
            errors.push({ ticker, message: `${contractTicker} insert: ${msg}` });
          }
        }
      }

      if (allSurviving.some((p) => p.underlying === ticker)) {
        tickersWithPrints.push(ticker);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ ticker, message });
    }
  }

  // Derive scan_day from the prints themselves — on a Friday EOD run
  // this is "today"; on a Saturday smoke test it ends up "Friday"
  // (the actual session the data describes). Match against today's NY
  // date when there are zero prints (preserves the empty-state row).
  const scanDay = dominantNyDate(allSurviving, nyTradingDay());

  // Build top-N. Rank by premium descending (biggest dollars first).
  const topPrints = [...allSurviving]
    .sort((a, b) => b.premiumUsd - a.premiumUsd)
    .slice(0, topN);

  return {
    scanDay,
    universeSize: UOA_WATCHLIST.length,
    printsWritten,
    printsSurviving: allSurviving.length,
    topPrints,
    tickersWithPrints,
    errors,
  };
}

/**
 * Read the most recent intraday prints (last N minutes), newest first.
 * Drives the "Latest intraday" banner on /research/unusual-activity.
 * Returns at most `limit` rows mapped to the UoaPrintSummary shape so
 * the view can render them with the same card component as the EOD
 * top-N. Returns [] if nothing has printed in the window.
 */
export async function fetchLatestIntradayPrints(opts: {
  lookbackMinutes?: number;
  limit?: number;
} = {}): Promise<UoaPrintSummary[]> {
  const minutes = opts.lookbackMinutes ?? 60;
  const limit = opts.limit ?? 10;
  const rows = await db
    .select()
    .from(uoaPrints)
    .where(
      sql`${uoaPrints.printTs} >= now() - (${minutes} * interval '1 minute')`,
    )
    .orderBy(desc(uoaPrints.printTs))
    .limit(limit);

  return rows.map((r) => ({
    printTs: r.printTs.toISOString(),
    underlying: r.underlying,
    contractTicker: r.contractTicker,
    expirationDate: r.expirationDate,
    strike: Number(r.strike),
    contractType: r.contractType as "call" | "put",
    side: r.side as "buy" | "sell",
    size: r.size,
    price: Number(r.price),
    premiumUsd: Number(r.premiumUsd),
    isSweep: r.isSweep,
    oiMultiplier: r.oiMultiplier ? Number(r.oiMultiplier) : null,
    classification: r.classification as UoaClassification,
    pctFromSpot: r.pctFromSpot ? Number(r.pctFromSpot) : null,
    underlyingPriceAtTrade: r.underlyingPriceAtTrade
      ? Number(r.underlyingPriceAtTrade)
      : null,
  }));
}

/**
 * Publish (UPSERT) the day's UOA scan summary row. Called by the EOD
 * cron after runUoaScan completes. Pulls the top prints from
 * uoa_prints for the current scan_day so the summary stays in sync
 * with any later intraday additions.
 *
 * Returns the persisted scan row.
 */
export async function publishDailyUoaSummary(opts: {
  scanDay: string;
  topN?: number;
}): Promise<{ topPrints: UoaPrintSummary[]; classificationCounts: Record<UoaClassification, number> }> {
  const topN = opts.topN ?? 25;
  const scanDay = opts.scanDay;

  // Read the top N prints for the day, sorted by premium.
  const rows = await db
    .select()
    .from(uoaPrints)
    .where(
      sql`(${uoaPrints.printTs} AT TIME ZONE 'America/New_York')::date = ${scanDay}::date`,
    )
    .orderBy(desc(uoaPrints.premiumUsd))
    .limit(topN);

  const topPrints: UoaPrintSummary[] = rows.map((r) => ({
    printTs: r.printTs.toISOString(),
    underlying: r.underlying,
    contractTicker: r.contractTicker,
    expirationDate: r.expirationDate,
    strike: Number(r.strike),
    contractType: r.contractType as "call" | "put",
    side: r.side as "buy" | "sell",
    size: r.size,
    price: Number(r.price),
    premiumUsd: Number(r.premiumUsd),
    isSweep: r.isSweep,
    oiMultiplier: r.oiMultiplier ? Number(r.oiMultiplier) : null,
    classification: r.classification as UoaClassification,
    pctFromSpot: r.pctFromSpot ? Number(r.pctFromSpot) : null,
    underlyingPriceAtTrade: r.underlyingPriceAtTrade
      ? Number(r.underlyingPriceAtTrade)
      : null,
  }));

  // Classification breakdown across ALL prints for the day (not just
  // top N) — useful for the summary stat line.
  const breakdown = await db
    .select({
      classification: uoaPrints.classification,
      n: sql<number>`count(*)::int`,
    })
    .from(uoaPrints)
    .where(
      sql`(${uoaPrints.printTs} AT TIME ZONE 'America/New_York')::date = ${scanDay}::date`,
    )
    .groupBy(uoaPrints.classification);

  const classificationCounts: Record<UoaClassification, number> = {
    bullish_call_buy: 0,
    bearish_put_buy: 0,
    call_sell: 0,
    put_sell: 0,
    ambiguous: 0,
  };
  for (const b of breakdown) {
    classificationCounts[b.classification as UoaClassification] = Number(b.n);
  }

  // Guard: don't write a scan row that has zero prints AND no existing
  // row to refresh. Without this, a weekend/no-data run creates a
  // phantom "latest" row that the landing page then shows as empty —
  // hiding the most-recent real scan from view.
  if (topPrints.length === 0) {
    const [existing] = await db
      .select({ id: uoaScans.id })
      .from(uoaScans)
      .where(eq(uoaScans.scanDay, scanDay))
      .limit(1);
    if (!existing) {
      return { topPrints, classificationCounts };
    }
  }

  const title = `Unusual Activity — ${new Date(`${scanDay}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`;

  // Deterministic summary — no LLM needed for v1. Counts + top tickers.
  const totalPrints = Object.values(classificationCounts).reduce((s, n) => s + n, 0);
  const tickerSet = new Set(topPrints.map((p) => p.underlying));
  const summary =
    totalPrints === 0
      ? "No unusual prints cleared the filter today. Either tape was quiet across the watchlist or the smart-money flow stayed within normal ranges."
      : `**${totalPrints}** print${totalPrints === 1 ? "" : "s"} cleared the unusual-activity bar across **${tickerSet.size}** tickers. Breakdown: ${classificationCounts.bullish_call_buy} bullish call buys · ${classificationCounts.bearish_put_buy} bearish put buys · ${classificationCounts.call_sell} call sells · ${classificationCounts.put_sell} put sells.`;

  await db
    .insert(uoaScans)
    .values({
      scanDay,
      title,
      summary,
      prints: topPrints,
      universeSize: UOA_WATCHLIST.length,
      runAt: new Date(),
      meta: { classificationCounts, totalPrints },
    })
    .onConflictDoUpdate({
      target: uoaScans.scanDay,
      set: {
        title,
        summary,
        prints: topPrints,
        runAt: new Date(),
        meta: { classificationCounts, totalPrints },
        updatedAt: sql`now()`,
      },
    });

  return { topPrints, classificationCounts };
}
