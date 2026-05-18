import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { botTrades } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";
import { evaluate, flattenResult, type MarketState } from "@/lib/botwick/evaluator";
import type { Condition, TriggerAST } from "@/lib/botwick/types";

/**
 * POST /api/admin/botwick/evaluate
 *
 * Sandbox-only. Admin supplies a hypothetical MarketState; we load all
 * `pending` bot_trades for the given ticker and evaluate each branch of
 * each AST against that state. NO writes to bot_actions, NO orders,
 * NO state changes anywhere. Purely a "what would happen if?" preview.
 *
 * Returns a per-trade breakdown so the UI can render exactly which predicates
 * matched and which didn't.
 */
const Body = z.object({
  ticker: z.string().min(1).max(8),
  lastPrice: z.number().finite(),
  sessionVwap: z.number().finite().nullable().optional().default(null),
  lastBars: z
    .object({
      "1min": z.object({ close: z.number(), high: z.number(), low: z.number() }).optional(),
      "5min": z.object({ close: z.number(), high: z.number(), low: z.number() }).optional(),
      "15min": z.object({ close: z.number(), high: z.number(), low: z.number() }).optional(),
    })
    .default({}),
  vwapRejectionShort: z.boolean().default(false),
  vwapRejectionLong: z.boolean().default(false),
  nowEt: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM expected"),
  entryFill: z.number().finite().optional(),
  currentMid: z.number().finite().optional(),
});

type Branch = "entry" | "target1" | "target2" | "stop" | "time_stop";
const BRANCHES: Branch[] = ["entry", "target1", "target2", "stop", "time_stop"];

export async function POST(req: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "bad request", detail: String(err) }, { status: 400 });
  }

  const state: MarketState = {
    ticker: body.ticker.toUpperCase(),
    lastPrice: body.lastPrice,
    sessionVwap: body.sessionVwap ?? null,
    lastBars: body.lastBars,
    vwapRejectionShort: body.vwapRejectionShort,
    vwapRejectionLong: body.vwapRejectionLong,
    nowEt: body.nowEt,
    entryFill: body.entryFill,
    currentMid: body.currentMid,
  };

  const rows = await db
    .select()
    .from(botTrades)
    .where(
      and(
        eq(botTrades.sourceTicker, state.ticker),
        inArray(botTrades.status, ["pending", "working", "open", "closing"]),
      ),
    );

  const results = rows.map((row) => {
    // The ingest pipeline stores the parsed AST on plan.ast.
    const plan = (row.plan ?? {}) as Record<string, unknown>;
    const ast = (plan.ast ?? null) as TriggerAST | null;

    const perBranch = BRANCHES.map((branch) => {
      const cond = ast ? (ast[branch] as Condition | null) : null;
      if (!cond) return { branch, present: false, matched: false, flat: [] };
      const tree = evaluate(cond, state);
      return {
        branch,
        present: true,
        matched: tree.matched,
        flat: flattenResult(tree),
      };
    });

    return {
      tradeId: row.id,
      ticker: row.sourceTicker,
      strategy: row.strategy,
      grade: row.sourceGrade,
      status: row.status,
      entryMidEstimate: (plan.entryMidEstimate as number | null) ?? null,
      branches: perBranch,
    };
  });

  return NextResponse.json({ ok: true, state, results });
}
