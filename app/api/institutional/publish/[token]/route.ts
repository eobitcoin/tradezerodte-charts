/**
 * POST /api/institutional/publish/<INSTITUTIONAL_PUBLISH_TOKEN>
 *
 * Endpoint for the weekly "Institutional Flow" routine to UPSERT one
 * post per scan_day. The routine compares the latest two 13F windows
 * for the admin-configured fund list and surfaces 5 stocks where smart
 * money is accelerating while retail attention is still muted.
 *
 * Body shape: see `Body` schema below. Each `stocks[]` entry is a
 * structured snapshot — the page renders directly from this shape,
 * NOT from a markdown body.
 *
 * UPSERT key: scan_day. Re-runs on the same day overwrite cleanly.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { institutionalPosts } from "@/lib/db/schema";

export const runtime = "nodejs";

const SupportingFund = z.object({
  fund: z.string().min(1).max(200),
  sharesNow: z.number().nonnegative(),
  sharesPrior: z.number().nonnegative().nullable(),
  deltaPct: z.number().nullable(),
  isNewPosition: z.boolean(),
});

const RetailAttention = z.object({
  googleTrendsScore: z.number().min(0).max(100).nullable(),
  news30DayCount: z.number().int().nonnegative().nullable(),
  isOnRetailHotlist: z.boolean(),
  optionsCallPutOiRatio: z.number().nonnegative().nullable(),
});

const Stock = z.object({
  ticker: z.string().min(1).max(10),
  companyName: z.string().min(1).max(200),
  sector: z.string().max(100).nullable(),
  marketCapUsdB: z.number().nonnegative().nullable(),
  avgEntryPriceEstimate: z.number().nonnegative().nullable(),
  currentPrice: z.number().nonnegative().nullable(),
  totalSharesHeldUsd: z.number().nonnegative().nullable(),
  totalSharesHeld: z.number().nonnegative().nullable(),
  supportingFunds: z.array(SupportingFund).min(1).max(20),
  retailAttention: RetailAttention,
  earningsNext: z.string().nullable(),
  thesis: z.string().min(1).max(4000),
  risks: z.string().max(2000).default(""),
});

const Body = z.object({
  scanDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "scanDay must be YYYY-MM-DD"),
  summary: z.string().max(8000).default(""),
  methodology: z.string().max(4000).default(""),
  stocks: z.array(Stock).max(10),
  runAt: z.string().datetime().optional(),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const expected = process.env.INSTITUTIONAL_PUBLISH_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid body", detail: String(err) },
      { status: 400 },
    );
  }

  const runAt = body.runAt ? new Date(body.runAt) : new Date();

  // UPSERT on scan_day. The unique index does the heavy lifting.
  const [row] = await db
    .insert(institutionalPosts)
    .values({
      scanDay: body.scanDay,
      summary: body.summary,
      methodology: body.methodology,
      stocks: body.stocks,
      runAt,
      meta: body.meta,
    })
    .onConflictDoUpdate({
      target: institutionalPosts.scanDay,
      set: {
        summary: body.summary,
        methodology: body.methodology,
        stocks: body.stocks,
        runAt,
        meta: body.meta,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: institutionalPosts.id, scanDay: institutionalPosts.scanDay });

  return NextResponse.json({
    ok: true,
    id: row.id,
    scanDay: row.scanDay,
    url: "/research/institutional",
    stocks: body.stocks.length,
  });
}
