/**
 * Cross-day scorecard aggregation. Reads every published settlement post
 * (scan_kind="settlement") plus the merged trade plan for that day, runs
 * the same outcome aggregation TRADE CARDS uses, and emits per-session +
 * per-ticker rollups for the SCORECARD tab.
 *
 * Same data the TRADE CARDS tab consumes — just cross-day. No new tables.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { mergeDayScans, scorecardFor, type DayScorecard } from "@/lib/merge-trades";

export interface SessionRow {
  tradingDay: string;
  /** Aggregate stats for that day. */
  scorecard: DayScorecard;
}

export interface TickerRow {
  ticker: string;
  sessions: number;
  wins: number;
  losses: number;
  noFills: number;
  timeStops: number;
  manualExits: number;
  /** Sum of pnl_pct across all resolved trades for this ticker. */
  netPnlPct: number;
  /** Per-trade avg (netPnlPct / resolvedCount). */
  avgPnlPct: number;
  /** wins / (wins + losses), or null if no completed trades. */
  winRate: number | null;
}

export interface ScorecardData {
  /** Most-recent first. */
  sessions: SessionRow[];
  /** Aggregate across all sessions. */
  overall: {
    sessionCount: number;
    totalTrades: number;
    wins: number;
    losses: number;
    noFills: number;
    timeStops: number;
    manualExits: number;
    netPnlPct: number;
    winRate: number | null;
    bestSession: SessionRow | null;
    worstSession: SessionRow | null;
    bestTicker: TickerRow | null;
    worstTicker: TickerRow | null;
  };
  /** Sorted desc by netPnlPct. */
  tickers: TickerRow[];
}

export async function loadScorecard(): Promise<ScorecardData> {
  // Pull every settlement post + the same-day premarket / market_open /
  // analysis rows so we can run the same mergeDayScans the TRADE CARDS
  // tab uses. Done in two queries: one for settlement days, one for the
  // remaining same-day rows.
  const settlementRows = await db
    .select()
    .from(posts)
    .where(eq(posts.scanKind, "settlement"))
    .orderBy(desc(posts.tradingDay));

  if (settlementRows.length === 0) {
    return {
      sessions: [],
      overall: {
        sessionCount: 0,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        noFills: 0,
        timeStops: 0,
        manualExits: 0,
        netPnlPct: 0,
        winRate: null,
        bestSession: null,
        worstSession: null,
        bestTicker: null,
        worstTicker: null,
      },
      tickers: [],
    };
  }

  // Pull every same-day partner row in one shot. Keyed by (trading_day, scan_kind).
  const tradingDays = settlementRows.map((r) => r.tradingDay);
  const partnerRows =
    tradingDays.length > 0
      ? await db.select().from(posts).where(
          // drizzle-orm requires inArray for SQL IN; import lazily
          (await import("drizzle-orm")).inArray(posts.tradingDay, tradingDays),
        )
      : [];

  const byDay = new Map<string, { premarket: typeof partnerRows[number] | null; marketOpen: typeof partnerRows[number] | null; analysis: typeof partnerRows[number] | null; settlement: typeof partnerRows[number] | null }>();
  for (const day of tradingDays) {
    byDay.set(day, { premarket: null, marketOpen: null, analysis: null, settlement: null });
  }
  for (const row of partnerRows) {
    const slot = byDay.get(row.tradingDay);
    if (!slot) continue;
    if (row.scanKind === "premarket") slot.premarket = row;
    else if (row.scanKind === "market_open") slot.marketOpen = row;
    else if (row.scanKind === "analysis") slot.analysis = row;
    else if (row.scanKind === "settlement") slot.settlement = row;
  }

  const sessions: SessionRow[] = [];
  const tickerAgg = new Map<string, TickerRow>();

  for (const day of tradingDays) {
    const slot = byDay.get(day);
    if (!slot) continue;
    const { trades } = mergeDayScans({
      premarket: slot.premarket,
      marketOpen: slot.marketOpen,
      analysis: slot.analysis,
      settlement: slot.settlement,
    });
    const sc = scorecardFor(trades);
    sessions.push({ tradingDay: day, scorecard: sc });

    // Per-ticker accumulation
    for (const t of trades) {
      if (!t.outcome) continue;
      const key = t.ticker.toUpperCase();
      const row = tickerAgg.get(key) ?? {
        ticker: key,
        sessions: 0,
        wins: 0,
        losses: 0,
        noFills: 0,
        timeStops: 0,
        manualExits: 0,
        netPnlPct: 0,
        avgPnlPct: 0,
        winRate: null,
      };
      row.sessions += 1;
      switch (t.outcome) {
        case "target1_hit":
        case "target2_hit":
          row.wins += 1;
          break;
        case "stopped":
          row.losses += 1;
          break;
        case "no_fill":
          row.noFills += 1;
          break;
        case "time_stopped":
          row.timeStops += 1;
          break;
        case "manual_exit":
          row.manualExits += 1;
          break;
      }
      if (typeof t.pnl_pct === "number" && Number.isFinite(t.pnl_pct)) {
        row.netPnlPct += t.pnl_pct;
      }
      tickerAgg.set(key, row);
    }
  }

  // Finalize ticker rows
  const tickers: TickerRow[] = [];
  for (const row of tickerAgg.values()) {
    const denom = row.wins + row.losses;
    row.winRate = denom > 0 ? row.wins / denom : null;
    row.avgPnlPct = row.sessions > 0 ? row.netPnlPct / row.sessions : 0;
    tickers.push(row);
  }
  tickers.sort((a, b) => b.netPnlPct - a.netPnlPct);

  // Overall aggregate
  let totalTrades = 0;
  let wins = 0;
  let losses = 0;
  let noFills = 0;
  let timeStops = 0;
  let manualExits = 0;
  let netPnlPct = 0;
  let bestSession: SessionRow | null = null;
  let worstSession: SessionRow | null = null;
  for (const s of sessions) {
    totalTrades += s.scorecard.total;
    wins += s.scorecard.wins;
    losses += s.scorecard.losses;
    noFills += s.scorecard.noFills;
    timeStops += s.scorecard.timeStops;
    manualExits += s.scorecard.manualExits;
    netPnlPct += s.scorecard.netPnlPct;
    if (s.scorecard.hasOutcomes) {
      if (bestSession == null || s.scorecard.netPnlPct > bestSession.scorecard.netPnlPct) {
        bestSession = s;
      }
      if (worstSession == null || s.scorecard.netPnlPct < worstSession.scorecard.netPnlPct) {
        worstSession = s;
      }
    }
  }
  const overallDenom = wins + losses;
  const bestTicker = tickers.length > 0 ? tickers[0] : null;
  const worstTicker = tickers.length > 0 ? tickers[tickers.length - 1] : null;

  return {
    sessions,
    overall: {
      sessionCount: sessions.length,
      totalTrades,
      wins,
      losses,
      noFills,
      timeStops,
      manualExits,
      netPnlPct,
      winRate: overallDenom > 0 ? wins / overallDenom : null,
      bestSession,
      worstSession,
      bestTicker,
      worstTicker,
    },
    tickers,
  };
}
