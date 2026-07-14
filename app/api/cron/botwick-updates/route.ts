import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { requireBotwickTweetsCronBearer } from "@/lib/bearer";
import { db } from "@/lib/db";
import { botwickScans, type BotwickScanData } from "@/lib/db/schema";
import { formatUpdateReply, type DayOutcome } from "@/lib/botwick-tweets";
import { hasXCredentials, postReply } from "@/lib/x-post";
import { fetchOhlcBarsPaged } from "@/lib/polygon";
import { nyTradingDay } from "@/lib/trading-day";

/**
 * POST /api/cron/botwick-updates
 *
 * Post-close (~4:45 PM ET): for each ticker tweeted this morning (from the
 * scan row's meta.tweets ledger), grade the completed session against the
 * SAME triggers/targets the card tweeted and reply to that tweet with the
 * outcome (🟩/🟥 trigger fired, 🎯 targets hit, ⏸ range day).
 *
 * Guards: requires today's scan row + tweets ledger (409 otherwise);
 * requires a daily bar DATED TODAY per symbol (skips on holidays/half-day
 * data gaps rather than grading a stale candle); idempotent via a
 * meta.updates ledger; per-symbol failures don't abort the batch.
 *
 * Auth: `Authorization: Bearer ${BOTWICK_TWEETS_CRON_TOKEN}` (same token as
 * the morning tweets — identical publish-to-X privilege class).
 * Optional: `?dry=1` returns the composed replies WITHOUT posting.
 */
export async function POST(req: Request) {
  const auth = requireBotwickTweetsCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  const today = nyTradingDay();
  const [row] = await db.select().from(botwickScans).where(eq(botwickScans.scanDay, today)).limit(1);
  if (!row) {
    return NextResponse.json({ error: `no BotWick scan for ${today}` }, { status: 409 });
  }
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const tweets =
    (meta.tweets as Array<{ symbol: string; tweetId: string }> | undefined) ?? [];
  if (tweets.length === 0) {
    return NextResponse.json({ error: `no tweets ledger for ${today} — nothing to update` }, { status: 409 });
  }
  const priorUpdates =
    (meta.updates as Array<{ symbol: string; replyId: string }> | undefined) ?? [];
  const updatedSymbols = new Set(priorUpdates.map((u) => u.symbol));

  const data = row.data as BotwickScanData;
  const from = new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10);

  const composed: Array<{ symbol: string; tweetId: string; text: string }> = [];
  const skipped: Array<{ symbol: string; reason: string }> = [];

  for (const t of tweets) {
    if (updatedSymbols.has(t.symbol)) {
      skipped.push({ symbol: t.symbol, reason: "already updated" });
      continue;
    }
    const report = data.reports.find((r) => r.symbol === t.symbol && r.ok);
    if (!report) {
      skipped.push({ symbol: t.symbol, reason: "no report in today's scan (universe changed?)" });
      continue;
    }
    try {
      const bars = await fetchOhlcBarsPaged(t.symbol, 1, "day", from, today, 20);
      const last = bars[bars.length - 1];
      if (!last || last.date.slice(0, 10) !== today) {
        skipped.push({ symbol: t.symbol, reason: `no daily bar for ${today} (holiday?)` });
        continue;
      }
      const prev = bars.length >= 2 ? bars[bars.length - 2].c : null;
      const day: DayOutcome = { o: last.o, h: last.h, l: last.l, c: last.c, prevClose: prev };
      composed.push({ symbol: t.symbol, tweetId: t.tweetId, text: formatUpdateReply(report, day) });
    } catch (err) {
      skipped.push({ symbol: t.symbol, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  if (dry) {
    return NextResponse.json({ ok: true, dry: true, scanDay: today, replies: composed, skipped });
  }
  if (!hasXCredentials()) {
    return NextResponse.json({ error: "X credentials not configured" }, { status: 500 });
  }

  const posted: Array<{ symbol: string; replyId: string }> = [];
  const failed: Array<{ symbol: string; error: string }> = [];
  for (const c of composed) {
    try {
      const id = await postReply(c.text, c.tweetId);
      posted.push({ symbol: c.symbol, replyId: id });
    } catch (err) {
      failed.push({ symbol: c.symbol, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (posted.length > 0) {
    const newMeta = { ...meta, updates: [...priorUpdates, ...posted] };
    await db
      .update(botwickScans)
      .set({ meta: newMeta, updatedAt: sql`now()` })
      .where(eq(botwickScans.scanDay, today));
  }

  return NextResponse.json({ ok: failed.length === 0, scanDay: today, posted, skipped, failed });
}

export const GET = POST;

export const runtime = "nodejs";
export const maxDuration = 120;
