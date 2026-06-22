/**
 * Aggregator for the logged-in dashboard at `/`.
 *
 * Single server entry point `loadDashboardData()` runs every read in parallel
 * and returns a compact view-model: a hero video (most recent of daily 0DTE
 * briefing OR weekly earnings brief), a small market-pulse block, three
 * surface snippets (Earnings / Short Interest Squeeze / Sector Flow), and
 * an activity feed of the last ~8 cross-surface publishing events.
 *
 * Everything here is read-only and tolerant of empty tables — fresh deploys
 * still render the shell with grey placeholders. No data source is required
 * for the page to load.
 */

import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fetchMarketTape, type MarketTapeData } from "@/lib/market-tape";
import {
  briefings,
  weeklyEarningsBriefings,
  earningsPosts,
  squeezeScans,
  sectorRotationPosts,
  optionsEdgeScans,
  leapScans,
  sectorFlowBars,
  economicEvents,
  cryptoPosts,
  posts,
  type SqueezeCandidate,
  type SqueezeTradeIdea,
  type OptionsEdgeAnomaly,
  type CryptoTrade,
  type Trade,
} from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export interface DashboardHeroVideo {
  kind: "weekly_earnings" | "daily_briefing";
  anchorDate: string;           // YYYY-MM-DD
  thumbnailUrl: string | null;
  videoHref: string;            // page link
  durationLabel: string | null; // "0:48"
  caption: string | null;       // first sentence of script
  tickers: string[];            // surfaced as chips
}

export interface DashboardEconEvent {
  title: string;
  country: string | null;
  when: string;                 // ISO
  importance: "low" | "medium" | "high";
}

export interface DashboardPreMarketPick {
  ticker: string;
  direction: "long" | "short" | "neutral" | "avoid" | null;
  strike: string | null;
  expiry: string | null;
}

export interface DashboardMarketPulse {
  nextEconEvents: DashboardEconEvent[];
  preMarketPicks: {
    tradingDay: string;
    picks: DashboardPreMarketPick[];
  } | null;
}

export interface DashboardOptionsEdgeSnippet {
  scanDay: string;
  totalAnomalies: number;
  top: Array<{
    ticker: string;
    metric: string;             // "atm_iv_rank" / "skew_z" / etc
    zScore: number;
    direction: "high" | "low";
    suggestedStrategy: string;
  }>;
}

export interface DashboardEarningsSnippet {
  scanDay: string;
  totalStocks: number;
  flaggedCount: number;
  upcoming: Array<{ ticker: string; date: string; time: string }>;
}

export interface DashboardSqueezeSnippet {
  scanDay: string;
  top: {
    ticker: string;
    companyName: string | null;
    score: number;
    siPct: number | null;
    daysToCover: number;
    tradeIdeas: SqueezeTradeIdea[];
  } | null;
}

export interface DashboardSectorFlowSnippet {
  asOf: string | null;
  top: {
    ticker: string;
    priceChangePct: number | null;
    netFlowShares: number;
  } | null;
  bars: Array<{ ticker: string; netFlowShares: number; up: boolean }>;
}

export interface DashboardActivityEvent {
  at: string;                   // ISO timestamp
  surface: string;              // "Weekly Earnings Brief"
  title: string;
  detail: string | null;
  href: string;
  icon: string;                 // Tabler icon name (without "ti-" prefix)
}

export interface DashboardCryptoSnippet {
  scanDay: string;
  headline: string;
  trades: CryptoTrade[];      // filtered to BTC/ETH/SOL, in that order
}

export interface DashboardData {
  tape: MarketTapeData;
  hero: DashboardHeroVideo | null;
  pulse: DashboardMarketPulse;
  optionsEdge: DashboardOptionsEdgeSnippet | null;
  earnings: DashboardEarningsSnippet | null;
  squeeze: DashboardSqueezeSnippet | null;
  crypto: DashboardCryptoSnippet | null;
  feed: DashboardActivityEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** First sentence-ish snippet — used for hero caption + activity detail. */
function firstSentence(s: string | null | undefined, max = 140): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  // Find first sentence terminator that's not inside a number/decimal.
  const dotIdx = trimmed.search(/[.!?]\s/);
  const out = dotIdx > 0 && dotIdx < max ? trimmed.slice(0, dotIdx + 1) : trimmed.slice(0, max);
  return out.length === trimmed.length ? out : out.trim() + (dotIdx < 0 ? "…" : "");
}

/** "5d ago" / "2h ago" / "just now" for the activity feed timestamps. */
export function relativeTime(iso: string, nowMs = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const deltaMs = nowMs - t;
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Per-surface loaders
// ---------------------------------------------------------------------------

async function loadHero(): Promise<DashboardHeroVideo | null> {
  // Pick the more-recent of (daily briefing, weekly earnings brief) where
  // the MP4 has actually rendered (videoS3Key present is the universal
  // signal across all post-render statuses: pending_upload / uploading /
  // posted). Picking by status would miss rows mid-publish.
  const [daily] = await db
    .select()
    .from(briefings)
    .where(isNotNull(briefings.videoS3Key))
    .orderBy(desc(briefings.tradingDay))
    .limit(1);
  const [weekly] = await db
    .select()
    .from(weeklyEarningsBriefings)
    .where(isNotNull(weeklyEarningsBriefings.videoS3Key))
    .orderBy(desc(weeklyEarningsBriefings.weekAnchor))
    .limit(1);

  // Compare on the most-recent updatedAt; both rows track that.
  const dailyAt = daily?.updatedAt?.getTime() ?? -Infinity;
  const weeklyAt = weekly?.updatedAt?.getTime() ?? -Infinity;
  if (dailyAt < 0 && weeklyAt < 0) return null;

  if (weeklyAt >= dailyAt && weekly) {
    return {
      kind: "weekly_earnings",
      anchorDate: weekly.weekAnchor,
      thumbnailUrl: weekly.thumbnailUrl,
      videoHref: `/morning-brief/earnings/${weekly.weekAnchor}`,
      durationLabel: null,
      caption: firstSentence(weekly.script),
      tickers: weekly.tickers ?? [],
    };
  }
  if (daily) {
    return {
      kind: "daily_briefing",
      anchorDate: daily.tradingDay,
      thumbnailUrl: daily.thumbnailUrl,
      videoHref: `/morning-brief`,
      durationLabel: null,
      caption: firstSentence(daily.script),
      tickers: daily.tickers ?? [],
    };
  }
  return null;
}

async function loadMarketPulse(): Promise<DashboardMarketPulse> {
  // Next 3 high/medium-importance economic events from now forward.
  const now = new Date();
  const upcomingHorizon = new Date(now.getTime() + 14 * 24 * 60 * 60_000);
  const econ = await db
    .select()
    .from(economicEvents)
    .where(
      and(
        gte(economicEvents.eventTime, now),
        gte(economicEvents.eventTime, now),
        inArray(economicEvents.importance, ["high", "medium"]),
      ),
    )
    .orderBy(economicEvents.eventTime)
    .limit(20);
  const nextEconEvents: DashboardEconEvent[] = econ
    .filter((e) => e.eventTime <= upcomingHorizon)
    // Prefer high-importance first, then chronological within importance.
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 } as const;
      const ai = order[a.importance];
      const bi = order[b.importance];
      if (ai !== bi) return ai - bi;
      return a.eventTime.getTime() - b.eventTime.getTime();
    })
    .slice(0, 3)
    .map((e) => ({
      title: e.title,
      country: e.country,
      when: e.eventTime.toISOString(),
      importance: e.importance,
    }));

  // Most recent premarket post — pick the top 3 trades, normalize shape.
  const [premarket] = await db
    .select()
    .from(posts)
    .where(eq(posts.scanKind, "premarket"))
    .orderBy(desc(posts.tradingDay))
    .limit(1);

  let preMarketPicks: DashboardMarketPulse["preMarketPicks"] = null;
  if (premarket) {
    const trades = (premarket.trades ?? []) as Trade[];
    // Trades may already be ranked; if not, the first N is fine.
    const ranked = [...trades].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 3);
    if (ranked.length > 0) {
      preMarketPicks = {
        tradingDay: premarket.tradingDay,
        picks: ranked.map((t) => ({
          ticker: t.ticker,
          direction: (t.direction ?? null) as DashboardPreMarketPick["direction"],
          strike: t.strike != null ? String(t.strike) : null,
          expiry: t.expiry ?? null,
        })),
      };
    }
  }

  return {
    nextEconEvents,
    preMarketPicks,
  };
}

async function loadOptionsEdgeSnippet(): Promise<DashboardOptionsEdgeSnippet | null> {
  const [row] = await db
    .select()
    .from(optionsEdgeScans)
    .orderBy(desc(optionsEdgeScans.scanDay))
    .limit(1);
  if (!row) return null;
  const anomalies = (row.anomalies ?? []) as OptionsEdgeAnomaly[];
  return {
    scanDay: row.scanDay,
    totalAnomalies: anomalies.length,
    top: anomalies.slice(0, 3).map((a) => ({
      ticker: a.ticker,
      metric: a.metric,
      zScore: a.zScore,
      direction: a.direction,
      suggestedStrategy: a.suggestedStrategy ?? "",
    })),
  };
}

async function loadEarningsSnippet(): Promise<DashboardEarningsSnippet | null> {
  const [row] = await db
    .select()
    .from(earningsPosts)
    .orderBy(desc(earningsPosts.scanDay))
    .limit(1);
  if (!row) return null;
  const stocks = (row.stocks as Array<{
    ticker: string;
    isFlagged?: boolean;
    earningsDate?: string;
    earningsTime?: string;
  }>) ?? [];
  return {
    scanDay: row.scanDay,
    totalStocks: stocks.length,
    flaggedCount: stocks.filter((s) => s.isFlagged).length,
    upcoming: stocks.slice(0, 3).map((s) => ({
      ticker: s.ticker,
      date: s.earningsDate ?? "",
      time: (s.earningsTime ?? "").toUpperCase(),
    })),
  };
}

async function loadSqueezeSnippet(): Promise<DashboardSqueezeSnippet | null> {
  const [row] = await db
    .select()
    .from(squeezeScans)
    .orderBy(desc(squeezeScans.scanDay))
    .limit(1);
  if (!row) return null;
  const candidates = (row.candidates ?? []) as SqueezeCandidate[];
  const top = candidates[0];
  return {
    scanDay: row.scanDay,
    top: top
      ? {
          ticker: top.ticker,
          companyName: top.companyName,
          score: top.compositeScore,
          siPct: top.shortInterestPctSO,
          daysToCover: top.daysToCover,
          tradeIdeas: top.tradeIdeas ?? [],
        }
      : null,
  };
}

async function loadSectorFlowSnippet(): Promise<DashboardSectorFlowSnippet | null> {
  // Find the most recent bar, then aggregate all bars on the same NY-tz date.
  const [latestRow] = await db
    .select({ max: sql<Date>`MAX(${sectorFlowBars.windowStart})` })
    .from(sectorFlowBars);
  const latest = latestRow?.max ? new Date(latestRow.max) : null;
  if (!latest) return null;

  // Wide-cutoff prefilter + JS aggregate (same approach as /api/sector-flow).
  const wideCutoff = new Date(latest.getTime() - 24 * 60 * 60_000);
  const bars = await db
    .select()
    .from(sectorFlowBars)
    .where(gte(sectorFlowBars.windowStart, wideCutoff));
  if (bars.length === 0) return { asOf: latest.toISOString(), top: null, bars: [] };

  // Pick the latest NY-tz session present.
  const byTicker = new Map<
    string,
    { buy: number; sell: number; firstOpen: number | null; lastClose: number | null }
  >();
  for (const b of bars) {
    const agg = byTicker.get(b.ticker) ?? { buy: 0, sell: 0, firstOpen: null, lastClose: null };
    agg.buy += Number(b.buyVolume);
    agg.sell += Number(b.sellVolume);
    if (agg.firstOpen == null && b.openPrice != null) agg.firstOpen = Number(b.openPrice);
    if (b.closePrice != null) agg.lastClose = Number(b.closePrice);
    byTicker.set(b.ticker, agg);
  }

  let top: { ticker: string; netFlow: number; pct: number | null } | null = null;
  const list: Array<{ ticker: string; netFlowShares: number; up: boolean }> = [];
  for (const [ticker, a] of byTicker) {
    const net = a.buy - a.sell;
    const pct =
      a.firstOpen != null && a.lastClose != null && a.firstOpen > 0
        ? ((a.lastClose - a.firstOpen) / a.firstOpen) * 100
        : null;
    list.push({ ticker, netFlowShares: net, up: net >= 0 });
    if (!top || Math.abs(net) > Math.abs(top.netFlow)) {
      top = { ticker, netFlow: net, pct };
    }
  }
  list.sort((a, b) => Math.abs(b.netFlowShares) - Math.abs(a.netFlowShares));

  return {
    asOf: latest.toISOString(),
    top: top
      ? {
          ticker: top.ticker,
          priceChangePct: top.pct,
          netFlowShares: top.netFlow,
        }
      : null,
    bars: list.slice(0, 8),
  };
}

async function loadActivityFeed(): Promise<DashboardActivityEvent[]> {
  // Pull the most-recent row from each surface in parallel; merge + sort desc.
  const [b1, b2, b3, b4, b5, b6, b7] = await Promise.all([
    db.select().from(briefings).orderBy(desc(briefings.tradingDay)).limit(1),
    db
      .select()
      .from(weeklyEarningsBriefings)
      .orderBy(desc(weeklyEarningsBriefings.weekAnchor))
      .limit(1),
    db.select().from(earningsPosts).orderBy(desc(earningsPosts.scanDay)).limit(1),
    db.select().from(squeezeScans).orderBy(desc(squeezeScans.scanDay)).limit(1),
    db.select().from(sectorRotationPosts).orderBy(desc(sectorRotationPosts.scanDay)).limit(1),
    db.select().from(optionsEdgeScans).orderBy(desc(optionsEdgeScans.scanDay)).limit(1),
    db.select().from(leapScans).orderBy(desc(leapScans.scanDay)).limit(1),
  ]);

  const events: DashboardActivityEvent[] = [];
  if (b1[0]) {
    events.push({
      at: (b1[0].updatedAt ?? b1[0].createdAt).toISOString(),
      surface: "Daily 0DTE Briefing",
      title: `Briefing for ${b1[0].tradingDay}`,
      detail: b1[0].videoS3Key ? "Video published" : `Status: ${b1[0].status}`,
      href: "/morning-brief",
      icon: "player-play",
    });
  }
  if (b2[0]) {
    events.push({
      at: (b2[0].updatedAt ?? b2[0].createdAt).toISOString(),
      surface: "Weekly Earnings Brief",
      title: `Week of ${b2[0].weekAnchor}`,
      detail: b2[0].videoS3Key ? "Video published" : `Status: ${b2[0].status}`,
      href: `/morning-brief/earnings/${b2[0].weekAnchor}`,
      icon: "calendar-event",
    });
  }
  if (b3[0]) {
    const stocks = (b3[0].stocks as Array<{ isFlagged?: boolean }>) ?? [];
    const flagged = stocks.filter((s) => s.isFlagged).length;
    events.push({
      at: (b3[0].updatedAt ?? b3[0].createdAt).toISOString(),
      surface: "Earnings Whiplash",
      title: `Scan ${b3[0].scanDay}`,
      detail: `${stocks.length} stocks ranked · ${flagged} flagged`,
      href: "/research/earnings",
      icon: "alert-triangle",
    });
  }
  if (b4[0]) {
    events.push({
      at: (b4[0].updatedAt ?? b4[0].runAt).toISOString(),
      surface: "Short Interest Squeeze",
      title: `Scan ${b4[0].scanDay}`,
      detail: `${b4[0].rankedSize} candidates ranked`,
      href: "/research/squeeze",
      icon: "flame",
    });
  }
  if (b5[0]) {
    const sectors = (b5[0].sectors as Array<{ isRotating?: boolean }>) ?? [];
    const rotating = sectors.filter((s) => s.isRotating).length;
    events.push({
      at: (b5[0].updatedAt ?? b5[0].createdAt).toISOString(),
      surface: "Sector Rotation",
      title: `Scan ${b5[0].scanDay}`,
      detail: `${rotating} of ${sectors.length} sectors flipped`,
      href: "/sector/rotation",
      icon: "arrows-shuffle",
    });
  }
  if (b6[0]) {
    const anomalies = Array.isArray(b6[0].anomalies) ? b6[0].anomalies.length : 0;
    events.push({
      at: (b6[0].updatedAt ?? b6[0].createdAt).toISOString(),
      surface: "Options Edge",
      title: `Scan ${b6[0].scanDay}`,
      detail: `${anomalies} anomalies flagged`,
      href: "/research/options-edge",
      icon: "chart-line",
    });
  }
  if (b7[0]) {
    const picks = Array.isArray(b7[0].picks) ? b7[0].picks.length : 0;
    events.push({
      at: (b7[0].updatedAt ?? b7[0].runAt).toISOString(),
      surface: "LEAPs",
      title: `Scan ${b7[0].scanDay}`,
      detail: `${picks} picks`,
      href: "/research/leaps",
      icon: "calendar-stats",
    });
  }
  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return events.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function loadCryptoSnippet(): Promise<DashboardCryptoSnippet | null> {
  const [row] = await db
    .select()
    .from(cryptoPosts)
    .orderBy(desc(cryptoPosts.scanDay))
    .limit(1);
  if (!row) return null;
  const all = (row.trades ?? []) as CryptoTrade[];
  // Pull BTC/ETH/SOL in that fixed order. Match common ticker shapes:
  // "BTCUSDT", "BTC-USD", "BTC", etc.
  const want: Array<{ key: string; aliases: string[] }> = [
    { key: "BTC", aliases: ["BTC", "BTCUSDT", "BTC-USD", "BTCUSD"] },
    { key: "ETH", aliases: ["ETH", "ETHUSDT", "ETH-USD", "ETHUSD"] },
    { key: "SOL", aliases: ["SOL", "SOLUSDT", "SOL-USD", "SOLUSD"] },
  ];
  const trades: CryptoTrade[] = [];
  for (const w of want) {
    const found = all.find((t) =>
      w.aliases.some((a) => (t.ticker ?? "").toUpperCase() === a),
    );
    if (found) trades.push(found);
  }
  return {
    scanDay: row.scanDay,
    headline: row.headline ?? "",
    trades,
  };
}

export async function loadDashboardData(): Promise<DashboardData> {
  // Market tape failure is non-fatal — we just render an empty strip.
  const tapePromise = fetchMarketTape().catch((err): MarketTapeData => ({
    asOf: new Date().toISOString(),
    metrics: [],
    errors: [err instanceof Error ? err.message : String(err)],
  }));

  const [tape, hero, pulse, optionsEdge, earnings, squeeze, crypto, feed] = await Promise.all([
    tapePromise,
    loadHero(),
    loadMarketPulse(),
    loadOptionsEdgeSnippet(),
    loadEarningsSnippet(),
    loadSqueezeSnippet(),
    loadCryptoSnippet(),
    loadActivityFeed(),
  ]);
  return { tape, hero, pulse, optionsEdge, earnings, squeeze, crypto, feed };
}
