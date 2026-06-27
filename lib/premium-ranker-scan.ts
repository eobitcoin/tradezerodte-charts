/**
 * Premium Ranker scanner.
 *
 * A full-market funnel for premium sellers:
 *
 *   1. Pull the Polygon all-tickers snapshot (1 call, ~13k US stocks).
 *   2. Keep price >= $20 AND daily volume > 500,000 (~2,500 survivors).
 *   3. Deep-scan each survivor's near-30d option chain via a single
 *      constrained slice call (concurrency-bounded). Derive:
 *        - 30d ATM implied vol            (primary ranking — "highest IV")
 *        - ATM straddle % of spot         (premium-richness read)
 *        - best ~20-30 delta short put    (credit, PoP, annualized return)
 *      Tickers with no options in the window are dropped (the "has options"
 *      gate falls out naturally — empty slice → skip).
 *   4. Rank survivors by ATM IV (and separately by short-put annualized
 *      premium). Store the top N rows.
 *   5. Build 3 headline trade suggestions from the richest, cleanly-tradeable
 *      names: a cash-secured naked put + a defined-risk put credit spread.
 *
 * The scan is read-only and tolerant — any ticker that errors is skipped,
 * never fatal. Designed to finish inside a weekly cron (~2-5 min).
 */

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ivSnapshots } from "@/lib/db/schema";
import {
  fetchAllTickersSnapshot,
  fetchOptionChainSlice,
  type PolygonContract,
} from "@/lib/polygon";
import { normalCdf } from "@/lib/black-scholes";
import type {
  PremiumRankerRow,
  PremiumRankerSuggestion,
  PremiumRankerSpread,
} from "@/lib/db/schema";

// ---- Filters ----
export const MIN_PRICE = 20;
export const MIN_DAY_VOLUME = 500_000;
export const DTE_MIN = 21;
export const DTE_MAX = 45;
const RISK_FREE_RATE = 0.04;

// ---- Tunables ----
/** How many top-by-IV rows to persist (keeps the JSONB tight). */
const STORE_TOP_N = 120;
/** Concurrency for the deep-scan chain calls. Polygon Advanced handles this. */
const SCAN_CONCURRENCY = 16;
/** Hard cap on deep-scan candidates — safety backstop so a data glitch
 *  can't make the cron walk tens of thousands of names. Far above the
 *  realistic ~2,500 survivors. Truncation (if it ever happens) is logged. */
const MAX_DEEP_SCAN = 4000;

interface Mid {
  bid: number | null;
  ask: number | null;
  mid: number | null;
}

function quoteOf(c: PolygonContract): Mid {
  const bid = typeof c.last_quote?.bid === "number" && c.last_quote.bid > 0 ? c.last_quote.bid : null;
  const ask = typeof c.last_quote?.ask === "number" && c.last_quote.ask > 0 ? c.last_quote.ask : null;
  const mid = bid != null && ask != null && ask >= bid ? (bid + ask) / 2
    : typeof c.last_quote?.midpoint === "number" && c.last_quote.midpoint > 0 ? c.last_quote.midpoint
    : null;
  return { bid, ask, mid };
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Risk-neutral P(stock at expiry > breakeven), i.e. N(d2) with K=breakeven. */
function probAboveBreakeven(spot: number, breakeven: number, sigma: number, T: number): number {
  if (spot <= 0 || breakeven <= 0 || sigma <= 0 || T <= 0) return 0;
  const d2 = (Math.log(spot / breakeven) + (RISK_FREE_RATE - 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return normalCdf(d2);
}

/** Run an async map with bounded concurrency, preserving input order. */
async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------
// Per-ticker deep scan
// ---------------------------------------------------------------------------

interface ScanResult {
  symbol: string;
  row: Omit<PremiumRankerRow, "rankByIv" | "rankByPremium"> | null;
  /** Calls + puts kept for the suggestion-building stage (top names only). */
  contracts: PolygonContract[];
  targetExpiry: string | null;
  spot: number;
}

async function scanTicker(symbol: string, price: number, dayVolume: number, today: string): Promise<ScanResult> {
  const empty: ScanResult = { symbol, row: null, contracts: [], targetExpiry: null, spot: price };
  try {
    // Pull a band around spot: 25% OTM puts up through 20% OTM calls,
    // covering the ATM straddle + the short-put selection zone. One page.
    const expGte = (() => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + DTE_MIN - 3); return d.toISOString().slice(0, 10); })();
    const expLte = (() => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + DTE_MAX); return d.toISOString().slice(0, 10); })();
    const contracts = await fetchOptionChainSlice(symbol, {
      expirationGte: expGte,
      expirationLte: expLte,
      strikeGte: Math.floor(price * 0.75),
      strikeLte: Math.ceil(price * 1.20),
      limit: 250,
    });
    if (contracts.length === 0) return empty;

    // Spot from the chain if present (fresher than the snapshot), else snapshot.
    const spot = contracts.find((c) => typeof c.underlying_asset?.price === "number" && c.underlying_asset.price! > 0)
      ?.underlying_asset?.price ?? price;

    // Group by expiry; pick the expiry closest to 30 DTE inside the window.
    const expiries = Array.from(new Set(contracts.map((c) => c.details.expiration_date)))
      .map((e) => ({ e, dte: daysBetween(today, e) }))
      .filter((x) => x.dte >= DTE_MIN && x.dte <= DTE_MAX);
    if (expiries.length === 0) return empty;
    const target = expiries.sort((a, b) => Math.abs(a.dte - 30) - Math.abs(b.dte - 30))[0];
    const dte = target.dte;
    const T = dte / 365;

    const atExp = contracts.filter((c) => c.details.expiration_date === target.e);
    const calls = atExp.filter((c) => c.details.contract_type === "call");
    const puts = atExp.filter((c) => c.details.contract_type === "put");

    // ATM IV = avg of nearest-to-spot call + put IVs.
    const nearest = (arr: PolygonContract[]) =>
      arr.reduce<PolygonContract | null>((best, c) => {
        if (typeof c.implied_volatility !== "number" || c.implied_volatility <= 0) return best;
        if (!best) return c;
        return Math.abs(c.details.strike_price - spot) < Math.abs(best.details.strike_price - spot) ? c : best;
      }, null);
    const atmCall = nearest(calls);
    const atmPut = nearest(puts);
    const ivs = [atmCall?.implied_volatility, atmPut?.implied_volatility].filter(
      (v): v is number => typeof v === "number" && v > 0,
    );
    if (ivs.length === 0) return empty;
    const atmIv = ivs.reduce((s, v) => s + v, 0) / ivs.length;

    // ATM straddle % of spot.
    const atmCallMid = atmCall ? quoteOf(atmCall).mid : null;
    const atmPutMid = atmPut ? quoteOf(atmPut).mid : null;
    const atmStraddlePct = atmCallMid != null && atmPutMid != null && spot > 0
      ? ((atmCallMid + atmPutMid) / spot) * 100 : null;

    // Best short put: among puts with a usable bid, maximize PoP × creditPct.
    let bestPut: PremiumRankerRow["bestPut"] = null;
    let bestScore = -Infinity;
    for (const p of puts) {
      const q = quoteOf(p);
      if (q.mid == null || q.mid <= 0) continue;
      const strike = p.details.strike_price;
      if (strike >= spot) continue; // only OTM puts
      const credit = q.mid;
      const breakeven = strike - credit;
      const sigma = typeof p.implied_volatility === "number" && p.implied_volatility > 0 ? p.implied_volatility : atmIv;
      const pop = probAboveBreakeven(spot, breakeven, sigma, T);
      const creditPct = (credit / spot) * 100;
      const score = pop * creditPct;
      if (score > bestScore) {
        bestScore = score;
        bestPut = {
          expiration: target.e,
          dteDays: dte,
          strike,
          contractTicker: p.details.ticker,
          credit: Math.round(credit * 100) / 100,
          creditToClosePct: Math.round(creditPct * 1000) / 1000,
          annualizedReturnPct: Math.round(creditPct * (365 / Math.max(1, dte)) * 100) / 100,
          probabilityOfProfit: Math.round(pop * 1000) / 1000,
          delta: typeof p.greeks?.delta === "number" ? Math.round(p.greeks.delta * 1000) / 1000 : null,
          bid: q.bid,
          ask: q.ask,
          openInterest: typeof p.open_interest === "number" ? p.open_interest : null,
        };
      }
    }

    return {
      symbol,
      spot,
      targetExpiry: target.e,
      contracts: atExp, // keep only target-expiry contracts for suggestion stage
      row: {
        symbol,
        price: Math.round(spot * 100) / 100,
        dayVolume,
        atmIv: Math.round(atmIv * 10000) / 10000,
        ivRank: null, // filled later for stored rows only
        atmStraddlePct: atmStraddlePct != null ? Math.round(atmStraddlePct * 100) / 100 : null,
        bestPut,
      },
    };
  } catch {
    return empty;
  }
}

// ---------------------------------------------------------------------------
// IV rank enrichment (only for the stored top rows — cheap)
// ---------------------------------------------------------------------------

async function ivRankFor(symbol: string, currentIv: number): Promise<number | null> {
  const rows = await db
    .select({ atmIv30d: ivSnapshots.atmIv30d })
    .from(ivSnapshots)
    .where(eq(ivSnapshots.ticker, symbol))
    .orderBy(desc(ivSnapshots.snapshotDate))
    .limit(260);
  const hist = rows
    .map((r) => (r.atmIv30d != null ? Number(r.atmIv30d) : null))
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  if (hist.length < 20) return null;
  const below = hist.filter((v) => v <= currentIv).length;
  return Math.round((below / hist.length) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Suggestion builder
// ---------------------------------------------------------------------------

function buildSpread(
  symbol: string,
  spot: number,
  shortPut: NonNullable<PremiumRankerRow["bestPut"]>,
  contracts: PolygonContract[],
): PremiumRankerSpread | null {
  // Long leg: the put one band (~5% of spot, min 1 strike) below the short.
  const puts = contracts
    .filter((c) => c.details.contract_type === "put" && c.details.expiration_date === shortPut.expiration)
    .sort((a, b) => b.details.strike_price - a.details.strike_price);
  const targetLong = shortPut.strike - Math.max(spot * 0.05, 1);
  const longLeg = puts
    .filter((c) => c.details.strike_price < shortPut.strike)
    .reduce<PolygonContract | null>((best, c) => {
      if (!best) return c;
      return Math.abs(c.details.strike_price - targetLong) < Math.abs(best.details.strike_price - targetLong) ? c : best;
    }, null);
  if (!longLeg) return null;
  const longMid = quoteOf(longLeg).mid;
  if (longMid == null || shortPut.credit == null) return null;
  const netCredit = Math.round((shortPut.credit - longMid) * 100) / 100;
  if (netCredit <= 0) return null;
  const width = Math.round((shortPut.strike - longLeg.details.strike_price) * 100) / 100;
  const breakeven = Math.round((shortPut.strike - netCredit) * 100) / 100;
  return {
    type: "put",
    shortStrike: shortPut.strike,
    longStrike: longLeg.details.strike_price,
    expiration: shortPut.expiration,
    netCredit,
    width,
    maxProfit: Math.round(netCredit * 100 * 100) / 100,
    maxLoss: Math.round((width - netCredit) * 100 * 100) / 100,
    breakeven,
    probabilityOfProfit: shortPut.probabilityOfProfit,
    shortContractTicker: shortPut.contractTicker,
    longContractTicker: longLeg.details.ticker,
  };
}

function buildSuggestion(res: ScanResult): PremiumRankerSuggestion | null {
  const row = res.row;
  if (!row || !row.bestPut) return null;
  const bp = row.bestPut;
  const credit = bp.credit;
  if (credit == null) return null; // narrows the local `credit` to number
  const breakeven = Math.round((bp.strike - credit) * 100) / 100;
  const spread = buildSpread(res.symbol, res.spot, bp, res.contracts);
  const ivPct = (row.atmIv * 100).toFixed(0);
  const popPct = bp.probabilityOfProfit != null ? (bp.probabilityOfProfit * 100).toFixed(0) : "?";
  const thesis =
    `IV ${ivPct}% — the ${bp.strike} put (${bp.dteDays}d) collects $${credit.toFixed(2)} ` +
    `(${bp.annualizedReturnPct?.toFixed(0)}% annualized) with ~${popPct}% probability of profit. ` +
    (spread
      ? `Define risk with the ${spread.shortStrike}/${spread.longStrike} put credit spread.`
      : `Naked put only — no clean spread strike below.`);
  return {
    symbol: res.symbol,
    price: row.price,
    atmIv: row.atmIv,
    thesis,
    nakedPut: {
      expiration: bp.expiration,
      dteDays: bp.dteDays,
      strike: bp.strike,
      contractTicker: bp.contractTicker,
      credit,
      breakeven,
      creditToClosePct: bp.creditToClosePct,
      annualizedReturnPct: bp.annualizedReturnPct,
      probabilityOfProfit: bp.probabilityOfProfit,
      maxRisk: Math.round((bp.strike - credit) * 100 * 100) / 100,
    },
    creditSpread: spread,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export interface PremiumRankerResult {
  universeSize: number;       // survivors of price+volume gate (deep-scan input)
  computedSize: number;       // produced a usable IV row
  rows: PremiumRankerRow[];   // top STORE_TOP_N by IV
  suggestions: PremiumRankerSuggestion[];
  timing: { snapshotSec: number; scanSec: number; totalSec: number };
  truncated: boolean;
}

export async function runPremiumRankerScan(today: string): Promise<PremiumRankerResult> {
  const start = Date.now();

  // Phase 1: full-market snapshot → price + volume gate.
  const snap = await fetchAllTickersSnapshot();
  const snapshotSec = (Date.now() - start) / 1000;
  let candidates = snap.filter(
    (s) => s.price != null && s.price >= MIN_PRICE && s.dayVolume != null && s.dayVolume > MIN_DAY_VOLUME,
  );
  const truncated = candidates.length > MAX_DEEP_SCAN;
  if (truncated) {
    // Keep the highest-volume names if we ever hit the backstop.
    candidates = candidates.sort((a, b) => (b.dayVolume ?? 0) - (a.dayVolume ?? 0)).slice(0, MAX_DEEP_SCAN);
  }
  const universeSize = candidates.length;

  // Phase 2: deep-scan chains (bounded concurrency).
  const scanStart = Date.now();
  const results = await mapConcurrent(candidates, SCAN_CONCURRENCY, (c) =>
    scanTicker(c.ticker, c.price!, c.dayVolume!, today),
  );
  const scanSec = (Date.now() - scanStart) / 1000;

  const usable = results.filter((r) => r.row != null);
  const computedSize = usable.length;

  // Rank by IV (primary) and by short-put annualized premium (secondary).
  const byIv = [...usable].sort((a, b) => b.row!.atmIv - a.row!.atmIv);
  const byPrem = [...usable].sort(
    (a, b) => (b.row!.bestPut?.annualizedReturnPct ?? -1) - (a.row!.bestPut?.annualizedReturnPct ?? -1),
  );
  const premRankOf = new Map<string, number>();
  byPrem.forEach((r, i) => premRankOf.set(r.symbol, i + 1));

  // Take the top STORE_TOP_N by IV; enrich those with IV rank.
  const topResults = byIv.slice(0, STORE_TOP_N);
  const rows: PremiumRankerRow[] = [];
  for (let i = 0; i < topResults.length; i++) {
    const r = topResults[i].row!;
    const ivRank = await ivRankFor(r.symbol, r.atmIv).catch(() => null);
    rows.push({
      ...r,
      ivRank,
      rankByIv: i + 1,
      rankByPremium: premRankOf.get(r.symbol) ?? 0,
    });
  }

  // Phase 3: 3 headline suggestions. Pick from the top-IV names that have a
  // clean tradeable put (PoP in a sane band, OI present). Skip near-duplicates.
  const suggestions: PremiumRankerSuggestion[] = [];
  for (const res of byIv) {
    if (suggestions.length >= 3) break;
    const bp = res.row?.bestPut;
    if (!bp || bp.credit == null) continue;
    const pop = bp.probabilityOfProfit ?? 0;
    if (pop < 0.6 || pop > 0.92) continue;           // tradeable PoP band
    if ((bp.openInterest ?? 0) < 100) continue;       // liquid enough
    const s = buildSuggestion(res);
    if (s) suggestions.push(s);
  }

  return {
    universeSize,
    computedSize,
    rows,
    suggestions,
    timing: { snapshotSec, scanSec, totalSec: (Date.now() - start) / 1000 },
    truncated,
  };
}
