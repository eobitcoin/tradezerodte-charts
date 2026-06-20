import { NextResponse } from "next/server";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
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
 * For each ticker, returns:
 *   buyVolume, sellVolume, totalVolume      — summed across the window
 *   netFlow = buy − sell                    — signed share count
 *   priceChangePct                          — (latest close − first open) / first open
 *   tradeCount                              — sanity check
 *   firstWindowStart / lastWindowEnd        — actual covered span
 *
 * Sizing the bubbles is the client's job (it knows the viewport); the
 * server only returns the raw aggregate values. The page derives:
 *   size  = √(|netFlow|) scaled to viewport
 *   color = priceChangePct mapped to a red↔green gradient
 *
 * Cache hint: this endpoint is hit by the page every 90s with no params
 * changing across users. A 30s edge cache would deduplicate concurrent
 * loads cleanly. For now it's a plain server-rendered fetch — add cache
 * once the page is actually hot.
 */

const TIMEFRAMES = {
  "5m": { lookbackMs: 6 * 60_000, label: "5 min" },         // ~3 bars
  "1h": { lookbackMs: 60 * 60_000, label: "1 hour" },       // ~30 bars
  "1d": { lookbackMs: 24 * 60 * 60_000, label: "1 day" },   // since session open (capped by retention)
  "1w": { lookbackMs: 8 * 24 * 60 * 60_000, label: "1 week" },
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
  const lookbackMs = TIMEFRAMES[tf].lookbackMs;
  const cutoff = new Date(Date.now() - lookbackMs);

  // Pull every bar in the window. ~22 tickers × up to ~2400 bars (1w) =
  // ~53k rows worst case; fine for one read. We aggregate in JS so the
  // open/close handling (first vs last bar) is straightforward.
  const rows = await db
    .select()
    .from(sectorFlowBars)
    .where(gte(sectorFlowBars.windowStart, cutoff))
    .orderBy(asc(sectorFlowBars.ticker), asc(sectorFlowBars.windowStart));

  // Group by ticker.
  const byTicker = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byTicker.get(r.ticker) ?? [];
    arr.push(r);
    byTicker.set(r.ticker, arr);
  }

  const out: TickerAggOut[] = [];
  for (const ticker of SECTOR_FLOW_UNIVERSE) {
    const bars = byTicker.get(ticker) ?? [];
    if (bars.length === 0) {
      // No data — emit a zero row so the bubble still renders (greyed).
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
    windowStart: cutoff.toISOString(),
    universeSize: SECTOR_FLOW_UNIVERSE.length,
    groups: SECTOR_FLOW_GROUPS,
    tickers: out.map((t) => ({ ...t, group: pickGroup(t.ticker) })),
  });
}

export const runtime = "nodejs";
