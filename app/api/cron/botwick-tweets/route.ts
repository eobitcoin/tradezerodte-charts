import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { requireBotwickTweetsCronBearer } from "@/lib/bearer";
import { db } from "@/lib/db";
import { botwickScans, type BotwickScanData } from "@/lib/db/schema";
import { pickTop, formatTweet, formatDetail, chunkDetail } from "@/lib/botwick-tweets";
import { hasXCredentials, postTweet, postReply, isLengthError } from "@/lib/x-post";
import { nyTradingDay } from "@/lib/trading-day";

/**
 * POST /api/cron/botwick-tweets
 *
 * ~6:15AM ET (after the analysis cron): pick the day's 5 highest-conviction
 * BotWick setups and post each to X (@TheBotWick).
 *
 * Idempotent by design — posted tweet ids are recorded in the scan row's
 * meta.tweets, and a re-run only posts symbols not yet recorded for the day.
 * Per-tweet failures are reported but don't abort the batch.
 *
 * Guards: refuses if today's scan row is missing (never tweets stale
 * analysis), no-ops cleanly if X credentials aren't configured.
 *
 * Auth: `Authorization: Bearer ${BOTWICK_TWEETS_CRON_TOKEN}`.
 * Optional: `?dry=1` returns the composed tweets WITHOUT posting.
 */
export async function POST(req: Request) {
  const auth = requireBotwickTweetsCronBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  const today = nyTradingDay();
  const [row] = await db
    .select()
    .from(botwickScans)
    .orderBy(desc(botwickScans.scanDay))
    .limit(1);
  if (!row || row.scanDay !== today) {
    return NextResponse.json(
      { error: `no BotWick scan for ${today} — refusing to tweet stale analysis` },
      { status: 409 },
    );
  }

  const data = row.data as BotwickScanData;
  const picks = pickTop(data.reports);
  const composed = picks.map((r) => ({
    symbol: r.symbol,
    bias: r.bias,
    card: formatTweet(r),
    detail: formatDetail(r),
  }));

  if (dry) {
    return NextResponse.json({ ok: true, dry: true, scanDay: today, tweets: composed });
  }
  if (!hasXCredentials()) {
    return NextResponse.json(
      { error: "X credentials not configured (X_API_KEY/SECRET, X_ACCESS_TOKEN/SECRET)" },
      { status: 500 },
    );
  }

  // Idempotency: skip symbols already posted for this scan day.
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const prior =
    (meta.tweets as Array<{ symbol: string; tweetId: string; replyIds?: string[] }> | undefined) ??
    [];
  const postedSymbols = new Set(prior.map((t) => t.symbol));

  const posted: Array<{ symbol: string; tweetId: string; mode: string; replyIds: string[] }> = [];
  const failed: Array<{ symbol: string; error: string }> = [];
  for (const t of composed) {
    if (postedSymbols.has(t.symbol)) continue;
    try {
      // Preferred: ONE long post (card + blank line + full website detail).
      // Works when @TheBotWick has X Premium; timeline shows the card with
      // "Show more" expanding into the detail.
      const id = await postTweet(`${t.card}\n\n${t.detail}`);
      posted.push({ symbol: t.symbol, tweetId: id, mode: "long", replyIds: [] });
    } catch (err) {
      if (!isLengthError(err)) {
        failed.push({ symbol: t.symbol, error: err instanceof Error ? err.message : String(err) });
        continue;
      }
      // Fallback (no Premium): card as the root tweet, detail as a thread of
      // replies chunked at bullet boundaries.
      try {
        const rootId = await postTweet(t.card);
        const replyIds: string[] = [];
        let last = rootId;
        for (const chunk of chunkDetail(t.detail)) {
          last = await postReply(chunk, last);
          replyIds.push(last);
        }
        posted.push({ symbol: t.symbol, tweetId: rootId, mode: "thread", replyIds });
      } catch (err2) {
        failed.push({ symbol: t.symbol, error: err2 instanceof Error ? err2.message : String(err2) });
      }
    }
  }

  if (posted.length > 0) {
    const newMeta = { ...meta, tweets: [...prior, ...posted] };
    await db
      .update(botwickScans)
      .set({ meta: newMeta, updatedAt: sql`now()` })
      .where(eq(botwickScans.scanDay, today));
  }

  return NextResponse.json({
    ok: failed.length === 0,
    scanDay: today,
    posted,
    skippedAlreadyPosted: composed.filter((t) => postedSymbols.has(t.symbol)).map((t) => t.symbol),
    failed,
  });
}

export const GET = POST;

export const runtime = "nodejs";
export const maxDuration = 120;
