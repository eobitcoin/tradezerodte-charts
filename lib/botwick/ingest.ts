/**
 * BotWick ingest pipeline.
 *
 * Phase 1 ("ghost mode"): given a research post, walk every trade in
 * `post.trades`, parse it, run the v1 static risk gates, and either
 *   - insert a `bot_trades` row with `status='pending'` (when allowed), or
 *   - log a `bot_actions` row explaining why it was skipped.
 *
 * Crucially: NO Tradier calls, NO orders. The Matrix tape lights up so the
 * admin can verify the bot understands each plan correctly before we ever
 * wire a real broker.
 *
 * Idempotency: re-ingesting the same post is safe — we de-dup on
 * (sourcePostDay, sourceTicker, strategy) and skip rows that already exist
 * in pending/working/open/closing state. Closed/rejected/errored rows do NOT
 * block re-ingest (re-running after a clean is fine).
 */

import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  botActions,
  botTrades,
  type BotConfig,
  type Post,
  type Trade,
  type BotTradeStatus,
} from "@/lib/db/schema";
import { parseTrade } from "./plan-parser";
import { evaluateStaticRisk } from "./risk";
import { buildDefaultExits, fillMissingExits } from "./default-exits";

const NON_TERMINAL: BotTradeStatus[] = ["pending", "working", "open", "closing"];

/**
 * Stale-plan sweep. Any pending / signal_armed bot_trade whose `source_post_day`
 * is older than the post we're about to ingest gets force-cancelled. This is
 * a fallback for the case where force-exit didn't run (bot disabled overnight,
 * cron down at 15:55, etc.); the regular day-trade force-exit at 15:55 ET is
 * the primary mechanism.
 *
 * Status `open` is NOT swept here. If a position survived overnight it's the
 * admin's intent (force-exit was off) OR a real failure we should leave for
 * human review — don't silently market-close it during a routine ingest.
 *
 * Returns the number of rows swept so the ingest summary can surface it.
 */
async function sweepStalePlans(tradingDay: string): Promise<number> {
  const swept = await db
    .update(botTrades)
    .set({ status: "cancelled", closedAt: new Date() })
    .where(
      and(
        inArray(botTrades.status, ["pending", "signal_armed"]),
        lt(botTrades.sourcePostDay, tradingDay),
      ),
    )
    .returning({
      id: botTrades.id,
      sourceTicker: botTrades.sourceTicker,
      strategy: botTrades.strategy,
      sourcePostDay: botTrades.sourcePostDay,
      prevStatus: botTrades.status,
    });

  for (const row of swept) {
    await db.insert(botActions).values({
      kind: "plan_expired",
      severity: "warn",
      message: `${row.sourceTicker} ${row.strategy} — expired (post day ${row.sourcePostDay ?? "—"} < ingest day ${tradingDay}, stale-plan sweep)`,
      tradeId: row.id,
      data: {
        reason: "stale_plan_sweep",
        prevPostDay: row.sourcePostDay,
        ingestDay: tradingDay,
      },
    });
  }
  return swept.length;
}

/** Map a Trade's direction to the strategy taxonomy used by `bot_trades.strategy`. */
function strategyFor(trade: Trade): string {
  if (trade.direction === "put" || trade.direction === "short") return "long_put";
  if (trade.direction === "call" || trade.direction === "long") return "long_call";
  return "unknown";
}

export type IngestSummary = {
  postDay: string;
  considered: number;
  inserted: number;
  skipped: { ticker: string; reason: string; code: string }[];
  warnings: { ticker: string; messages: string[] }[];
  staleSwept: number;
};

export async function ingestPost(args: {
  post: Post;
  config: BotConfig;
  /** Admin actor id (audit only). Email is intentionally not accepted so it
   *  can't leak into tape messages — tape always says "BotWick Admin". */
  actor?: { id: string };
}): Promise<IngestSummary> {
  const { post, config, actor } = args;
  const trades = (post.trades || []) as Trade[];
  const tradingDay = String(post.tradingDay).slice(0, 10);

  // One snapshot of open-position count for the whole post. The risk engine
  // is otherwise pure; this is a passed-in stat, not a side effect.
  const openRows = await db
    .select({ id: botTrades.id })
    .from(botTrades)
    .where(inArray(botTrades.status, NON_TERMINAL));
  let openCount = openRows.length;

  // Stale-plan sweep first — clear any unfired plans from prior days
  // before ingesting today's. See sweepStalePlans() for rationale.
  const staleSwept = await sweepStalePlans(tradingDay);

  const summary: IngestSummary = {
    postDay: tradingDay,
    considered: 0,
    inserted: 0,
    skipped: [],
    warnings: [],
    staleSwept,
  };

  // Header event so the tape shows ingest boundaries.
  await db.insert(botActions).values({
    kind: "config_change",
    severity: "info",
    message: `Ingest started for ${tradingDay} (${trades.length} trade${trades.length === 1 ? "" : "s"} in post)${staleSwept > 0 ? ` · swept ${staleSwept} stale plan${staleSwept === 1 ? "" : "s"}` : ""}${actor ? ` — by BotWick Admin` : ""}`,
    data: {
      postDay: tradingDay,
      postId: post.id,
      tradeCount: trades.length,
      staleSwept,
      actor: actor?.id,
    },
  });

  for (const trade of trades) {
    summary.considered += 1;

    const parsedRaw = parseTrade(trade);

    // Fill in any null target/stop branches with config defaults so the
    // trade has a safety net even if the parser didn't pick them up.
    // time_stop default is computed later at signal_armed (we don't have
    // an entry ET yet at ingest).
    const defaults = buildDefaultExits(config);
    const filledAst = fillMissingExits(parsedRaw.ast, defaults);
    // Re-evaluate the "parsed" flag now that target/stop are guaranteed
    // non-null. Entry condition + contract still need to be recognised.
    const reparsedFlag =
      parsedRaw.contract.optionType !== null &&
      parsedRaw.contract.strike !== null &&
      filledAst.entry !== null;
    const fillNote: string[] = [];
    if (parsedRaw.ast.target1 == null) fillNote.push("target1 default applied");
    if (parsedRaw.ast.target2 == null) fillNote.push("target2 default applied");
    if (parsedRaw.ast.stop == null) fillNote.push("stop default applied");
    const parsed = {
      ...parsedRaw,
      ast: filledAst,
      parsed: reparsedFlag,
      warnings: fillNote.length
        ? [...parsedRaw.warnings, ...fillNote]
        : parsedRaw.warnings,
    };

    if (parsed.warnings.length > 0) {
      summary.warnings.push({ ticker: trade.ticker, messages: parsed.warnings });
    }

    const decision = evaluateStaticRisk({
      config,
      trade,
      parsed,
      openPositionsCount: openCount,
    });

    if (!decision.ok) {
      // Pick the right event kind so severity in the UI matches intent.
      const kind = decision.code === "grade_below_filter" ? "plan_skipped" : "risk_block";
      await db.insert(botActions).values({
        kind,
        severity: decision.code === "kill_switch" ? "error" : "warn",
        message: `${trade.ticker} ${strategyFor(trade)} — ${decision.reason}`,
        data: {
          postDay: tradingDay,
          ticker: trade.ticker,
          code: decision.code,
          parsed,
          trade,
        },
      });
      summary.skipped.push({
        ticker: trade.ticker,
        reason: decision.reason,
        code: decision.code,
      });
      continue;
    }

    // De-dup: if we've already created a non-terminal bot_trade for this
    // (post day, ticker, strategy), skip it. This makes the admin "Ingest"
    // button safely re-runnable.
    const existing = await db
      .select({ id: botTrades.id, status: botTrades.status })
      .from(botTrades)
      .where(
        and(
          eq(botTrades.sourcePostDay, tradingDay),
          eq(botTrades.sourceTicker, trade.ticker),
          eq(botTrades.strategy, strategyFor(trade)),
          inArray(botTrades.status, NON_TERMINAL),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      await db.insert(botActions).values({
        kind: "plan_skipped",
        severity: "info",
        message: `${trade.ticker} ${strategyFor(trade)} — duplicate of existing ${existing[0].status} trade`,
        tradeId: existing[0].id,
        data: { reason: "duplicate", existingId: existing[0].id },
      });
      summary.skipped.push({
        ticker: trade.ticker,
        reason: `duplicate of existing ${existing[0].status} trade`,
        code: "duplicate",
      });
      continue;
    }

    // Initial sizing based on plan mid. OMS will RE-SIZE at submit time using
    // the live mid (which is the source of truth for risk); this number is
    // primarily for the pre-flight $/cap math the risk engine already does +
    // an honest leg.qty so the UI doesn't lie. Floor by max-risk so we never
    // intend to exceed the per-trade cap even if positionSize is generous.
    const planMid = parsed.entryMidEstimate;
    const positionSize = Number(config.positionSizeUsd);
    const perTradeCap = Number(config.maxRiskPerTradeUsd);
    const budget = Math.min(positionSize, perTradeCap);
    const initialQty =
      planMid != null && planMid > 0 ? Math.max(1, Math.floor(budget / (planMid * 100))) : 1;

    const leg = {
      side: "buy_to_open" as const,
      option_type: parsed.contract.optionType,
      strike: parsed.contract.strike,
      expiry: parsed.contract.expiry,
      occ_symbol: parsed.contract.occSymbol,
      qty: initialQty,
    };

    const [inserted] = await db
      .insert(botTrades)
      .values({
        sourcePostDay: tradingDay,
        sourceTicker: trade.ticker,
        sourceGrade: trade.grade ?? null,
        strategy: strategyFor(trade),
        legs: [leg],
        plan: {
          trade,
          ast: parsed.ast,
          contract: parsed.contract,
          entryMidEstimate: parsed.entryMidEstimate,
          entryZoneRange: parsed.entryZoneRange,
        },
        mode: config.mode,
        status: "pending",
      })
      .returning({ id: botTrades.id });

    await db.insert(botActions).values({
      kind: "plan_received",
      severity: "success",
      message: `${trade.ticker} ${strategyFor(trade)} grade=${trade.grade ?? "—"} strike=${parsed.contract.strike ?? "?"} mid≈$${parsed.entryMidEstimate?.toFixed(2) ?? "?"}`,
      tradeId: inserted.id,
      data: {
        postDay: tradingDay,
        ticker: trade.ticker,
        grade: trade.grade,
        contract: parsed.contract,
        entryMid: parsed.entryMidEstimate,
        warnings: parsed.warnings,
      },
    });

    summary.inserted += 1;
    openCount += 1; // keeps subsequent concurrency checks honest within the post
  }

  // Trailer event.
  await db.insert(botActions).values({
    kind: "config_change",
    severity: "info",
    message: `Ingest done — considered=${summary.considered} inserted=${summary.inserted} skipped=${summary.skipped.length}`,
    data: summary,
  });

  return summary;
}
