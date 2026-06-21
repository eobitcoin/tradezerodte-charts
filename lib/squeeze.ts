/**
 * Squeeze Watch scanner.
 *
 * Walks a curated ~150-name universe of small/mid-cap + historically
 * high-SI tickers, pulls FINRA short interest + Polygon ticker overview +
 * 30-day price action, scores each candidate on a composite 0-100 squeeze
 * index, and persists the top N to squeeze_scans.
 *
 * Scoring (each sub-score 0-100, higher = more squeeze-y):
 *
 *   siPctScore     SI ÷ shares outstanding, ramped 10% → 40%
 *   dtcScore       days-to-cover, ramped 2 → 10
 *   momentumScore  5-day return, ramped -5% → +15%
 *   ivRankScore    atm IV rank (0..100) from iv_snapshots if covered
 *
 * Composite weights: SI%=35, DTC=25, momentum=20, IV=20. Re-tune later
 * based on track record.
 *
 * Filter bar: SI% ≥ 10 OR DTC ≥ 3. Names that don't clear either are
 * just not crowded enough to matter — they get dropped from the ranking
 * (still counted in universeSize).
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
} from "@/lib/db/schema";
import {
  fetchLatestShortInterest,
  fetchTickerOverview,
  fetchUnderlyingDailyBars,
} from "@/lib/polygon";
import { nyTradingDay } from "@/lib/trading-day";

// ----------------------------------------------------------------------------
// Universe — ~150 curated squeeze-prone names. Mix of:
//   - Historical meme / retail favorites (still trading)
//   - Small-cap biotechs with binary catalyst risk
//   - "Story stocks" (EVs, alt-energy, fintech, crypto-adjacent)
//   - High-SI S&P 500 names
//   - Cannabis + China ADRs (chronically over-shorted segments)
// Refresh annually — drop delisted names, add new squeeze-prone IPOs.
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
  // China ADRs (chronically heavily shorted)
  "BABA", "JD", "PDD", "BIDU", "BILI", "TME", "IQ", "FUTU", "TIGR", "EDU",
  "TAL", "YMM", "DIDIY",
  // Cannabis
  "TLRY", "CGC", "ACB", "CRON", "SNDL", "OGI", "HEXO",
  // Biotech / pharma (binary cats)
  "SAVA", "GERN", "ABEO", "IMVT", "ATAI", "KRYS", "CRNX", "VYNE", "RIGL",
  "MNMD", "CMPS", "ATXI", "TENX", "DRMA", "ATHA",
  // Crypto-adjacent
  "MARA", "RIOT", "HUT", "BITF", "CLSK", "WULF", "CIFR", "CORZ", "GLXY",
  // Streaming / media
  "ROKU", "FUBO", "SPOT", "WBD", "PARA", "DIS",
  // SPACs / story stocks
  "DWAC", "PHUN", "BBIG", "GREE", "MMAT", "XL", "VLDR", "OUST", "EH", "GFAI",
  // Regional banks / financials under pressure
  "ZION", "KEY", "RF", "CFG", "PACW", "WAL", "CMA", "NYCB",
  // Real estate / mortgage
  "OPAD", "RDFN", "RKT", "LDI",
  // Industrials with squeeze history
  "DAL", "AAL", "JBLU", "ALK", "SAVE",
] as const;

export const TOP_N = 25;
export const MIN_SI_PCT_SO = 10;
export const MIN_DTC = 3;

// Sub-score weights — must sum to 1.
const W_SI = 0.35;
const W_DTC = 0.25;
const W_MOM = 0.20;
const W_IV = 0.20;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function rampScore(value: number, zeroAt: number, hundredAt: number): number {
  if (hundredAt === zeroAt) return 0;
  const t = (value - zeroAt) / (hundredAt - zeroAt);
  return clamp(t * 100, 0, 100);
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

/** Compute the trailing 5- and 30-day total return from a daily closes map.
 *  Returns null when there aren't enough sessions in scope. */
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

/** Compute the latest IV rank for a ticker by pulling its 30d ATM IV
 *  history from iv_snapshots and ranking the most recent value's percentile.
 *  Returns null when the ticker isn't in the IV scan universe (most squeeze
 *  candidates aren't — they're outside the 25-name Options Edge watchlist). */
async function fetchLatestIvRank(ticker: string): Promise<number | null> {
  const rows = await db
    .select({ atmIv30d: ivSnapshots.atmIv30d })
    .from(ivSnapshots)
    .where(eq(ivSnapshots.ticker, ticker))
    .orderBy(desc(ivSnapshots.snapshotDate))
    .limit(260); // ~1 year of trading days
  const ivs = rows
    .map((r) => (r.atmIv30d != null ? Number(r.atmIv30d) : null))
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  if (ivs.length < 20) return null;
  const current = ivs[0];
  const below = ivs.filter((v) => v <= current).length;
  return (below / ivs.length) * 100;
}

export interface SqueezeScanResult {
  scanDay: string;
  universeSize: number;
  rankedSize: number;
  ranked: SqueezeCandidate[];
  errors: Array<{ ticker: string; message: string }>;
}

/** Walk the universe, score each name, persist top N to squeeze_scans. */
export async function runSqueezeScan(opts: {
  perTickerDelayMs?: number;
  topN?: number;
} = {}): Promise<SqueezeScanResult> {
  const perTickerDelayMs = opts.perTickerDelayMs ?? 250;
  const topN = opts.topN ?? TOP_N;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const today = nyTradingDay();
  // Look back ~50 calendar days so we always have 30 trading sessions in
  // scope even across long weekends or holiday-shortened weeks.
  const fromDate = (() => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 50);
    return d.toISOString().slice(0, 10);
  })();

  const candidates: SqueezeCandidate[] = [];
  const errors: Array<{ ticker: string; message: string }> = [];
  let first = true;

  for (const ticker of SQUEEZE_UNIVERSE) {
    if (!first) await sleep(perTickerDelayMs);
    first = false;

    try {
      const [si, overview, closes, ivRank] = await Promise.all([
        fetchLatestShortInterest(ticker),
        fetchTickerOverview(ticker),
        fetchUnderlyingDailyBars(ticker, fromDate, today),
        fetchLatestIvRank(ticker),
      ]);

      if (!si) continue; // No SI history — skip silently.

      const sharesOutstanding =
        overview?.share_class_shares_outstanding ??
        overview?.weighted_shares_outstanding ??
        null;
      const shortInterestPctSO =
        sharesOutstanding && sharesOutstanding > 0
          ? (si.short_interest / sharesOutstanding) * 100
          : null;

      const { lastClose, r5, r30 } = returnsFromCloses(closes);
      if (lastClose == null) continue; // No price data — can't score.

      // Filter: must have SI% ≥ 10 OR DTC ≥ 3 to make the ranking.
      const passSi = shortInterestPctSO != null && shortInterestPctSO >= MIN_SI_PCT_SO;
      const passDtc = si.days_to_cover >= MIN_DTC;
      if (!passSi && !passDtc) continue;

      const siPctScore = shortInterestPctSO != null
        ? rampScore(shortInterestPctSO, 10, 40)
        : 0;
      const dtcScore = rampScore(si.days_to_cover, 2, 10);
      const momentumScore = r5 != null ? rampScore(r5, -5, 15) : 50; // neutral when missing
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
      candidates.push(candidate);
    } catch (err) {
      errors.push({
        ticker,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Sort desc by composite, take top N.
  candidates.sort((a, b) => b.compositeScore - a.compositeScore);
  const ranked = candidates.slice(0, topN);

  // UPSERT one row per scan_day.
  await db
    .insert(squeezeScans)
    .values({
      scanDay: today,
      universeSize: SQUEEZE_UNIVERSE.length,
      rankedSize: ranked.length,
      candidates: ranked,
      meta: {
        weights: { si: W_SI, dtc: W_DTC, momentum: W_MOM, iv: W_IV },
        filterBar: { minSiPctSO: MIN_SI_PCT_SO, minDtc: MIN_DTC },
        errorCount: errors.length,
      },
    })
    .onConflictDoUpdate({
      target: squeezeScans.scanDay,
      set: {
        universeSize: SQUEEZE_UNIVERSE.length,
        rankedSize: ranked.length,
        candidates: ranked,
        meta: {
          weights: { si: W_SI, dtc: W_DTC, momentum: W_MOM, iv: W_IV },
          filterBar: { minSiPctSO: MIN_SI_PCT_SO, minDtc: MIN_DTC },
          errorCount: errors.length,
        },
        updatedAt: sql`now()`,
      },
    });

  return {
    scanDay: today,
    universeSize: SQUEEZE_UNIVERSE.length,
    rankedSize: ranked.length,
    ranked,
    errors,
  };
}
