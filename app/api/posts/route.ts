import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, type ScanKind, type Trade as TradeRow } from "@/lib/db/schema";
import { requireIngestBearer } from "@/lib/bearer";
import { nyTradingDay } from "@/lib/trading-day";
import { publicUrlFor } from "@/lib/s3";
import { parseTradesFromMarkdown, inferTitle } from "@/lib/parse-routine";

export const runtime = "nodejs";

const Grade = z.enum([
  "A+", "A", "A-",
  "B+", "B", "B-",
  "C+", "C", "C-",
  "D+", "D", "D-",
  "F",
]);

const Direction = z.enum(["call", "put", "long", "short", "avoid"]);

const NumOrStr = z.union([z.number(), z.string().min(1).max(60)]);

const TradeStatus = z.enum(["confirmed", "revised", "killed", "added"]);
const TradeOutcome = z.enum([
  "target1_hit",
  "target2_hit",
  "stopped",
  "no_fill",
  "time_stopped",
  "manual_exit",
]);

const Trade = z
  .object({
    ticker: z.string().min(1).max(16).transform((v) => v.toUpperCase().trim()),
    grade: Grade,
    rank: z.number().int().min(1).max(50).optional(),
    direction: Direction.optional(),
    strike: NumOrStr.optional(),
    expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expiry must be YYYY-MM-DD").optional(),
    entry_zone: z.string().max(120).optional(),
    entry_trigger: z.string().max(500).optional(),
    target1: NumOrStr.optional(),
    target2: NumOrStr.optional(),
    stop: NumOrStr.optional(),
    time_stop: z.string().max(60).optional(),
    rationale: z.string().max(2000).optional(),
    // Scan-hierarchy fields. Emitted by market_open and analysis scans.
    // Premarket posts can omit `status` entirely (implicitly confirmed).
    status: TradeStatus.optional(),
    revision_summary: z.string().max(240).optional(),
    kill_reason: z.string().max(240).optional(),
    // Analysis-only outcome fields.
    outcome: TradeOutcome.optional(),
    actual_entry: NumOrStr.optional(),
    actual_exit: NumOrStr.optional(),
    pnl_pct: z.number().optional(),
    result_notes: z.string().max(500).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.status === "revised" && !t.revision_summary) {
      ctx.addIssue({
        code: "custom",
        path: ["revision_summary"],
        message: "revision_summary is required when status='revised'",
      });
    }
    if (t.status === "killed" && !t.kill_reason) {
      ctx.addIssue({
        code: "custom",
        path: ["kill_reason"],
        message: "kill_reason is required when status='killed'",
      });
    }
  });

const Image = z.object({
  key: z.string().min(1).max(512),
  alt: z.string().max(500).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const ScanKindEnum = z.enum(["premarket", "market_open", "analysis", "settlement"]);

const Body = z.object({
  title: z.string().min(1).max(300).optional(),
  body_md: z.string().min(1).max(200_000),
  trades: z.array(Trade).max(30).optional(),
  sentiment: z.enum(["bullish", "bearish", "neutral"]).optional(),
  bias: z.string().max(120).optional(),
  trading_day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "trading_day must be YYYY-MM-DD")
    .optional(),
  // Which scan published this post. Defaults to "premarket" so the existing
  // 8:30 routine works unchanged. Routines for the 9:45 market-open scan and
  // the 10:00 analysis pass set this explicitly.
  scan_kind: ScanKindEnum.optional(),
  run_at: z.string().datetime({ offset: true }).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  images: z.array(Image).max(20).optional(),
  // Append mode: when true, body_md is appended to the existing post for this
  // (trading_day, scan_kind) pair (creating it if absent). Useful for chunked
  // publishing from agents that can't stream a 30 KB+ tool_use block in one go.
  append: z.boolean().optional(),
});

function resolveScanKind(parsed: z.infer<typeof Body>): ScanKind {
  // Top-level wins; otherwise check meta.scan_kind (escape hatch for routines
  // whose publish tool doesn't expose scan_kind as a first-class field).
  if (parsed.scan_kind) return parsed.scan_kind;
  const fromMeta = parsed.meta?.scan_kind;
  if (typeof fromMeta === "string") {
    const parsedMeta = ScanKindEnum.safeParse(fromMeta);
    if (parsedMeta.success) return parsedMeta.data;
  }
  return "premarket";
}

export async function POST(req: Request) {
  const auth = requireIngestBearer(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }

  const tradingDay = parsed.trading_day || nyTradingDay();
  const scanKind = resolveScanKind(parsed);
  const runAt = parsed.run_at ? new Date(parsed.run_at) : null;
  const images = (parsed.images || []).map((img) => ({
    key: img.key,
    url: publicUrlFor(img.key),
    alt: img.alt,
    width: img.width,
    height: img.height,
  }));

  // ---- APPEND MODE ----
  // If append=true and a post already exists for trading_day, concatenate body_md and
  // re-derive trades/title from the combined body. Otherwise behaves like a fresh write.
  if (parsed.append === true) {
    const existing = await db
      .select()
      .from(posts)
      .where(and(eq(posts.tradingDay, tradingDay), eq(posts.scanKind, scanKind)))
      .limit(1);

    if (existing[0]) {
      const merged = `${existing[0].bodyMd}\n\n${parsed.body_md}`;
      const merged_trades = (parsed.trades && parsed.trades.length > 0
        ? (parsed.trades as TradeRow[])
        : (parseTradesFromMarkdown(merged) as TradeRow[]));
      const merged_tickers = merged_trades.map((t) => t.ticker);
      const merged_title = parsed.title || existing[0].title || inferTitle(merged) || `0DTE Options Analysis — ${tradingDay}`;
      const merged_meta = { ...(existing[0].meta as Record<string, unknown>), ...(parsed.meta ?? {}) };

      const [row] = await db
        .update(posts)
        .set({
          title: merged_title,
          bodyMd: merged,
          trades: merged_trades,
          tickers: merged_tickers,
          sentiment: parsed.sentiment ?? existing[0].sentiment,
          bias: parsed.bias ?? existing[0].bias,
          images: images.length > 0 ? images : (existing[0].images as typeof images),
          runAt: runAt ?? existing[0].runAt,
          meta: merged_meta,
          updatedAt: sql`now()`,
        })
        .where(and(eq(posts.tradingDay, tradingDay), eq(posts.scanKind, scanKind)))
        .returning({ id: posts.id, tradingDay: posts.tradingDay, scanKind: posts.scanKind });

      return NextResponse.json(
        {
          id: row.id,
          trading_day: row.tradingDay,
          scan_kind: row.scanKind,
          url: urlForPost(row.tradingDay, row.scanKind),
          mode: "append",
          body_chars: merged.length,
          trades_count: merged_trades.length,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    // No existing row → fall through to create path. Trades may legitimately be 0
    // here (first chunk often only contains macro section). Allow that.
  }

  // ---- CREATE / REPLACE PATH ----
  const trades: TradeRow[] = (parsed.trades && parsed.trades.length > 0
    ? (parsed.trades as TradeRow[])
    : (parseTradesFromMarkdown(parsed.body_md) as TradeRow[]));

  // In append-mode-creating-first-chunk, trades may be empty; that's OK — they'll
  // populate as later chunks are appended. Otherwise, require at least one.
  // EXCEPTION: the "analysis" scan is a narrative pass — it doesn't carry trades,
  // it just narrates the deterministic comparison computed at render time.
  if (trades.length === 0 && parsed.append !== true && scanKind !== "analysis") {
    return NextResponse.json(
      { error: "no trades supplied and none could be parsed from body_md" },
      { status: 400 },
    );
  }
  const title = parsed.title || inferTitle(parsed.body_md) || `0DTE Options Analysis — ${tradingDay}`;
  const tickers = trades.map((t) => t.ticker);

  const [row] = await db
    .insert(posts)
    .values({
      tradingDay,
      scanKind,
      title,
      bodyMd: parsed.body_md,
      trades,
      tickers,
      sentiment: parsed.sentiment ?? null,
      bias: parsed.bias ?? null,
      images,
      runAt,
      meta: parsed.meta ?? {},
    })
    .onConflictDoUpdate({
      target: [posts.tradingDay, posts.scanKind],
      set: {
        title,
        bodyMd: parsed.body_md,
        trades,
        tickers,
        sentiment: parsed.sentiment ?? null,
        bias: parsed.bias ?? null,
        images,
        runAt,
        meta: parsed.meta ?? {},
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: posts.id, tradingDay: posts.tradingDay, scanKind: posts.scanKind });

  return NextResponse.json(
    {
      id: row.id,
      trading_day: row.tradingDay,
      scan_kind: row.scanKind,
      url: urlForPost(row.tradingDay, row.scanKind),
      mode: parsed.append === true ? "append-create" : "replace",
      body_chars: parsed.body_md.length,
      trades_count: trades.length,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Canonical URL for a given scan. Premarket lives at /posts/<day>; the other
 *  scans live at /posts/<day>?tab=<scan_kind> so old links still work. */
function urlForPost(day: string, kind: ScanKind): string {
  if (kind === "premarket") return `/posts/${day}`;
  return `/posts/${day}?tab=${kind}`;
}
