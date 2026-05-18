import { NextResponse } from "next/server";
import { and, eq, gte, isNotNull, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { botConfig, botTrades } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";
import {
  getBalances,
  getPositions,
  getGainLoss,
  getOptionQuote,
  type TradierPosition,
  type TradierClosedPosition,
} from "@/lib/botwick/tradier-adapter";
import { liveMid } from "@/lib/botwick/risk";

/**
 * GET /api/admin/botwick/pnl?day=YYYY-MM-DD&historyDays=30&botOnly=true
 *
 * Pulls live account state from Tradier for the P&L tab:
 *   - balances:       account equity, cash, day open/close P&L
 *   - positions:      currently open positions (decorated with live mark + P&L)
 *   - closedSelected: closed positions for the selected day (default = today ET)
 *   - dailyHistory:   per-day aggregate (count, wins, losses, gross P&L) for the
 *                     last `historyDays` (default 30) trading days
 *   - botOnly:        when true, filter all closed-position output to OCC
 *                     symbols the bot has traded in the history window. Open
 *                     positions and balances are untouched (account-wide).
 *
 * Routing follows the bot's active mode (paper → sandbox, live → production).
 * No mutations — pure read.
 */
export async function GET(req: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const dayParam = url.searchParams.get("day");
  const historyDaysParam = Number.parseInt(url.searchParams.get("historyDays") ?? "30", 10);
  const historyDays = Number.isFinite(historyDaysParam) && historyDaysParam > 0
    ? Math.min(historyDaysParam, 90)
    : 30;
  const botOnly = url.searchParams.get("botOnly") === "true";

  const todayEt = todayEtIso();
  const selectedDay = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : todayEt;
  const historyStart = nDaysAgoEtIso(historyDays);

  const [cfg] = await db.select().from(botConfig).where(eq(botConfig.id, "default")).limit(1);
  const mode = cfg?.mode ?? "off";
  if (mode === "off") {
    return NextResponse.json({
      ok: true,
      mode,
      reason: "Bot mode is 'off' — set paper or live to query Tradier.",
      balances: null,
      positions: [],
      selectedDay,
      historyDays,
      botOnly,
      closedSelected: [],
      dailyHistory: [],
    });
  }

  const [balancesRes, positionsRes, gainLossRes] = await Promise.all([
    getBalances(mode),
    getPositions(mode),
    // One range query covers the full history window; we bucket per day in JS.
    getGainLoss(mode, { start: historyStart, end: todayEt }),
  ]);

  const errors: string[] = [];
  if (!balancesRes.ok) errors.push(`balances: ${balancesRes.reason}`);
  if (!positionsRes.ok) errors.push(`positions: ${positionsRes.reason}`);
  if (!gainLossRes.ok) errors.push(`gainloss: ${gainLossRes.reason}`);

  const positions = positionsRes.ok ? positionsRes.data : [];
  const decorated = await Promise.all(positions.map((p) => decoratePosition(mode, p)));

  // Tradier's gainloss has next-day settlement lag — today's closes don't
  // appear until tomorrow. We patch the gap with our own bot_trades.closed
  // rows (real-time as the exit fills) and let Tradier win on overlap so
  // historical days remain Tradier-authoritative.
  const tradierClosed = gainLossRes.ok ? gainLossRes.data : [];
  const botClosed = await fetchBotTradesClosed(historyStart);
  let allClosed = mergeTradierWithBotTrades(tradierClosed, botClosed);

  let botOccCount: number | null = null;
  if (botOnly) {
    const botOccs = new Set(botClosed.map((c) => c.symbol));
    // Also include OCCs the bot armed/fired this window in case the user
    // wants to see ALL bot activity, not just closes — same as before.
    const allBotOccs = await getBotTradedOccs(historyStart);
    for (const occ of allBotOccs) botOccs.add(occ);
    botOccCount = botOccs.size;
    allClosed = allClosed.filter((cp) => botOccs.has(cp.symbol));
  }
  const closedSelected = allClosed.filter((cp) => closeDateEtIso(cp) === selectedDay);
  const dailyHistory = aggregateByDay(allClosed, historyDays);

  return NextResponse.json({
    ok: true,
    mode,
    fetchedAt: new Date().toISOString(),
    balances: balancesRes.ok ? balancesRes.data : null,
    positions: decorated,
    selectedDay,
    historyDays,
    botOnly,
    botOccCount,
    closedSelected,
    dailyHistory,
    errors,
  });
}

/**
 * Pull closed bot_trades within the history window and convert each to the
 * same shape as Tradier's gainloss rows. Used to fill the "Tradier settlement
 * lag" gap so today's closes show up in the P&L tab as soon as the exit fills.
 *
 * Math:
 *   cost     = entryFillUsd × qty × 100     (option contract multiplier)
 *   proceeds = exitFillUsd × qty × 100
 *   gain_loss        = realizedPnlUsd  (already net of commissions on Tradier side)
 *   gain_loss_pct    = gain_loss / |cost| × 100
 *
 * Rows missing `realizedPnlUsd` or `exitFillUsd` are skipped — they're either
 * still in flight or got force-cancelled with no fill.
 */
async function fetchBotTradesClosed(historyStartEtIso: string): Promise<TradierClosedPosition[]> {
  // Convert ET date to a Date at 00:00 ET. Slight slop on the boundary is fine.
  const sinceMidnightUtc = new Date(`${historyStartEtIso}T00:00:00-04:00`);
  const rows = await db
    .select({
      sourceTicker: botTrades.sourceTicker,
      legs: botTrades.legs,
      entryFillUsd: botTrades.entryFillUsd,
      exitFillUsd: botTrades.exitFillUsd,
      realizedPnlUsd: botTrades.realizedPnlUsd,
      closedAt: botTrades.closedAt,
      filledAt: botTrades.filledAt,
    })
    .from(botTrades)
    .where(
      and(
        eq(botTrades.status, "closed"),
        isNotNull(botTrades.closedAt),
        isNotNull(botTrades.realizedPnlUsd),
        gte(botTrades.closedAt, sinceMidnightUtc),
        lte(botTrades.closedAt, new Date(Date.now() + 60_000)),
      ),
    );

  const out: TradierClosedPosition[] = [];
  for (const r of rows) {
    const legs = (r.legs as Array<Record<string, unknown>>) ?? [];
    const leg = legs[0];
    if (!leg) continue;
    // Resolve the "P&L symbol": OCC for options, underlying ticker for stocks.
    const isStockLeg = (leg as Record<string, unknown>).instrument === "stock";
    const symbol = isStockLeg
      ? typeof leg.symbol === "string"
        ? (leg.symbol as string)
        : r.sourceTicker
      : typeof leg.occ_symbol === "string"
        ? (leg.occ_symbol as string)
        : null;
    if (!symbol) continue;
    const qty = typeof leg.qty === "number" ? leg.qty : 1;
    const entryFill = r.entryFillUsd != null ? Number(r.entryFillUsd) : null;
    const exitFill = r.exitFillUsd != null ? Number(r.exitFillUsd) : null;
    const gainLoss = r.realizedPnlUsd != null ? Number(r.realizedPnlUsd) : null;
    if (gainLoss == null) continue;
    const absQty = Math.abs(qty);
    // Options: cost = mid × contracts × 100. Stocks: cost = price × shares
    // (no ×100, no contract multiplier).
    const contractMult = isStockLeg ? 1 : 100;
    const cost = entryFill != null ? entryFill * absQty * contractMult : 0;
    const proceeds = exitFill != null ? exitFill * absQty * contractMult : cost + gainLoss;
    const closeIso = r.closedAt ? r.closedAt.toISOString() : new Date().toISOString();
    const openIso = r.filledAt ? r.filledAt.toISOString() : closeIso;
    out.push({
      symbol,
      quantity: absQty,
      cost,
      proceeds,
      gain_loss: gainLoss,
      gain_loss_percent: cost !== 0 ? (gainLoss / Math.abs(cost)) * 100 : 0,
      open_date: openIso,
      close_date: closeIso,
      term: 0,
    });
  }
  return out;
}

/**
 * Merge Tradier's settled gainloss with our real-time bot_trades closes.
 * Tradier wins on overlap (it's the authoritative settled record). We key on
 * `${symbol}|${ET close date}` so a same-day reopen-then-close stays
 * idempotent across the merge.
 */
function mergeTradierWithBotTrades(
  tradier: TradierClosedPosition[],
  bot: TradierClosedPosition[],
): TradierClosedPosition[] {
  const seen = new Set<string>();
  const keyOf = (c: TradierClosedPosition) =>
    `${c.symbol}|${closeDateEtIso(c)}`;
  const merged: TradierClosedPosition[] = [];
  for (const c of tradier) {
    seen.add(keyOf(c));
    merged.push(c);
  }
  for (const c of bot) {
    const k = keyOf(c);
    if (seen.has(k)) continue; // Tradier already has this close — prefer it.
    seen.add(k);
    merged.push(c);
  }
  return merged;
}

/**
 * Set of OCC symbols the bot has touched since `sinceEtIso`. Used to filter
 * Tradier's account-wide gainloss to "bot trades only". Reads legs[].occ_symbol
 * from bot_trades — covers every contract the bot armed, fired, working, open,
 * closing, or closed in the window.
 */
async function getBotTradedOccs(sinceEtIso: string): Promise<Set<string>> {
  // Convert ET date string to a Date at 00:00 ET so the comparison covers the
  // whole window — slightly generous on the boundary, which is fine.
  const sinceMidnightUtc = new Date(`${sinceEtIso}T00:00:00-04:00`);
  const rows = await db
    .select({ legs: botTrades.legs })
    .from(botTrades)
    .where(
      or(
        gte(botTrades.signaledAt, sinceMidnightUtc),
        // Also catch trades that signaled earlier but only closed inside the
        // window (rare for 0DTE but possible for overnighters).
        isNotNull(botTrades.closedAt),
      ),
    );
  const occs = new Set<string>();
  for (const r of rows) {
    const legs = (r.legs as Array<Record<string, unknown>> | null) ?? [];
    for (const leg of legs) {
      // Options: match on OCC. Stocks: match on underlying ticker.
      if ((leg as Record<string, unknown>)?.instrument === "stock") {
        if (typeof leg?.symbol === "string") occs.add(leg.symbol as string);
      } else if (typeof leg?.occ_symbol === "string") {
        occs.add(leg.occ_symbol);
      }
    }
  }
  return occs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type DecoratedPosition = {
  symbol: string;
  quantity: number;
  costBasis: number;
  avgEntry: number;
  liveMark: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  dateAcquired: string;
  kind: "option" | "equity";
};

export type DailyBucket = {
  date: string;       // YYYY-MM-DD ET
  count: number;
  wins: number;
  losses: number;
  scratches: number;
  grossPnl: number;
  winningPnl: number; // sum of winning trades' P&L
  losingPnl: number;  // sum of losing trades' P&L (negative)
  winRate: number;    // 0..1
  avgWin: number;
  avgLoss: number;
};

async function decoratePosition(
  mode: "paper" | "live",
  p: TradierPosition,
): Promise<DecoratedPosition> {
  const isOption = looksLikeOcc(p.symbol);
  const kind: "option" | "equity" = isOption ? "option" : "equity";
  const contractMult = isOption ? 100 : 1;
  const absQty = Math.abs(p.quantity);
  const avgEntry = absQty > 0 ? p.cost_basis / (absQty * contractMult) : 0;

  let liveMark: number | null = null;
  if (isOption) {
    const q = await getOptionQuote(mode, p.symbol);
    if (q.ok && q.data) {
      liveMark = liveMid({ bid: q.data.bid, ask: q.data.ask, last: q.data.last });
    }
  }

  const marketValue =
    liveMark != null ? liveMark * absQty * contractMult * Math.sign(p.quantity || 1) : null;
  const unrealizedPnl = marketValue != null ? marketValue - p.cost_basis : null;
  const unrealizedPnlPct =
    unrealizedPnl != null && p.cost_basis !== 0
      ? (unrealizedPnl / Math.abs(p.cost_basis)) * 100
      : null;

  return {
    symbol: p.symbol,
    quantity: p.quantity,
    costBasis: p.cost_basis,
    avgEntry,
    liveMark,
    marketValue,
    unrealizedPnl,
    unrealizedPnlPct,
    dateAcquired: p.date_acquired,
    kind,
  };
}

function looksLikeOcc(sym: string): boolean {
  return /^[A-Z.]{1,6}\d{6}[CP]\d{8}$/.test(sym);
}

function todayEtIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function nDaysAgoEtIso(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Extract the close_date as ET YYYY-MM-DD (Tradier returns ISO timestamps). */
function closeDateEtIso(cp: TradierClosedPosition): string {
  if (!cp.close_date) return "";
  try {
    const d = new Date(cp.close_date);
    if (Number.isNaN(d.getTime())) return cp.close_date.slice(0, 10);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return cp.close_date.slice(0, 10);
  }
}

/**
 * Bucket closed positions by ET close date and compute per-day stats.
 * Returns one row per calendar day in the requested history window, including
 * days with zero closes (so the UI can render a stable week-over-week view).
 */
function aggregateByDay(
  closes: TradierClosedPosition[],
  historyDays: number,
): DailyBucket[] {
  // Group closes by ET date.
  const groups = new Map<string, TradierClosedPosition[]>();
  for (const cp of closes) {
    const d = closeDateEtIso(cp);
    if (!d) continue;
    const arr = groups.get(d) ?? [];
    arr.push(cp);
    groups.set(d, arr);
  }

  // Build a complete day list, newest first, for the history window.
  const out: DailyBucket[] = [];
  for (let i = 0; i < historyDays; i++) {
    const d = nDaysAgoEtIso(i);
    const dayCloses = groups.get(d) ?? [];
    const wins = dayCloses.filter((c) => c.gain_loss > 0);
    const losses = dayCloses.filter((c) => c.gain_loss < 0);
    const scratches = dayCloses.filter((c) => c.gain_loss === 0);
    const grossPnl = dayCloses.reduce((s, c) => s + c.gain_loss, 0);
    const winningPnl = wins.reduce((s, c) => s + c.gain_loss, 0);
    const losingPnl = losses.reduce((s, c) => s + c.gain_loss, 0);
    const denom = wins.length + losses.length;
    const winRate = denom > 0 ? wins.length / denom : 0;
    const avgWin = wins.length > 0 ? winningPnl / wins.length : 0;
    const avgLoss = losses.length > 0 ? losingPnl / losses.length : 0;
    out.push({
      date: d,
      count: dayCloses.length,
      wins: wins.length,
      losses: losses.length,
      scratches: scratches.length,
      grossPnl,
      winningPnl,
      losingPnl,
      winRate,
      avgWin,
      avgLoss,
    });
  }
  return out;
}
