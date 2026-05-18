/**
 * POST /api/earnings/publish/<EARNINGS_PUBLISH_TOKEN>
 *
 * Ingest endpoint for the weekly Earnings Whiplash Map routine. UPSERTs one
 * post per scan_day. Same Bearer-protected pattern as institutional/publish.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { earningsPosts } from "@/lib/db/schema";

export const runtime = "nodejs";

const Stock = z.object({
  ticker: z.string().min(1).max(10),
  companyName: z.string().min(1).max(200),
  sector: z.string().max(100).nullable(),
  marketCapUsdB: z.number().nonnegative().nullable(),
  earningsDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "earningsDate must be YYYY-MM-DD"),
  earningsTime: z.enum(["bmo", "amc", "unknown"]),
  currentPrice: z.number().nonnegative().nullable(),
  historicalAvgMovePct: z.number().nonnegative().nullable(),
  historicalMaxMovePct: z.number().nonnegative().nullable(),
  historicalMovesAbove8Pct: z.number().int().nonnegative().nullable(),
  lookbackQuarters: z.number().int().nonnegative().nullable(),
  impliedMovePct: z.number().nonnegative().nullable(),
  ivVsHvDeltaPct: z.number().nullable(),
  isFlagged: z.boolean(),
  flagReason: z.string().max(800).nullable(),
  thesis: z.string().min(1).max(4000),
  risks: z.string().max(2000).default(""),
});

const Body = z.object({
  scanDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "scanDay must be YYYY-MM-DD"),
  summary: z.string().max(8000).default(""),
  methodology: z.string().max(4000).default(""),
  stocks: z.array(Stock).max(20),
  runAt: z.string().datetime().optional(),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const expected = process.env.EARNINGS_PUBLISH_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }

  const runAt = body.runAt ? new Date(body.runAt) : new Date();

  const [row] = await db
    .insert(earningsPosts)
    .values({
      scanDay: body.scanDay,
      summary: body.summary,
      methodology: body.methodology,
      stocks: body.stocks,
      runAt,
      meta: body.meta,
    })
    .onConflictDoUpdate({
      target: earningsPosts.scanDay,
      set: {
        summary: body.summary,
        methodology: body.methodology,
        stocks: body.stocks,
        runAt,
        meta: body.meta,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: earningsPosts.id, scanDay: earningsPosts.scanDay });

  return NextResponse.json({
    ok: true,
    id: row.id,
    scanDay: row.scanDay,
    url: "/research/earnings",
    stocks: body.stocks.length,
    flagged: body.stocks.filter((s) => s.isFlagged).length,
  });
}
