import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { botActions, botConfig } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";

/**
 * POST /api/admin/botwick/config
 * Admin-only. Mutates the singleton bot_config row and writes a config_change
 * event to bot_actions for the audit/Matrix tape.
 */
const Body = z.object({
  enabled: z.boolean(),
  mode: z.enum(["off", "paper", "live"]),
  gradeFilter: z.enum(["A+", "A", "A-", "B+", "ALL"]),
  // Money fields are stored numeric — accept either number or string from the UI
  // and coerce to the dollar-cent string Drizzle expects.
  maxRiskPerTradeUsd: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, "must be > 0"),
  // Separate cap for stock-mode notional. Default $10k. Independent of
  // maxRiskPerTradeUsd because share exposure is linear vs leveraged options.
  maxStockNotionalUsd: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, "must be > 0")
    .optional(),
  maxDailyLossUsd: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, "must be > 0"),
  maxOpenPositions: z.number().int().min(1).max(20),
  // Plan-slippage tolerance for the live-mid re-check (Phase 3b). Stored as
  // a percent: 50 = 50%. Setting this to 0 effectively disables live trading
  // entirely (any nonzero slippage blocks). Realistic range 10–100.
  maxPlanSlippagePct: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 500, "must be 0–500"),
  // Day-trade force-exit. Default true — sweeps everything by 16:00 ET.
  dayTradeForceExit: z.boolean().default(true),
  // Intent size per trade (dollars). Used by signal strategies that size
  // their own orders (e.g. ALMA × VWAP). Plan-based strategy currently
  // ignores this and uses qty=1 with the per-trade $/cap as the rail.
  positionSizeUsd: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, "must be > 0"),
  // ALMA × VWAP watchlist — text array of tickers. Whitespace-tolerant.
  almaWatchlist: z
    .array(z.string().min(1).max(8))
    .max(20)
    .default([]),
  // ALMA steep-slope threshold, % per bar. Smaller = more permissive.
  almaSteepSlopePct: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 5, "must be 0–5"),
  // Cool-down window (bars) where close-below-VWAP doesn't clear READY.
  almaPullbackCoolDownBars: z.number().int().min(0).max(30).default(5),
  // Max wick depth beyond ALMA (% of ALMA) that still counts as a pullback.
  almaPullbackThresholdPct: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 5, "must be 0–5"),
  // Smart re-pegging max attempts before crossing the spread. 0 disables.
  entryRepegMax: z.number().int().min(0).max(5),
  // Drift cap for re-pegs: % above original signal mid that aborts re-peg.
  entryRepegMaxDriftPct: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1000, "must be 0–1000"),
  // Default-exit safety nets. Used when a trade's AST doesn't supply the
  // corresponding branch (ALMA × VWAP trades always; plan-based trades when
  // the parser couldn't recognise a clause).
  defaultTarget1Pct: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 500, "must be 0–500"),
  defaultTarget2Pct: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 1000, "must be 0–1000"),
  defaultStopLossPct: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 100, "must be 0–100"),
  defaultTimeStopMin: z.number().int().min(5).max(390),
  // Optional ALMA-reversal exit filter (off by default).
  almaReversalExit: z.boolean().default(false),
  // Optional Price-Reversal ALMA exit (fires on close, not on ALMA cross).
  priceReversalAlmaExit: z.boolean().default(false),
  priceReversalAlmaThresholdPct: z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 5, "must be 0–5"),
  priceReversalAlmaGraceBars: z.number().int().min(0).max(30).default(5),
  // ─── Option 2 (ALMA 9/39 RSI strategy) — Phase 1 ─────────────────────────
  almaInstrumentMode: z.enum(["options", "stock_long", "stock_short", "stock_both"]).optional(),
  alma939InstrumentMode: z.enum(["options", "stock_long", "stock_short", "stock_both"]).optional(),
  alma939Watchlist: z.array(z.string().min(1).max(8)).max(20).optional(),
  alma939FastLen: z.number().int().min(2).max(200).optional(),
  alma939SlowLen: z.number().int().min(2).max(500).optional(),
  alma939Offset: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939Sigma: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939UseRsiFilter: z.boolean().optional(),
  alma939RsiLen: z.number().int().min(2).max(200).optional(),
  alma939LongRsiMin: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939LongRsiMax: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939ShortRsiMin: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939ShortRsiMax: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939UseChopFilter: z.boolean().optional(),
  alma939ChopLen: z.number().int().min(2).max(200).optional(),
  alma939ChopThreshold: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939ChopMode: z.enum(["below", "above"]).optional(),
  alma939UseVwapEntryFilter: z.boolean().optional(),
  alma939VwapLongMode: z.enum(["close", "hl2"]).optional(),
  alma939VwapShortMode: z.enum(["close", "hl2"]).optional(),
  alma939UseSessionFilter: z.boolean().optional(),
  alma939SessionStart: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM").optional(),
  alma939SessionEnd: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM").optional(),
  alma939UseForceClose: z.boolean().optional(),
  alma939ForceCloseHour: z.number().int().min(0).max(23).optional(),
  alma939ForceCloseMinute: z.number().int().min(0).max(59).optional(),
  alma939UseAlmaSignalExits: z.boolean().optional(),
  alma939UseLongCloseBelowAlma39Exit: z.boolean().optional(),
  alma939UseLongAlmaCrossDownExit: z.boolean().optional(),
  alma939UseShortCloseAboveAlma39Exit: z.boolean().optional(),
  alma939UseShortAlmaCrossUpExit: z.boolean().optional(),
  alma939UseVwapExitRules: z.boolean().optional(),
  alma939UseLongCloseBelowVwapExit: z.boolean().optional(),
  alma939UseShortCloseAboveVwapExit: z.boolean().optional(),
  alma939UseLongAlma9CrossBelowVwapExit: z.boolean().optional(),
  alma939UseShortAlma9CrossAboveVwapExit: z.boolean().optional(),
  alma939UseStopLoss: z.boolean().optional(),
  alma939SlMode: z.enum(["fixed", "trailing"]).optional(),
  alma939FixedSlPct: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939TrailSlPct: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939TrailUpdateMode: z.enum(["prev_extreme", "curr_extreme", "close"]).optional(),
  alma939UseProfitTargets: z.boolean().optional(),
  alma939UseTp1: z.boolean().optional(),
  alma939Tp1Pct: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939Tp1Qty: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939UseTp2: z.boolean().optional(),
  alma939Tp2Pct: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939Tp2Qty: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939UseTp3: z.boolean().optional(),
  alma939Tp3Pct: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939Tp3Qty: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939UseTp4: z.boolean().optional(),
  alma939Tp4Pct: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939Tp4Qty: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939UseTp5: z.boolean().optional(),
  alma939Tp5Pct: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  alma939Tp5Qty: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
  // Phase 4 safety rail. Defaults false; UI must include explicit consent
  // copy before letting the admin set this true.
  liveOrdersConfirmed: z.boolean().default(false),
});

export async function POST(req: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "bad request", details: String(e) }, { status: 400 });
  }

  // Read the row before the mutation so we can record a meaningful diff.
  const [before] = await db
    .select()
    .from(botConfig)
    .where(eq(botConfig.id, "default"))
    .limit(1);

  // Safety rail: switching mode to "live" requires the bot to be explicitly
  // re-enabled in the same request. We don't auto-flip enabled, but we DO
  // block silently arming live without an enabled flag, which is the most
  // common "oh shit" scenario.
  if (body.mode === "live" && !body.enabled) {
    return NextResponse.json(
      { error: "Cannot select live mode while enabled=false. Set enabled and try again." },
      { status: 400 },
    );
  }

  await db
    .update(botConfig)
    .set({
      enabled: body.enabled,
      mode: body.mode,
      gradeFilter: body.gradeFilter,
      maxRiskPerTradeUsd: body.maxRiskPerTradeUsd,
      ...(body.maxStockNotionalUsd !== undefined && { maxStockNotionalUsd: body.maxStockNotionalUsd }),
      maxDailyLossUsd: body.maxDailyLossUsd,
      maxOpenPositions: body.maxOpenPositions,
      maxPlanSlippagePct: body.maxPlanSlippagePct,
      dayTradeForceExit: body.dayTradeForceExit,
      positionSizeUsd: body.positionSizeUsd,
      ...(body.almaInstrumentMode !== undefined && { almaInstrumentMode: body.almaInstrumentMode }),
      almaWatchlist: body.almaWatchlist,
      almaSteepSlopePct: body.almaSteepSlopePct,
      almaPullbackCoolDownBars: body.almaPullbackCoolDownBars,
      almaPullbackThresholdPct: body.almaPullbackThresholdPct,
      entryRepegMax: body.entryRepegMax,
      entryRepegMaxDriftPct: body.entryRepegMaxDriftPct,
      defaultTarget1Pct: body.defaultTarget1Pct,
      defaultTarget2Pct: body.defaultTarget2Pct,
      defaultStopLossPct: body.defaultStopLossPct,
      defaultTimeStopMin: body.defaultTimeStopMin,
      almaReversalExit: body.almaReversalExit,
      priceReversalAlmaExit: body.priceReversalAlmaExit,
      priceReversalAlmaThresholdPct: body.priceReversalAlmaThresholdPct,
      priceReversalAlmaGraceBars: body.priceReversalAlmaGraceBars,
      // Option 2 (ALMA 9/39 RSI) — only patch supplied fields so admins can
      // partial-update one knob without resetting the rest.
      ...(body.alma939InstrumentMode !== undefined && { alma939InstrumentMode: body.alma939InstrumentMode }),
      ...(body.alma939Watchlist !== undefined && { alma939Watchlist: body.alma939Watchlist }),
      ...(body.alma939FastLen !== undefined && { alma939FastLen: body.alma939FastLen }),
      ...(body.alma939SlowLen !== undefined && { alma939SlowLen: body.alma939SlowLen }),
      ...(body.alma939Offset !== undefined && { alma939Offset: body.alma939Offset }),
      ...(body.alma939Sigma !== undefined && { alma939Sigma: body.alma939Sigma }),
      ...(body.alma939UseRsiFilter !== undefined && { alma939UseRsiFilter: body.alma939UseRsiFilter }),
      ...(body.alma939RsiLen !== undefined && { alma939RsiLen: body.alma939RsiLen }),
      ...(body.alma939LongRsiMin !== undefined && { alma939LongRsiMin: body.alma939LongRsiMin }),
      ...(body.alma939LongRsiMax !== undefined && { alma939LongRsiMax: body.alma939LongRsiMax }),
      ...(body.alma939ShortRsiMin !== undefined && { alma939ShortRsiMin: body.alma939ShortRsiMin }),
      ...(body.alma939ShortRsiMax !== undefined && { alma939ShortRsiMax: body.alma939ShortRsiMax }),
      ...(body.alma939UseChopFilter !== undefined && { alma939UseChopFilter: body.alma939UseChopFilter }),
      ...(body.alma939ChopLen !== undefined && { alma939ChopLen: body.alma939ChopLen }),
      ...(body.alma939ChopThreshold !== undefined && { alma939ChopThreshold: body.alma939ChopThreshold }),
      ...(body.alma939ChopMode !== undefined && { alma939ChopMode: body.alma939ChopMode }),
      ...(body.alma939UseVwapEntryFilter !== undefined && { alma939UseVwapEntryFilter: body.alma939UseVwapEntryFilter }),
      ...(body.alma939VwapLongMode !== undefined && { alma939VwapLongMode: body.alma939VwapLongMode }),
      ...(body.alma939VwapShortMode !== undefined && { alma939VwapShortMode: body.alma939VwapShortMode }),
      ...(body.alma939UseSessionFilter !== undefined && { alma939UseSessionFilter: body.alma939UseSessionFilter }),
      ...(body.alma939SessionStart !== undefined && { alma939SessionStart: body.alma939SessionStart }),
      ...(body.alma939SessionEnd !== undefined && { alma939SessionEnd: body.alma939SessionEnd }),
      ...(body.alma939UseForceClose !== undefined && { alma939UseForceClose: body.alma939UseForceClose }),
      ...(body.alma939ForceCloseHour !== undefined && { alma939ForceCloseHour: body.alma939ForceCloseHour }),
      ...(body.alma939ForceCloseMinute !== undefined && { alma939ForceCloseMinute: body.alma939ForceCloseMinute }),
      ...(body.alma939UseAlmaSignalExits !== undefined && { alma939UseAlmaSignalExits: body.alma939UseAlmaSignalExits }),
      ...(body.alma939UseLongCloseBelowAlma39Exit !== undefined && { alma939UseLongCloseBelowAlma39Exit: body.alma939UseLongCloseBelowAlma39Exit }),
      ...(body.alma939UseLongAlmaCrossDownExit !== undefined && { alma939UseLongAlmaCrossDownExit: body.alma939UseLongAlmaCrossDownExit }),
      ...(body.alma939UseShortCloseAboveAlma39Exit !== undefined && { alma939UseShortCloseAboveAlma39Exit: body.alma939UseShortCloseAboveAlma39Exit }),
      ...(body.alma939UseShortAlmaCrossUpExit !== undefined && { alma939UseShortAlmaCrossUpExit: body.alma939UseShortAlmaCrossUpExit }),
      ...(body.alma939UseVwapExitRules !== undefined && { alma939UseVwapExitRules: body.alma939UseVwapExitRules }),
      ...(body.alma939UseLongCloseBelowVwapExit !== undefined && { alma939UseLongCloseBelowVwapExit: body.alma939UseLongCloseBelowVwapExit }),
      ...(body.alma939UseShortCloseAboveVwapExit !== undefined && { alma939UseShortCloseAboveVwapExit: body.alma939UseShortCloseAboveVwapExit }),
      ...(body.alma939UseLongAlma9CrossBelowVwapExit !== undefined && { alma939UseLongAlma9CrossBelowVwapExit: body.alma939UseLongAlma9CrossBelowVwapExit }),
      ...(body.alma939UseShortAlma9CrossAboveVwapExit !== undefined && { alma939UseShortAlma9CrossAboveVwapExit: body.alma939UseShortAlma9CrossAboveVwapExit }),
      ...(body.alma939UseStopLoss !== undefined && { alma939UseStopLoss: body.alma939UseStopLoss }),
      ...(body.alma939SlMode !== undefined && { alma939SlMode: body.alma939SlMode }),
      ...(body.alma939FixedSlPct !== undefined && { alma939FixedSlPct: body.alma939FixedSlPct }),
      ...(body.alma939TrailSlPct !== undefined && { alma939TrailSlPct: body.alma939TrailSlPct }),
      ...(body.alma939TrailUpdateMode !== undefined && { alma939TrailUpdateMode: body.alma939TrailUpdateMode }),
      ...(body.alma939UseProfitTargets !== undefined && { alma939UseProfitTargets: body.alma939UseProfitTargets }),
      ...(body.alma939UseTp1 !== undefined && { alma939UseTp1: body.alma939UseTp1 }),
      ...(body.alma939Tp1Pct !== undefined && { alma939Tp1Pct: body.alma939Tp1Pct }),
      ...(body.alma939Tp1Qty !== undefined && { alma939Tp1Qty: body.alma939Tp1Qty }),
      ...(body.alma939UseTp2 !== undefined && { alma939UseTp2: body.alma939UseTp2 }),
      ...(body.alma939Tp2Pct !== undefined && { alma939Tp2Pct: body.alma939Tp2Pct }),
      ...(body.alma939Tp2Qty !== undefined && { alma939Tp2Qty: body.alma939Tp2Qty }),
      ...(body.alma939UseTp3 !== undefined && { alma939UseTp3: body.alma939UseTp3 }),
      ...(body.alma939Tp3Pct !== undefined && { alma939Tp3Pct: body.alma939Tp3Pct }),
      ...(body.alma939Tp3Qty !== undefined && { alma939Tp3Qty: body.alma939Tp3Qty }),
      ...(body.alma939UseTp4 !== undefined && { alma939UseTp4: body.alma939UseTp4 }),
      ...(body.alma939Tp4Pct !== undefined && { alma939Tp4Pct: body.alma939Tp4Pct }),
      ...(body.alma939Tp4Qty !== undefined && { alma939Tp4Qty: body.alma939Tp4Qty }),
      ...(body.alma939UseTp5 !== undefined && { alma939UseTp5: body.alma939UseTp5 }),
      ...(body.alma939Tp5Pct !== undefined && { alma939Tp5Pct: body.alma939Tp5Pct }),
      ...(body.alma939Tp5Qty !== undefined && { alma939Tp5Qty: body.alma939Tp5Qty }),
      liveOrdersConfirmed: body.liveOrdersConfirmed,
      updatedAt: new Date(),
      updatedBy: admin.id,
    })
    .where(eq(botConfig.id, "default"));

  await db.insert(botActions).values({
    kind: "config_change",
    severity: "info",
    message: `BotWick Admin updated bot config (mode=${body.mode}, enabled=${body.enabled}, grade=${body.gradeFilter})`,
    data: {
      actor: admin.id,
      before: before
        ? {
            enabled: before.enabled,
            mode: before.mode,
            gradeFilter: before.gradeFilter,
            maxRiskPerTradeUsd: before.maxRiskPerTradeUsd,
            maxDailyLossUsd: before.maxDailyLossUsd,
            maxOpenPositions: before.maxOpenPositions,
          }
        : null,
      after: body,
    },
  });

  return NextResponse.json({ ok: true });
}
