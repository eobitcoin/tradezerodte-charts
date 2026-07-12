/**
 * Per-day scan helpers.
 *
 * The home page renders up to three "scans" of the same trading_day:
 *   - premarket   (8:30 ET routine, the original "0DTE Trading Research")
 *   - market_open (9:45 ET routine, duplicate of premarket on a later schedule)
 *   - analysis    (10:00 ET routine, comparative narrative across the two)
 *
 * Each is a row in `posts` with the same `trading_day` and a distinct
 * `scan_kind`. This module gives the page a single function to fetch all
 * three at once and a helper to pick the smart-default tab to show.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, botwickScans, type Post, type ScanKind, type BotwickScan } from "@/lib/db/schema";

export type DayScans = {
  tradingDay: string;
  /** 6:00 AM ET BotWick Analysis (Finora-style SMC read, own table). */
  botwick: BotwickScan | null;
  premarket: Post | null;
  marketOpen: Post | null;
  analysis: Post | null;
  /** Post-close (~4:15 PM ET) outcome-stamping scan. Feeds outcome/PnL
   *  overlays into the TRADE CARDS merge but doesn't get its own tab. */
  settlement: Post | null;
};

/** Fetch all scans for a specific trading day. Any can be null. */
export async function getScansForDay(tradingDay: string): Promise<DayScans> {
  const [rows, [botwick]] = await Promise.all([
    db.select().from(posts).where(eq(posts.tradingDay, tradingDay)),
    db.select().from(botwickScans).where(eq(botwickScans.scanDay, tradingDay)).limit(1),
  ]);
  return {
    tradingDay,
    botwick: botwick ?? null,
    premarket: rows.find((r) => r.scanKind === "premarket") ?? null,
    marketOpen: rows.find((r) => r.scanKind === "market_open") ?? null,
    analysis: rows.find((r) => r.scanKind === "analysis") ?? null,
    settlement: rows.find((r) => r.scanKind === "settlement") ?? null,
  };
}

/**
 * Fetch the most recent day that has ANY scan, then load all scans for that
 * day. Keyed on the max of (latest premarket day, latest BotWick day) so the
 * page flips to the new day at 6:00 AM when BotWick posts — hours before the
 * 8:30 premarket — instead of showing yesterday until premarket lands.
 */
export async function getLatestDayScans(): Promise<DayScans | null> {
  const [[latestPost], [latestBotwick]] = await Promise.all([
    db
      .select({ tradingDay: posts.tradingDay })
      .from(posts)
      .where(eq(posts.scanKind, "premarket"))
      .orderBy(desc(posts.tradingDay))
      .limit(1),
    db
      .select({ tradingDay: botwickScans.scanDay })
      .from(botwickScans)
      .orderBy(desc(botwickScans.scanDay))
      .limit(1),
  ]);
  const days = [latestPost?.tradingDay, latestBotwick?.tradingDay].filter(
    (d): d is string => Boolean(d),
  );
  if (days.length === 0) return null;
  return getScansForDay(days.sort().reverse()[0]);
}

/** Single-scan fetch (used by /posts/[date] when a specific scan is requested). */
export async function getPostByDayKind(
  tradingDay: string,
  scanKind: ScanKind,
): Promise<Post | null> {
  const [row] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.tradingDay, tradingDay), eq(posts.scanKind, scanKind)))
    .limit(1);
  return row ?? null;
}

/**
 * Pick the most-relevant tab to show by default, given which scans exist and
 * the current ET clock time.
 *
 *   ─ before 09:45 ET  → premarket (the only one available)
 *   ─ 09:45 – 10:00    → market_open if present (fresher data than premarket)
 *   ─ after 10:00      → analysis if present (most-synthesized view)
 *
 * Falls back gracefully when a tab's scan is missing.
 */
export type ScanTab =
  | "botwick"
  | "premarket"
  | "market_open"
  | "analysis"
  | "trade_cards"
  | "scorecard";

export function defaultTabFor(scans: DayScans, nowEtHHMM = currentEtHHMM()): ScanTab {
  const pastClose = nowEtHHMM >= "16:00";
  const past10 = nowEtHHMM >= "10:00";
  const past945 = nowEtHHMM >= "09:45";
  // After the close, default to TRADE CARDS so the new settlement stamps
  // and scorecard are front-and-center.
  if (pastClose && scans.settlement && scans.premarket) return "trade_cards";
  if (past10 && scans.analysis) return "analysis";
  if (past945 && scans.marketOpen) return "market_open";
  if (scans.premarket) return "premarket";
  // Between 6:00 (BotWick posts) and 8:30 (premarket posts), BotWick is the
  // freshest read of the day.
  if (scans.botwick) return "botwick";
  // Fallback chain when no premarket exists for this day.
  if (scans.marketOpen) return "market_open";
  if (scans.analysis) return "analysis";
  return "premarket";
}

function currentEtHHMM(): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  // Intl returns "24" for midnight in some runtimes — normalize.
  const hh = parts.hour === "24" ? "00" : (parts.hour ?? "00");
  return `${hh}:${parts.minute ?? "00"}`;
}
