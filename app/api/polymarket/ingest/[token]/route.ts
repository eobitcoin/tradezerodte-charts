/**
 * Polymarket data plumbing endpoint.
 *
 *   POST /api/polymarket/ingest/<POLYMARKET_TOKEN>
 *
 * Each call performs two passes:
 *   (1) INGEST — pull the recent trade firehose, upsert wallet records
 *       for any whale-sized trades (>= MIN_WHALE_USD).
 *   (2) SCORE — pick N wallets that haven't been scored recently, hit
 *       /positions for each, persist the score snapshot.
 *
 * Designed for an external cron pinger (cron-job.org / Railway cron). Run
 * every 5–15 minutes. Each call is idempotent and fast (~10–20s with
 * default limits).
 *
 * Path-token auth — same pattern as /api/radar/signal/[token] and the MCP
 * server. Token rotates by changing POLYMARKET_TOKEN env var.
 */

import { NextResponse } from "next/server";
import { sql, asc, gte, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  polymarketWallets,
  polymarketWalletScores,
  polymarketTrades,
  polymarketEvents,
} from "@/lib/db/schema";
import {
  fetchPolymarketWhales,
  fetchPolymarketPositions,
  scoreWallet,
  fetchGammaEvents,
  deriveCategory,
} from "@/lib/polymarket";

export const runtime = "nodejs";
export const maxDuration = 60;

const MIN_WHALE_USD = 500;
const SCORE_BATCH_SIZE = 20;
const SCORE_STALENESS_HOURS = 12;
const INGEST_PAGES = 8;

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const expected = process.env.POLYMARKET_TOKEN;
  if (!expected || token !== expected) return unauthorized();

  const startedAt = Date.now();
  const phases: Record<string, unknown> = {};

  // ----- PHASE 1: INGEST -----
  // Pull recent whale trades and upsert wallet records.
  let inserted = 0;
  let updated = 0;
  let scanned = 0;
  try {
    const r = await fetchPolymarketWhales({
      minUsd: MIN_WHALE_USD,
      maxPages: INGEST_PAGES,
      maxWhales: 1000,
    });
    scanned = r.totalScanned;

    // Group trades by wallet so we can summarize before upserting.
    interface WalletAgg {
      address: string;
      pseudonym: string | null;
      displayName: string | null;
      tradesSeen: number;
      whaleTradesSeen: number;
      totalVolumeUsd: number;
      lastSeen: Date;
    }
    const byWallet = new Map<string, WalletAgg>();
    for (const t of r.trades) {
      const addr = t.proxyWallet.toLowerCase();
      const usd = t.size * t.price;
      const ts = new Date(t.timestamp * 1000);
      const existing = byWallet.get(addr);
      if (existing) {
        existing.tradesSeen += 1;
        existing.whaleTradesSeen += 1;
        existing.totalVolumeUsd += usd;
        if (ts > existing.lastSeen) existing.lastSeen = ts;
      } else {
        byWallet.set(addr, {
          address: addr,
          pseudonym: t.pseudonym || null,
          displayName: t.name || null,
          tradesSeen: 1,
          whaleTradesSeen: 1,
          totalVolumeUsd: usd,
          lastSeen: ts,
        });
      }
    }

    // Persist the whale trades themselves into polymarket_trades. ON CONFLICT
    // DO NOTHING dedupes via (transaction_hash, asset) — each cron tick will
    // re-fetch overlapping windows but only insert genuinely new trades.
    if (r.trades.length > 0) {
      const tradeRows = r.trades.map((t) => {
        const usd = t.size * t.price;
        return {
          transactionHash: t.transactionHash,
          asset: t.asset,
          wallet: t.proxyWallet.toLowerCase(),
          conditionId: t.conditionId,
          side: t.side,
          size: t.size.toFixed(6),
          price: t.price.toFixed(6),
          usdValue: usd.toFixed(4),
          outcome: t.outcome ?? null,
          outcomeIndex: t.outcomeIndex ?? null,
          title: t.title ?? null,
          slug: t.slug ?? null,
          eventSlug: t.eventSlug ?? null,
          timestamp: new Date(t.timestamp * 1000),
        };
      });
      // Insert in batches of 500 to keep the SQL statement under the
      // postgres parameter limit (~64K, conservative cap).
      const tradesInserted = { inserted: 0 };
      for (let i = 0; i < tradeRows.length; i += 500) {
        const slice = tradeRows.slice(i, i + 500);
        const result = await db
          .insert(polymarketTrades)
          .values(slice)
          .onConflictDoNothing({
            target: [polymarketTrades.transactionHash, polymarketTrades.asset],
          })
          .returning({ id: polymarketTrades.id });
        tradesInserted.inserted += result.length;
      }
      phases.tradesPersisted = {
        seen: tradeRows.length,
        inserted: tradesInserted.inserted,
        deduped: tradeRows.length - tradesInserted.inserted,
      };
    }

    // Upsert each wallet — increment counters when the row already exists.
    for (const w of byWallet.values()) {
      const result = await db
        .insert(polymarketWallets)
        .values({
          address: w.address,
          pseudonym: w.pseudonym,
          displayName: w.displayName,
          firstSeen: w.lastSeen,
          lastSeen: w.lastSeen,
          tradesSeen: w.tradesSeen,
          whaleTradesSeen: w.whaleTradesSeen,
          totalVolumeUsd: w.totalVolumeUsd.toFixed(2),
        })
        .onConflictDoUpdate({
          target: polymarketWallets.address,
          set: {
            // Preserve firstSeen via no-op; update lastSeen + counters.
            pseudonym: sql`COALESCE(${polymarketWallets.pseudonym}, EXCLUDED.pseudonym)`,
            displayName: sql`COALESCE(${polymarketWallets.displayName}, EXCLUDED.display_name)`,
            lastSeen: sql`GREATEST(${polymarketWallets.lastSeen}, EXCLUDED.last_seen)`,
            tradesSeen: sql`${polymarketWallets.tradesSeen} + EXCLUDED.trades_seen`,
            whaleTradesSeen: sql`${polymarketWallets.whaleTradesSeen} + EXCLUDED.whale_trades_seen`,
            totalVolumeUsd: sql`${polymarketWallets.totalVolumeUsd} + EXCLUDED.total_volume_usd`,
            updatedAt: sql`now()`,
          },
        })
        .returning({
          address: polymarketWallets.address,
          xmax: sql<string>`xmax::text`,
        });
      const row = result[0];
      if (row?.xmax === "0") inserted++;
      else updated++;
    }

    phases.ingest = {
      pagesFetched: r.pagesFetched,
      tradesScanned: scanned,
      whaleTrades: r.trades.length,
      uniqueWallets: byWallet.size,
      inserted,
      updated,
    };
  } catch (err) {
    phases.ingest = {
      error: err instanceof Error ? err.message : String(err),
      tradesScanned: scanned,
    };
  }

  // ----- PHASE 2: SCORE -----
  // Pick wallets that have never been scored OR were scored more than
  // SCORE_STALENESS_HOURS ago, oldest-first. Cap at SCORE_BATCH_SIZE per run.
  let scored = 0;
  let scoreErrors = 0;
  try {
    const stalenessCutoff = new Date(Date.now() - SCORE_STALENESS_HOURS * 60 * 60 * 1000);
    const minWhaleTrades = 1;

    const candidates = await db
      .select({
        address: polymarketWallets.address,
        lastScoredAt: polymarketWallets.lastScoredAt,
      })
      .from(polymarketWallets)
      .where(
        sql`${polymarketWallets.whaleTradesSeen} >= ${minWhaleTrades} AND (${polymarketWallets.lastScoredAt} IS NULL OR ${polymarketWallets.lastScoredAt} < ${stalenessCutoff.toISOString()})`,
      )
      .orderBy(asc(polymarketWallets.lastScoredAt))
      .limit(SCORE_BATCH_SIZE);

    for (const c of candidates) {
      try {
        const positions = await fetchPolymarketPositions(c.address);
        const score = scoreWallet(positions);

        await db.insert(polymarketWalletScores).values({
          wallet: c.address,
          realizedPnl: score.realizedPnl.toFixed(4),
          unrealizedPnl: score.unrealizedPnl.toFixed(4),
          capitalDeployedUsd: score.capitalDeployedUsd.toFixed(4),
          roi: score.roi != null ? score.roi.toFixed(6) : null,
          positionCount: score.positionCount,
          compositeScore: score.compositeScore != null ? score.compositeScore.toFixed(4) : null,
          raw: { positionCount: positions.length },
        });

        await db
          .update(polymarketWallets)
          .set({
            lastScoredAt: new Date(),
            updatedAt: sql`now()`,
          })
          .where(sql`${polymarketWallets.address} = ${c.address}`);

        scored++;
      } catch (err) {
        scoreErrors++;
        // Log via structured error for /api debugging; don't abort the batch.
        console.warn(
          `polymarket score error for ${c.address.slice(0, 10)}...:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    phases.score = {
      candidatesPicked: candidates.length,
      scored,
      errors: scoreErrors,
      batchSize: SCORE_BATCH_SIZE,
      stalenessHours: SCORE_STALENESS_HOURS,
    };
  } catch (err) {
    phases.score = { error: err instanceof Error ? err.message : String(err) };
  }

  // ----- PHASE 4: EVENTS CACHE -----
  // Find event_slugs in our trades that don't yet have an event row, and
  // lazy-fetch them from Gamma. Cap per cycle so a fresh DB doesn't make
  // an unbounded request burst.
  const EVENTS_BATCH_SIZE = 30;
  let eventsFetched = 0;
  let eventsInserted = 0;
  try {
    const missing = await db.execute(sql`
      SELECT DISTINCT t.event_slug
      FROM polymarket_trades t
      LEFT JOIN polymarket_events e ON e.event_slug = t.event_slug
      WHERE t.event_slug IS NOT NULL
        AND e.event_slug IS NULL
      LIMIT ${EVENTS_BATCH_SIZE}
    `);
    const slugs = ([...missing] as Array<{ event_slug: string }>)
      .map((r) => r.event_slug)
      .filter((s) => typeof s === "string" && s.length > 0);

    if (slugs.length > 0) {
      const events = await fetchGammaEvents(slugs);
      eventsFetched = events.length;

      // Build the full slug set we tried to fetch — even ones Gamma didn't
      // return get a row (with category null) so we don't keep retrying them.
      const returnedSlugs = new Set(events.map((e) => e.slug));
      const rows: Array<{
        eventSlug: string;
        title: string | null;
        category: string | null;
        tagSlugs: string[];
      }> = [];
      for (const e of events) {
        rows.push({
          eventSlug: e.slug,
          title: e.title || null,
          category: deriveCategory(e.tags),
          tagSlugs: e.tags.map((t) => t.slug).filter(Boolean),
        });
      }
      // Stub rows for slugs Gamma didn't return — prevents repeated lookups.
      for (const slug of slugs) {
        if (!returnedSlugs.has(slug)) {
          rows.push({ eventSlug: slug, title: null, category: null, tagSlugs: [] });
        }
      }

      if (rows.length > 0) {
        const result = await db
          .insert(polymarketEvents)
          .values(rows)
          .onConflictDoUpdate({
            target: polymarketEvents.eventSlug,
            set: {
              title: sql`COALESCE(EXCLUDED.title, ${polymarketEvents.title})`,
              category: sql`COALESCE(EXCLUDED.category, ${polymarketEvents.category})`,
              tagSlugs: sql`EXCLUDED.tag_slugs`,
              refreshedAt: sql`now()`,
            },
          })
          .returning({ eventSlug: polymarketEvents.eventSlug });
        eventsInserted = result.length;
      }
    }

    phases.events = {
      missingSlugs: slugs.length,
      gammaFetched: eventsFetched,
      upserted: eventsInserted,
    };
  } catch (err) {
    phases.events = { error: err instanceof Error ? err.message : String(err) };
  }

  // Suppress unused import warning while we keep the helpers around.
  void gte; void isNull; void or;

  const elapsedMs = Date.now() - startedAt;
  return NextResponse.json({
    ok: true,
    elapsedMs,
    phases,
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  // Friendly response if you paste the URL in a browser.
  const { token } = await ctx.params;
  const expected = process.env.POLYMARKET_TOKEN;
  if (!expected || token !== expected) return unauthorized();
  return NextResponse.json({
    ok: true,
    method: "POST",
    note: "POST to this URL with no body to run an ingest+score cycle.",
  });
}
