/**
 * Squeeze Watch scanner.
 *
 * Walks a curated ~150-name universe of small/mid-cap + historically
 * high-SI tickers, pulls FINRA short interest + Polygon ticker overview +
 * 30-day price action, scores each candidate on a composite 0-100 squeeze
 * index, and persists the top N to squeeze_scans. For the top 10, also
 * generates suggested option trade ideas from the live chain.
 *
 * Scoring (each sub-score 0-100, higher = more squeeze-y):
 *
 *   siPctScore     SI ÷ shares outstanding, ramped 10% → 40%
 *   dtcScore       days-to-cover, ramped 2 → 10
 *   momentumScore  5-day return, ramped -5% → +15%
 *   ivRankScore    atm IV rank (0..100) from iv_snapshots if covered
 *
 * Composite weights: SI%=35, DTC=25, momentum=20, IV=20.
 *
 * Filter bar: SI% ≥ 10 OR DTC ≥ 3. Names that don't clear either are
 * dropped from the ranking (still counted in universeSize).
 *
 * Concurrency: ticker scoring runs with concurrency 4 (Polygon Advanced
 * handles it easily). Drops wall-clock from ~9 min serial → ~2-3 min.
 *
 * Data caveats vs Ortex/S3:
 *   - SI is bi-monthly with ~3 week lag (FINRA settlement → publication).
 *   - No cost-to-borrow signal. We surface "looks crowded," not
 *     "shorts are bleeding right now."
 */

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  squeezeScans,
  ivSnapshots,
  type SqueezeCandidate,
  type SqueezeTradeIdea,
  type SqueezeTradeLeg,
} from "@/lib/db/schema";
import {
  fetchLatestShortInterest,
  fetchTickerOverview,
  fetchUnderlyingDailyBars,
  fetchOptionChain,
  type PolygonContract,
} from "@/lib/polygon";
import { nyTradingDay } from "@/lib/trading-day";

// ----------------------------------------------------------------------------
// Universe — ~150 curated squeeze-prone names.
// ----------------------------------------------------------------------------

export const SQUEEZE_UNIVERSE = [
  // Classic meme / retail
  "GME", "AMC", "KOSS", "EXPR", "BBBY", "BB", "NOK", "WISH", "CLOV", "RDBX",
  // EV / alt-mobility
  "RIVN", "LCID", "NIO", "XPEV", "LI", "NKLA", "MULN", "RIDE", "GOEV", "FFIE",
  "WKHS", "HYZN", "BLNK", "CHPT", "EVGO",
  // Alt-energy / clean
  "PLUG", "FCEL", "BLDP", "BE", "RUN", "ENPH", "SEDG", "SPWR", "NOVA",
  // High-SI Mag / mega-cap names
  "TSLA", "COIN", "MSTR", "NVDA", "AMD", "META", "NFLX", "PYPL",
  // Fintech / payments / digital
  "AFRM", "UPST", "SOFI", "HOOD", "LMND", "OPEN", "Z", "RDFN", "COMP",
  // Consumer / retail / e-commerce
  "CVNA", "CHWY", "W", "FIGS", "REAL", "PRPL", "PTON", "BARK", "TDUP", "GOTU",
  "BYND", "OATLY", "VFC", "FOSL", "RH", "DOCN",
  // China ADRs
  "BABA", "JD", "PDD", "BIDU", "BILI", "TME", "IQ", "FUTU", "TIGR", "EDU",
  "TAL", "YMM", "DIDIY",
  // Cannabis
  "TLRY", "CGC", "ACB", "CRON", "SNDL", "OGI", "HEXO",
  // Biotech / pharma
  "SAVA", "GERN", "ABEO", "IMVT", "ATAI", "KRYS", "CRNX", "VYNE", "RIGL",
  "MNMD", "CMPS", "ATXI", "TENX", "DRMA", "ATHA",
  // Crypto-adjacent
  "MARA", "RIOT", "HUT", "BITF", "CLSK", "WULF", "CIFR", "CORZ", "GLXY",
  // Streaming / media
  "ROKU", "FUBO", "SPOT", "WBD", "PARA", "DIS",
  // SPACs / story stocks
  "DWAC", "PHUN", "BBIG", "GREE", "MMAT", "XL", "VLDR", "OUST", "EH", "GFAI",
  // Regional banks
  "ZION", "KEY", "RF", "CFG", "PACW", "WAL", "CMA", "NYCB",
  // Real estate / mortgage
  "OPAD", "RKT", "LDI",
  // Industrials with squeeze history
  "DAL", "AAL", "JBLU", "ALK", "SAVE",
] as const;

export const TOP_N = 25;
export const TRADE_IDEA_N = 10;
export const MIN_SI_PCT_SO = 10;
export const MIN_DTC = 3;
export const SCAN_CONCURRENCY = 4;
export const TRADE_IDEA_CONCURRENCY = 3;

const W_SI = 0.35;
const W_DTC = 0.25;
const W_MOM = 0.20;
const W_IV = 0.20;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function rampScore(value: number, zeroAt: number, hundredAt: number): number {
  if (hundredAt === zeroAt) return 0;
  return clamp(((value - zeroAt) / (hundredAt - zeroAt)) * 100, 0, 100);
}

/** Run an async map with bounded concurrency. Preserves input order in output. */
async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function autoThesis(c: SqueezeCandidate): string {
  const parts: string[] = [];
  if (c.shortInterestPctSO != null && c.shortInterestPctSO >= 20) {
    parts.push(`SI ${c.shortInterestPctSO.toFixed(0)}% of SO`);
  } else if (c.shortInterestPctSO != null && c.shortInterestPctSO >= 10) {
    parts.push(`SI ${c.shortInterestPctSO.toFixed(0)}% (moderate)`);
  }
  if (c.daysToCover >= 7) parts.push(`${c.daysToCover.toFixed(1)} days to cover`);
  else if (c.daysToCover >= 4) parts.push(`${c.daysToCover.toFixed(1)} DTC`);
  if (c.priceChange5dPct != null && c.priceChange5dPct >= 10) {
    parts.push(`+${c.priceChange5dPct.toFixed(1)}% over 5d`);
  } else if (c.priceChange5dPct != null && c.priceChange5dPct <= -10) {
    parts.push(`${c.priceChange5dPct.toFixed(1)}% over 5d — battered name`);
  }
  if (c.atmIvRank != null && c.atmIvRank >= 75) {
    parts.push(`IV rank ${c.atmIvRank.toFixed(0)} (rich)`);
  }
  if (parts.length === 0) parts.push("modest SI elevation; on watch");
  return parts.join("; ").slice(0, 195);
}

function returnsFromCloses(
  closes: Map<string, number>,
): { lastClose: number | null; r5: number | null; r30: number | null } {
  const dates = Array.from(closes.keys()).sort();
  if (dates.length === 0) return { lastClose: null, r5: null, r30: null };
  const lastDate = dates[dates.length - 1];
  const last = closes.get(lastDate) ?? null;
  if (last == null) return { lastClose: null, r5: null, r30: null };
  const dateAtOffset = (off: number) => {
    const idx = dates.length - 1 - off;
    return idx >= 0 ? closes.get(dates[idx]) ?? null : null;
  };
  const c5 = dateAtOffset(5);
  const c30 = dateAtOffset(30);
  const pct = (a: number | null, b: number | null) =>
    a != null && b != null && b > 0 ? ((a - b) / b) * 100 : null;
  return { lastClose: last, r5: pct(last, c5), r30: pct(last, c30) };
}

async function fetchLatestIvRank(ticker: string): Promise<number | null> {
  const rows = await db
    .select({ atmIv30d: ivSnapshots.atmIv30d })
    .from(ivSnapshots)
    .where(eq(ivSnapshots.ticker, ticker))
    .orderBy(desc(ivSnapshots.snapshotDate))
    .limit(260);
  const ivs = rows
    .map((r) => (r.atmIv30d != null ? Number(r.atmIv30d) : null))
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  if (ivs.length < 20) return null;
  const current = ivs[0];
  const below = ivs.filter((v) => v <= current).length;
  return (below / ivs.length) * 100;
}

// ----------------------------------------------------------------------------
// Per-ticker scoring (designed to run in parallel — no shared mutable state).
// ----------------------------------------------------------------------------

interface ScoreResult {
  ticker: string;
  candidate: SqueezeCandidate | null;
  error: string | null;
}

async function scoreTicker(ticker: string, fromDate: string, today: string): Promise<ScoreResult> {
  try {
    const [si, overview, closes, ivRank] = await Promise.all([
      fetchLatestShortInterest(ticker),
      fetchTickerOverview(ticker),
      fetchUnderlyingDailyBars(ticker, fromDate, today),
      fetchLatestIvRank(ticker),
    ]);

    if (!si) return { ticker, candidate: null, error: null };

    const sharesOutstanding =
      overview?.share_class_shares_outstanding ??
      overview?.weighted_shares_outstanding ??
      null;
    const shortInterestPctSO =
      sharesOutstanding && sharesOutstanding > 0
        ? (si.short_interest / sharesOutstanding) * 100
        : null;

    const { lastClose, r5, r30 } = returnsFromCloses(closes);
    if (lastClose == null) return { ticker, candidate: null, error: null };

    const passSi = shortInterestPctSO != null && shortInterestPctSO >= MIN_SI_PCT_SO;
    const passDtc = si.days_to_cover >= MIN_DTC;
    if (!passSi && !passDtc) return { ticker, candidate: null, error: null };

    const siPctScore = shortInterestPctSO != null ? rampScore(shortInterestPctSO, 10, 40) : 0;
    const dtcScore = rampScore(si.days_to_cover, 2, 10);
    const momentumScore = r5 != null ? rampScore(r5, -5, 15) : 50;
    const ivRankScore = ivRank != null ? clamp(ivRank, 0, 100) : 50;

    const composite =
      siPctScore * W_SI + dtcScore * W_DTC + momentumScore * W_MOM + ivRankScore * W_IV;

    const candidate: SqueezeCandidate = {
      ticker,
      companyName: overview?.name ?? null,
      siSettlementDate: si.settlement_date,
      shortInterest: si.short_interest,
      avgDailyVolume: si.avg_daily_volume,
      daysToCover: si.days_to_cover,
      sharesOutstanding,
      shortInterestPctSO,
      lastClose,
      priceChange5dPct: r5,
      priceChange30dPct: r30,
      atmIvRank: ivRank,
      siPctScore: Math.round(siPctScore * 10) / 10,
      dtcScore: Math.round(dtcScore * 10) / 10,
      momentumScore: Math.round(momentumScore * 10) / 10,
      ivRankScore: Math.round(ivRankScore * 10) / 10,
      compositeScore: Math.round(composite * 10) / 10,
      thesis: "",
    };
    candidate.thesis = autoThesis(candidate);
    return { ticker, candidate, error: null };
  } catch (err) {
    return {
      ticker,
      candidate: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ----------------------------------------------------------------------------
// Trade idea generation. Pulls live options chain for each top-N ticker and
// constructs 3 strategies: long call (cheap directional), bull call spread
// (defined risk), diagonal call (long-vol bias).
// ----------------------------------------------------------------------------

function pickContract(
  chain: PolygonContract[],
  type: "call" | "put",
  targetStrike: number,
  targetDte: number,
  today: Date,
): PolygonContract | null {
  const callsOrPuts = chain.filter((c) => c.details?.contract_type === type);
  if (callsOrPuts.length === 0) return null;
  let best: PolygonContract | null = null;
  let bestScore = Infinity;
  for (const c of callsOrPuts) {
    const exp = c.details?.expiration_date;
    if (!exp) continue;
    const dteRaw = (new Date(exp + "T00:00:00Z").getTime() - today.getTime()) / (24 * 3600 * 1000);
    const dteDelta = Math.abs(dteRaw - targetDte);
    const strikeDelta = Math.abs(c.details.strike_price - targetStrike) / targetStrike;
    // Weighted: DTE proximity matters more (×3) than strike proximity.
    const score = dteDelta * 3 + strikeDelta * 100;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function midOf(c: PolygonContract): number | null {
  const bid = c.last_quote?.bid;
  const ask = c.last_quote?.ask;
  if (typeof bid === "number" && bid > 0 && typeof ask === "number" && ask >= bid) {
    return Math.round(((bid + ask) / 2) * 100) / 100;
  }
  // Fall back to the day's close when the NBBO is missing (afterhours / wide).
  if (typeof c.day?.close === "number" && c.day.close > 0) {
    return Math.round(c.day.close * 100) / 100;
  }
  return null;
}

function dteOf(c: PolygonContract, today: Date): number {
  const exp = c.details?.expiration_date;
  if (!exp) return 0;
  return Math.round(
    (new Date(exp + "T00:00:00Z").getTime() - today.getTime()) / (24 * 3600 * 1000),
  );
}

function legOf(c: PolygonContract, side: "long" | "short"): SqueezeTradeLeg {
  return {
    side,
    type: c.details.contract_type as "call" | "put",
    strike: c.details.strike_price,
    expiration: c.details.expiration_date,
    contractTicker: c.details.ticker,
    mid: midOf(c),
  };
}

async function generateTradeIdeas(
  ticker: string,
  spot: number,
): Promise<SqueezeTradeIdea[]> {
  const chain = await fetchOptionChain(ticker);
  if (chain.length === 0) return [];

  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

  // 1. Long call — closest to ATM at 35 DTE.
  const longCallC = pickContract(chain, "call", spot, 35, today);
  // 2. Bull call spread — long ATM + short ~spot×1.10 same expiry.
  const spreadShortC = longCallC
    ? pickContract(
        chain.filter((c) => c.details.expiration_date === longCallC.details.expiration_date),
        "call",
        spot * 1.10,
        dteOf(longCallC, today),
        today,
      )
    : null;
  // 3. Diagonal — long ~spot×1.05 at 70 DTE, short ~spot×1.10 at 30 DTE.
  const diagLongC = pickContract(chain, "call", spot * 1.05, 70, today);
  const diagShortC = pickContract(chain, "call", spot * 1.10, 30, today);

  const ideas: SqueezeTradeIdea[] = [];

  if (longCallC) {
    const m = midOf(longCallC);
    const dte = dteOf(longCallC, today);
    ideas.push({
      strategy: "long_call",
      label: `Long ${longCallC.details.strike_price} call (${dte}d)`,
      legs: [legOf(longCallC, "long")],
      netDebit: m,
      maxProfit: null,
      maxLoss: m != null ? Math.round(m * 100 * 100) / 100 : null,
      breakeven: m != null ? Math.round((longCallC.details.strike_price + m) * 100) / 100 : null,
      dte,
      notes:
        "Cheapest directional play. Pays if the squeeze fires; full debit lost if it fizzles. Size as a small percent of account.",
    });
  }

  if (longCallC && spreadShortC && spreadShortC.details.strike_price > longCallC.details.strike_price) {
    const longMid = midOf(longCallC);
    const shortMid = midOf(spreadShortC);
    const debit = longMid != null && shortMid != null
      ? Math.round((longMid - shortMid) * 100) / 100
      : null;
    const width = spreadShortC.details.strike_price - longCallC.details.strike_price;
    const maxProfit = debit != null
      ? Math.round((width - debit) * 100 * 100) / 100
      : null;
    const dte = dteOf(longCallC, today);
    ideas.push({
      strategy: "bull_call_spread",
      label: `${longCallC.details.strike_price}/${spreadShortC.details.strike_price} call spread (${dte}d)`,
      legs: [legOf(longCallC, "long"), legOf(spreadShortC, "short")],
      netDebit: debit,
      maxProfit,
      maxLoss: debit != null ? Math.round(debit * 100 * 100) / 100 : null,
      breakeven: debit != null
        ? Math.round((longCallC.details.strike_price + debit) * 100) / 100
        : null,
      dte,
      notes:
        "Defined-risk version of the directional bet. Caps upside at the short strike but cuts entry cost ~50%. Use when the squeeze case has a price target.",
    });
  }

  if (diagLongC && diagShortC && diagShortC.details.expiration_date !== diagLongC.details.expiration_date) {
    const longMid = midOf(diagLongC);
    const shortMid = midOf(diagShortC);
    const debit = longMid != null && shortMid != null
      ? Math.round((longMid - shortMid) * 100) / 100
      : null;
    const longDte = dteOf(diagLongC, today);
    ideas.push({
      strategy: "diagonal_call",
      label: `Diagonal: long ${diagLongC.details.strike_price} ${longDte}d / short ${diagShortC.details.strike_price} ${dteOf(diagShortC, today)}d`,
      legs: [legOf(diagLongC, "long"), legOf(diagShortC, "short")],
      netDebit: debit,
      maxProfit: null,
      maxLoss: debit != null ? Math.round(debit * 100 * 100) / 100 : null,
      breakeven: null,
      dte: longDte,
      notes:
        "Long-vol bias with theta-decay subsidy from the short. Best when squeeze grinds rather than gaps. Roll or close the short before its expiry.",
    });
  }

  return ideas;
}

// ----------------------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------------------

export interface SqueezeScanResult {
  scanDay: string;
  universeSize: number;
  rankedSize: number;
  ranked: SqueezeCandidate[];
  errors: Array<{ ticker: string; message: string }>;
  /** Wall-clock breakdown for ops visibility. */
  timing: { scoreSec: number; tradeIdeasSec: number; totalSec: number };
}

export async function runSqueezeScan(opts: {
  topN?: number;
  scanConcurrency?: number;
  tradeIdeaConcurrency?: number;
  skipTradeIdeas?: boolean;
} = {}): Promise<SqueezeScanResult> {
  const topN = opts.topN ?? TOP_N;
  const scanConc = opts.scanConcurrency ?? SCAN_CONCURRENCY;
  const tiConc = opts.tradeIdeaConcurrency ?? TRADE_IDEA_CONCURRENCY;
  const skipTI = opts.skipTradeIdeas ?? false;

  const startMs = Date.now();
  const today = nyTradingDay();
  const fromDate = (() => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 50);
    return d.toISOString().slice(0, 10);
  })();

  // Phase 1: parallel ticker scoring.
  const scoreResults = await mapConcurrent(SQUEEZE_UNIVERSE, scanConc, (t) =>
    scoreTicker(t, fromDate, today),
  );
  const scoreSec = (Date.now() - startMs) / 1000;

  const errors = scoreResults
    .filter((r) => r.error)
    .map((r) => ({ ticker: r.ticker, message: r.error! }));
  const candidates = scoreResults
    .map((r) => r.candidate)
    .filter((c): c is SqueezeCandidate => c != null);

  candidates.sort((a, b) => b.compositeScore - a.compositeScore);
  const ranked = candidates.slice(0, topN);

  // Phase 2: trade idea generation for top N (default 10).
  const tiStartMs = Date.now();
  if (!skipTI && ranked.length > 0) {
    const tradeIdeaCount = Math.min(TRADE_IDEA_N, ranked.length);
    await mapConcurrent(ranked.slice(0, tradeIdeaCount), tiConc, async (c) => {
      try {
        c.tradeIdeas = await generateTradeIdeas(c.ticker, c.lastClose);
      } catch (err) {
        errors.push({
          ticker: `${c.ticker}/trade-ideas`,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }
  const tradeIdeasSec = (Date.now() - tiStartMs) / 1000;

  // Persist.
  const meta = {
    weights: { si: W_SI, dtc: W_DTC, momentum: W_MOM, iv: W_IV },
    filterBar: { minSiPctSO: MIN_SI_PCT_SO, minDtc: MIN_DTC },
    errorCount: errors.length,
    timing: { scoreSec, tradeIdeasSec, totalSec: (Date.now() - startMs) / 1000 },
  };
  await db
    .insert(squeezeScans)
    .values({
      scanDay: today,
      universeSize: SQUEEZE_UNIVERSE.length,
      rankedSize: ranked.length,
      candidates: ranked,
      meta,
    })
    .onConflictDoUpdate({
      target: squeezeScans.scanDay,
      set: {
        universeSize: SQUEEZE_UNIVERSE.length,
        rankedSize: ranked.length,
        candidates: ranked,
        meta,
        updatedAt: sql`now()`,
      },
    });

  return {
    scanDay: today,
    universeSize: SQUEEZE_UNIVERSE.length,
    rankedSize: ranked.length,
    ranked,
    errors,
    timing: { scoreSec, tradeIdeasSec, totalSec: (Date.now() - startMs) / 1000 },
  };
}
