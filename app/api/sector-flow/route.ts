import { NextResponse } from "next/server";
import { asc, gte, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { sectorFlowBars } from "@/lib/db/schema";
import {
  SECTOR_FLOW_UNIVERSE,
  SECTOR_FLOW_GROUPS,
  type SectorTicker,
} from "@/lib/sector-flow";

/**
 * GET /api/sector-flow?timeframe=<5m|1h|1d|1w>
 *
 * Rolls sector_flow_bars up to a per-ticker aggregate for the requested
 * window. Powers the /sector page's bubble chart.
 *
 * Timeframes anchor to the MOST RECENT bar in the table — not wall-clock
 * `now()`. That way the chart stays useful overnight, on weekends, and
 * across market holidays: "1d" always means "the most recent trading
 * session," not "the last 24 calendar hours" (which on a Saturday morning
 * would catch zero bars because both today and Friday-as-Juneteenth had
 * no trades).
 *
 *   5m  = last single bar
 *   1h  = last ~12 bars
 *   1d  = bars whose NY-tz date == NY-tz date of the latest bar
 *   1w  = bars in the last 5 distinct NY-tz session dates
 *
 * Each ticker returns:
 *   buyVolume, sellVolume, totalVolume      — summed across the window
 *   netFlow = buy − sell                    — signed share count
 *   priceChangePct                          — (latest close − first open) / first open
 *   tradeCount                              — sanity check
 *   firstWindowStart / lastWindowEnd        — actual covered span
 */

const NY_TZ = "America/New_York";

const TIMEFRAMES = {
  "5m": { label: "5 min" },
  "1h": { label: "1 hour" },
  "1d": { label: "1 day" },
  "1w": { label: "1 week" },
} as const;

type Timeframe = keyof typeof TIMEFRAMES;

interface TickerAggOut {
  ticker: SectorTicker;
  buyVolume: number;
  sellVolume: number;
  ambiguousVolume: number;
  totalVolume: number;
  netFlow: number;
  notionalUsd: number;
  priceChangePct: number | null;
  openPrice: number | null;
  closePrice: number | null;
  tradeCount: number;
  firstWindowStart: string | null;
  lastWindowEnd: string | null;
}

function pickGroup(ticker: SectorTicker): string {
  for (const [group, names] of Object.entries(SECTOR_FLOW_GROUPS)) {
    if ((names as readonly string[]).includes(ticker)) return group;
  }
  return "Other";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawTf = url.searchParams.get("timeframe") ?? "1d";
  if (!(rawTf in TIMEFRAMES)) {
    return NextResponse.json(
      { error: `unknown timeframe '${rawTf}' — expected one of ${Object.keys(TIMEFRAMES).join(", ")}` },
      { status: 400 },
    );
  }
  const tf = rawTf as Timeframe;

  // 1. Find the most recent bar across the universe. Everything anchors
  //    to this so weekends + holidays still surface the latest session.
  const [latestRow] = await db
    .select({ max: sql<Date>`MAX(${sectorFlowBars.windowStart})` })
    .from(sectorFlowBars);
  const latest = latestRow?.max ? new Date(latestRow.max) : null;

  if (!latest) {
    // No data at all — return zero rows so the page renders empty bubbles.
    return NextResponse.json({
      ok: true,
      timeframe: tf,
      timeframeLabel: TIMEFRAMES[tf].label,
      windowStart: null,
      universeSize: SECTOR_FLOW_UNIVERSE.length,
      groups: SECTOR_FLOW_GROUPS,
      tickers: SECTOR_FLOW_UNIVERSE.map((ticker) => ({
        ticker,
        group: pickGroup(ticker),
        buyVolume: 0,
        sellVolume: 0,
        ambiguousVolume: 0,
        totalVolume: 0,
        netFlow: 0,
        notionalUsd: 0,
        priceChangePct: null,
        openPrice: null,
        closePrice: null,
        tradeCount: 0,
        firstWindowStart: null,
        lastWindowEnd: null,
      })),
    });
  }

  // 2. Compute the wide cutoff for the SQL query — we still want a
  //    cheap server-side filter, then narrow to the exact window in JS.
  //    Generous bounds: 9 days back is enough for 1w (5 sessions across
  //    a holiday-shortened week + weekends).
  const wideCutoff = new Date(latest.getTime() - 9 * 24 * 60 * 60_000);
  const rows = await db
    .select()
    .from(sectorFlowBars)
    .where(gte(sectorFlowBars.windowStart, wideCutoff))
    .orderBy(asc(sectorFlowBars.ticker), asc(sectorFlowBars.windowStart));

  // 3. Decide the precise inclusion test per timeframe. All tests are
  //    "is this bar in scope" against the latest-bar anchor.
  const latestMs = latest.getTime();
  const latestNyDate = formatInTimeZone(latest, NY_TZ, "yyyy-MM-dd");

  // Last 5 distinct NY-tz dates present in the result set, descending.
  // Built once outside the per-bar loop.
  const last5Dates = (() => {
    const seen = new Set<string>();
    const dates: string[] = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const d = formatInTimeZone(rows[i].windowStart, NY_TZ, "yyyy-MM-dd");
      if (!seen.has(d)) {
        seen.add(d);
        dates.push(d);
        if (dates.length >= 5) break;
      }
    }
    return new Set(dates);
  })();

  function inScope(windowStart: Date): boolean {
    const ms = windowStart.getTime();
    if (tf === "5m") return ms >= latestMs - 7 * 60_000;
    if (tf === "1h") return ms >= latestMs - 65 * 60_000;
    if (tf === "1d") {
      return formatInTimeZone(windowStart, NY_TZ, "yyyy-MM-dd") === latestNyDate;
    }
    // 1w
    return last5Dates.has(formatInTimeZone(windowStart, NY_TZ, "yyyy-MM-dd"));
  }

  // 4. Group + aggregate.
  const byTicker = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!inScope(r.windowStart)) continue;
    const arr = byTicker.get(r.ticker) ?? [];
    arr.push(r);
    byTicker.set(r.ticker, arr);
  }

  const out: TickerAggOut[] = [];
  for (const ticker of SECTOR_FLOW_UNIVERSE) {
    const bars = byTicker.get(ticker) ?? [];
    if (bars.length === 0) {
      out.push({
        ticker,
        buyVolume: 0,
        sellVolume: 0,
        ambiguousVolume: 0,
        totalVolume: 0,
        netFlow: 0,
        notionalUsd: 0,
        priceChangePct: null,
        openPrice: null,
        closePrice: null,
        tradeCount: 0,
        firstWindowStart: null,
        lastWindowEnd: null,
      });
      continue;
    }
    let buy = 0, sell = 0, ambig = 0, total = 0, notional = 0, tradeCount = 0;
    let firstOpen: number | null = null;
    let lastClose: number | null = null;
    for (const b of bars) {
      buy += Number(b.buyVolume);
      sell += Number(b.sellVolume);
      ambig += Number(b.ambiguousVolume);
      total += Number(b.totalVolume);
      notional += Number(b.notionalUsd);
      tradeCount += b.tradeCount;
      if (firstOpen == null && b.openPrice != null) firstOpen = Number(b.openPrice);
      if (b.closePrice != null) lastClose = Number(b.closePrice);
    }
    const priceChangePct =
      firstOpen != null && lastClose != null && firstOpen > 0
        ? ((lastClose - firstOpen) / firstOpen) * 100
        : null;

    out.push({
      ticker,
      buyVolume: buy,
      sellVolume: sell,
      ambiguousVolume: ambig,
      totalVolume: total,
      netFlow: buy - sell,
      notionalUsd: notional,
      priceChangePct,
      openPrice: firstOpen,
      closePrice: lastClose,
      tradeCount,
      firstWindowStart: bars[0].windowStart.toISOString(),
      lastWindowEnd: bars[bars.length - 1].windowEnd.toISOString(),
    });
  }

  return NextResponse.json({
    ok: true,
    timeframe: tf,
    timeframeLabel: TIMEFRAMES[tf].label,
    anchor: latest.toISOString(),
    anchorNyDate: latestNyDate,
    universeSize: SECTOR_FLOW_UNIVERSE.length,
    groups: SECTOR_FLOW_GROUPS,
    tickers: out.map((t) => ({ ...t, group: pickGroup(t.ticker) })),
  });
}

export const runtime = "nodejs";
