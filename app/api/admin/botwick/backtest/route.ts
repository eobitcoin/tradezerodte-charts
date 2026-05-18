import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { botBacktestRuns, botConfig } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";
import { runReplay } from "@/lib/botwick/backtest/replay";
import { summarize } from "@/lib/botwick/backtest/metrics";

/**
 * POST /api/admin/botwick/backtest — kick off a fresh ALMA × VWAP backtest.
 *   Body: { fromDay, toDay, tickers?, slopePct?, mode? }
 *   Returns: { ok, runId, summary, signalCount, durationMs }
 *
 * GET /api/admin/botwick/backtest?id=...  — fetch one run by id
 * GET /api/admin/botwick/backtest         — list recent runs (limit 20)
 *
 * Synchronous run is fine for now — a 2-week SPY+QQQ backtest is ~30
 * Tradier calls and completes inside a single request. Async run-queue lands
 * if backtest scope grows beyond ~5 min wall-time.
 */

const numLike = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .refine((v) => Number.isFinite(v), "must be a number");

const Body = z.object({
  fromDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  toDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  tickers: z.array(z.string().min(1).max(8)).min(1).max(20).optional(),
  slopePct: numLike.refine((v) => v >= 0 && v <= 5, "0..5").optional(),
  /** Override the bot's mode for data sourcing. Most backtests should run
   *  against prod data feed regardless of paper/live trading mode. */
  mode: z.enum(["paper", "live"]).optional(),
  /** Exit policy overrides. When omitted, defaults come from bot_config. */
  target1Pct: numLike.refine((v) => v > 0 && v <= 1000, "0..1000").optional(),
  target2Pct: numLike.refine((v) => v > 0 && v <= 2000, "0..2000").optional().nullable(),
  stopLossPct: numLike.refine((v) => v > 0 && v <= 100, "0..100").optional(),
  timeStopMin: z.number().int().min(5).max(390).optional(),
  /** Underlying-% to option-% multiplier (default 50 for 0DTE OTM). */
  leverageMultiplier: numLike.refine((v) => v > 0 && v <= 500, "0..500").optional(),
  /** Instrument mode — defaults to "options". Stock mode forces leverage to 1. */
  instrument: z.enum(["options", "stock_long", "stock_short", "stock_both"]).optional(),
});

export async function POST(req: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "bad request", detail: String(e) }, { status: 400 });
  }

  // Resolve defaults from current config when caller didn't specify.
  const [cfg] = await db.select().from(botConfig).where(eq(botConfig.id, "default")).limit(1);
  const tickers = body.tickers ?? cfg?.almaWatchlist ?? ["SPY", "QQQ"];
  const slopePct = body.slopePct ?? Number(cfg?.almaSteepSlopePct ?? 0.05);
  const mode = body.mode ?? cfg?.mode ?? "paper";
  if (mode === "off") {
    return NextResponse.json(
      { error: "bot mode is 'off' — pick 'paper' or 'live' for backtest data routing" },
      { status: 400 },
    );
  }

  // Resolve exit-policy params: explicit body overrides → config defaults.
  const policy = {
    target1Pct: body.target1Pct ?? Number(cfg?.defaultTarget1Pct ?? 50),
    target2Pct: body.target2Pct === null
      ? null
      : body.target2Pct ?? (cfg?.defaultTarget2Pct ? Number(cfg.defaultTarget2Pct) : null),
    stopLossPct: body.stopLossPct ?? Number(cfg?.defaultStopLossPct ?? 50),
    timeStopMin: body.timeStopMin ?? Number(cfg?.defaultTimeStopMin ?? 60),
    leverageMultiplier: body.leverageMultiplier ?? 50,
    instrument: body.instrument ?? "options",
  };

  const coolDownBars = Number(cfg?.almaPullbackCoolDownBars ?? 5);
  const pullbackThresholdPct = Number(cfg?.almaPullbackThresholdPct ?? 0.1);

  const config = {
    strategy: "alma_vwap_cross",
    fromDay: body.fromDay,
    toDay: body.toDay,
    tickers,
    slopePct,
    policy,
    coolDownBars,
    pullbackThresholdPct,
  };
  const [run] = await db
    .insert(botBacktestRuns)
    .values({
      startedBy: admin.id,
      config,
      status: "running",
    })
    .returning({ id: botBacktestRuns.id });

  const t0 = Date.now();
  try {
    const result = await runReplay({
      mode,
      tickers,
      fromDay: body.fromDay,
      toDay: body.toDay,
      slopePct,
      policy,
      coolDownBars,
      pullbackThresholdPct,
    });
    const summary = summarize(result.signals, policy);
    await db
      .update(botBacktestRuns)
      .set({
        signals: result.signals,
        summary: { ...summary, perTickerErrors: result.perTickerErrors },
        status: "complete",
        finishedAt: new Date(),
      })
      .where(eq(botBacktestRuns.id, run.id));

    return NextResponse.json({
      ok: true,
      runId: run.id,
      summary,
      signalCount: result.signals.length,
      durationMs: Date.now() - t0,
      errors: result.perTickerErrors,
    });
  } catch (e) {
    await db
      .update(botBacktestRuns)
      .set({
        status: "failed",
        error: String(e).slice(0, 1000),
        finishedAt: new Date(),
      })
      .where(eq(botBacktestRuns.id, run.id));
    return NextResponse.json(
      { error: "backtest failed", detail: String(e), runId: run.id },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const [row] = await db.select().from(botBacktestRuns).where(eq(botBacktestRuns.id, id)).limit(1);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, run: row });
  }
  const rows = await db
    .select()
    .from(botBacktestRuns)
    .orderBy(desc(botBacktestRuns.startedAt))
    .limit(20);
  return NextResponse.json({ ok: true, runs: rows });
}
