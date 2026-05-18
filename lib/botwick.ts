/**
 * BotWick — shared helpers for reading bot state.
 *
 * The bot is intentionally OFF by default. There is exactly one config row
 * (id = "default") which the admin UI mutates. The user-facing Matrix view
 * reads the same row plus the recent `bot_actions` event stream.
 */

import { desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  botActions,
  botAlmaState,
  botConfig,
  botTrades,
  type BotAction,
  type BotAlmaState,
  type BotConfig,
  type BotTrade,
} from "@/lib/db/schema";

const SINGLETON_ID = "default";

/**
 * Lazy-init: returns the singleton bot_config row, creating it on first read.
 * Idempotent — safe to call from server components.
 */
export async function getBotConfig(): Promise<BotConfig> {
  const [existing] = await db
    .select()
    .from(botConfig)
    .where(eq(botConfig.id, SINGLETON_ID))
    .limit(1);
  if (existing) return existing;

  // Insert the singleton with column-level defaults. ON CONFLICT DO NOTHING
  // protects against a race where two requests both miss the SELECT.
  await db
    .insert(botConfig)
    .values({ id: SINGLETON_ID })
    .onConflictDoNothing({ target: botConfig.id });

  const [created] = await db
    .select()
    .from(botConfig)
    .where(eq(botConfig.id, SINGLETON_ID))
    .limit(1);
  if (!created) {
    throw new Error("bot_config singleton failed to materialize");
  }
  return created;
}

/**
 * Recent events for the Matrix-stream user view. We cap at `limit` and trust
 * the UI to handle empty states.
 */
export async function getRecentBotActions(limit = 50): Promise<BotAction[]> {
  return db
    .select()
    .from(botActions)
    .where(isNull(botActions.archivedAt))
    .orderBy(desc(botActions.ts))
    .limit(limit);
}

/**
 * Open / in-flight trades for the user dashboard panel. "Open" here means
 * any non-terminal status — a trade that's still part of the live tape.
 */
/** Current ALMA × VWAP READY states — one row per ticker that's armed but
 *  hasn't fired yet. Surfaced on the Activity tab so users can see what the
 *  bot is *about* to do. */
export async function getAlmaReadyStates(): Promise<BotAlmaState[]> {
  return db.select().from(botAlmaState).orderBy(desc(botAlmaState.readyAt));
}

export async function getActiveBotTrades(limit = 25): Promise<BotTrade[]> {
  return db
    .select()
    .from(botTrades)
    .where(isNull(botTrades.archivedAt))
    .orderBy(desc(botTrades.signaledAt))
    .limit(limit);
}

/**
 * UI-friendly summary: how the bot is presenting *right now* to a user.
 * The runner (separate process, not built yet) is what actually drives this
 * state; for now the UI reads it and renders accordingly.
 */
export type BotStatus = "off" | "armed" | "trading" | "halted" | "paper";
export function deriveStatus(cfg: BotConfig): BotStatus {
  if (cfg.killSwitchEngaged) return "halted";
  if (!cfg.enabled) return "off";
  if (cfg.mode === "paper") return "paper";
  if (cfg.mode === "live") return "trading";
  return "armed";
}
