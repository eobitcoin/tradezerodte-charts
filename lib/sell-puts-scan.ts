/**
 * Sell Puts scanner.
 *
 * Walks the locked universe (`SELL_PUTS_UNIVERSE`) and picks the most
 * attractive cash-secured short put for each ticker in the 21–45 DTE
 * window. Ranking is `expectedRoiScore = P(profit) × (credit / close)`.
 *
 * Probability of profit is risk-neutral Black-Scholes:
 *   trade profits if S_T > breakeven, where breakeven = strike − credit
 *   P(profit) = N(d2) under r-neutral measure
 *   d2 = (ln(S/K_breakeven) + (r − σ²/2) T) / (σ √T)
 *
 * Strike selection: from every put with bid > 0 in the DTE window,
 * pick the one with highest expectedRoiScore. That naturally prefers
 * higher-delta puts (more credit) up to the point where P(profit)
 * starts dropping fast — usually lands in the 15-25 delta zone.
 *
 * Skip reasons (recorded but excluded from the table):
 *   - Polygon chain fetch failed
 *   - No puts in 21-45 DTE window
 *   - No put with bid > 0 (illiquid name)
 *   - Spot price missing
 */

import { fetchOptionChain } from "@/lib/polygon";
import { normalCdf } from "@/lib/black-scholes";
import type { SellPutPick, SellPutTier } from "@/lib/db/schema";
import { SELL_PUTS_UNIVERSE } from "@/lib/sell-puts-universe";

const RISK_FREE_RATE = 0.04;
const DTE_MIN = 21;
const DTE_MAX = 45;

/** PoP tier boundaries. Each (ticker × tier) cell produces at most one
 *  pick — the highest-ranked candidate inside that tier. Users pick
 *  the tier philosophy that matches their trade plan from a tab strip. */
const TIER_BOUNDS: Record<
  SellPutTier,
  { popMin: number; popMax: number }
> = {
  conservative: { popMin: 0.85, popMax: 1.0 },
  balanced: { popMin: 0.7, popMax: 0.85 },
  aggressive: { popMin: 0.0, popMax: 0.7 },
};

const TIERS: SellPutTier[] = ["conservative", "balanced", "aggressive"];

function tierFor(pop: number): SellPutTier {
  if (pop >= 0.85) return "conservative";
  if (pop >= 0.7) return "balanced";
  return "aggressive";
}

/**
 * Risk-neutral probability that the stock closes ABOVE breakeven at
 * expiry. Equivalent to N(d2) with K = breakeven.
 */
function probabilityAboveBreakeven(opts: {
  spot: number;
  breakeven: number;
  sigma: number;
  T: number;
  r?: number;
}): number {
  const { spot, breakeven, sigma, T } = opts;
  const r = opts.r ?? RISK_FREE_RATE;
  if (spot <= 0 || breakeven <= 0 || sigma <= 0 || T <= 0) return 0;
  const d2 =
    (Math.log(spot / breakeven) + (r - 0.5 * sigma * sigma) * T) /
    (sigma * Math.sqrt(T));
  return normalCdf(d2);
}

/** Days between two ISO dates (calendar). */
function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Up to 3 picks for a single ticker — one per PoP tier. Tickers that
 *  fail to fetch the chain return a SINGLE skipped entry so the cron
 *  can keep diagnostic visibility. */
async function scanOneTicker(
  ticker: string,
  scanDay: string,
): Promise<SellPutPick[]> {
  const baseline: SellPutPick = {
    tier: "aggressive",
    symbol: ticker,
    close: null,
    dividendYieldPct: null,
    expiration: "",
    dteDays: 0,
    contractTicker: "",
    strike: 0,
    putCredit: null,
    breakeven: null,
    breakevenCushionPct: null,
    creditToClosePct: null,
    annualizedReturnPct: null,
    probabilityOfProfit: null,
    expectedRoiScore: null,
    iv: null,
    ivRank: null,
    quoteSlippagePct: null,
    bid: null,
    ask: null,
    openInterest: null,
    delta: null,
  };

  let chain;
  try {
    chain = await fetchOptionChain(ticker);
  } catch (err) {
    return [
      {
        ...baseline,
        skipReason: `Chain fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
  if (chain.length === 0) {
    return [{ ...baseline, skipReason: "Empty chain" }];
  }

  // Spot from any chain row's underlying_asset.price (Polygon snapshot
  // includes it on every contract — they all have the same value).
  const spot =
    chain.find((c) => c.underlying_asset?.price != null)?.underlying_asset
      ?.price ?? null;
  if (spot == null || spot <= 0) {
    return [{ ...baseline, skipReason: "No underlying spot" }];
  }
  baseline.close = spot;

  // Filter to OTM puts in the DTE window with a real bid.
  type Cand = {
    contractTicker: string;
    strike: number;
    expiration: string;
    dteDays: number;
    bid: number;
    ask: number;
    iv: number;
    delta: number | null;
    openInterest: number | null;
  };
  const candidates: Cand[] = [];
  for (const c of chain) {
    if (c.details.contract_type !== "put") continue;
    if (c.details.strike_price >= spot) continue; // OTM only
    const dte = daysBetween(scanDay, c.details.expiration_date);
    if (dte < DTE_MIN || dte > DTE_MAX) continue;
    const bid = c.last_quote?.bid;
    const ask = c.last_quote?.ask;
    const iv = c.implied_volatility;
    if (!bid || bid <= 0) continue;
    if (!ask || ask <= 0) continue;
    if (!iv || iv <= 0) continue;
    candidates.push({
      contractTicker: c.details.ticker,
      strike: c.details.strike_price,
      expiration: c.details.expiration_date,
      dteDays: dte,
      bid,
      ask,
      iv,
      delta:
        typeof c.greeks?.delta === "number" ? c.greeks.delta : null,
      openInterest: c.open_interest ?? null,
    });
  }
  if (candidates.length === 0) {
    return [
      { ...baseline, skipReason: "No OTM puts in 21-45 DTE window" },
    ];
  }

  // Score each candidate and bucket by tier. Within each tier, we keep
  // the BEST candidate by the tier's own ranking metric:
  //   conservative — sorted by annualized return (safety-first; you
  //     want the highest yield among already-safe setups)
  //   balanced     — sorted by expectedRoiScore (the standard metric)
  //   aggressive   — sorted by expectedRoiScore (same; high credit wins)
  const bestPerTier: Partial<Record<SellPutTier, SellPutPick>> = {};
  const bestRankPerTier: Partial<Record<SellPutTier, number>> = {};

  for (const c of candidates) {
    const credit = c.bid;
    const breakeven = c.strike - credit;
    if (breakeven <= 0) continue;
    const creditToClose = (credit / spot) * 100;
    const cushion = ((spot - breakeven) / spot) * 100;
    const T = Math.max(1, c.dteDays) / 365;
    const pop = probabilityAboveBreakeven({
      spot,
      breakeven,
      sigma: c.iv,
      T,
    });
    const expectedRoi = pop * creditToClose;
    const annualized =
      c.dteDays > 0 ? creditToClose * (365 / c.dteDays) : null;
    const slippage =
      c.ask > 0 ? (100 * (c.ask - c.bid)) / c.ask : null;

    const tier = tierFor(pop);
    const rank =
      tier === "conservative" ? annualized ?? 0 : expectedRoi;
    const currentBest = bestRankPerTier[tier];
    if (currentBest == null || rank > currentBest) {
      bestRankPerTier[tier] = rank;
      bestPerTier[tier] = {
        tier,
        symbol: ticker,
        close: spot,
        dividendYieldPct: null,
        expiration: c.expiration,
        dteDays: c.dteDays,
        contractTicker: c.contractTicker,
        strike: c.strike,
        putCredit: credit,
        breakeven,
        breakevenCushionPct: cushion,
        creditToClosePct: creditToClose,
        annualizedReturnPct: annualized,
        probabilityOfProfit: pop,
        expectedRoiScore: expectedRoi,
        iv: c.iv,
        ivRank: null,
        quoteSlippagePct: slippage,
        bid: c.bid,
        ask: c.ask,
        openInterest: c.openInterest,
        delta: c.delta,
      };
    }
  }

  const out: SellPutPick[] = [];
  for (const tier of TIERS) {
    const pick = bestPerTier[tier];
    if (pick) out.push(pick);
  }
  if (out.length === 0) {
    return [
      { ...baseline, skipReason: "No tradeable put after tier scoring" },
    ];
  }
  return out;
}

export interface SellPutsScanOptions {
  /** Delay between tickers to keep us under Polygon's per-minute cap.
   *  ~600ms × 53 names ≈ 32 sec of pure sleep, well within timeout. */
  perTickerDelayMs?: number;
}

export interface SellPutsScanResult {
  scanDay: string;
  picks: SellPutPick[];
  universeSize: number;
  computedSize: number;
}

/** Walks the universe sequentially, returns sorted picks. */
export async function runSellPutsScan(
  scanDay: string,
  opts: SellPutsScanOptions = {},
): Promise<SellPutsScanResult> {
  const delay = opts.perTickerDelayMs ?? 600;
  const allPicks: SellPutPick[] = [];
  for (const ticker of SELL_PUTS_UNIVERSE) {
    try {
      const picks = await scanOneTicker(ticker, scanDay);
      allPicks.push(...picks);
    } catch (err) {
      allPicks.push({
        tier: "aggressive",
        symbol: ticker,
        close: null,
        dividendYieldPct: null,
        expiration: "",
        dteDays: 0,
        contractTicker: "",
        strike: 0,
        putCredit: null,
        breakeven: null,
        breakevenCushionPct: null,
        creditToClosePct: null,
        annualizedReturnPct: null,
        probabilityOfProfit: null,
        expectedRoiScore: null,
        iv: null,
        ivRank: null,
        quoteSlippagePct: null,
        bid: null,
        ask: null,
        openInterest: null,
        delta: null,
        skipReason: `Scan error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }

  // Tradeable picks sorted within tier: conservative by annualized
  // return desc, balanced/aggressive by expectedRoiScore desc.
  // Skipped picks appended for diagnostic visibility.
  const tradeable = allPicks.filter(
    (p) => !p.skipReason && p.expectedRoiScore != null,
  );
  const tierOrder: Record<SellPutTier, number> = {
    conservative: 0,
    balanced: 1,
    aggressive: 2,
  };
  tradeable.sort((a, b) => {
    const ta = a.tier ?? "aggressive";
    const tb = b.tier ?? "aggressive";
    if (ta !== tb) return tierOrder[ta] - tierOrder[tb];
    if (ta === "conservative") {
      return (
        (b.annualizedReturnPct ?? -Infinity) -
        (a.annualizedReturnPct ?? -Infinity)
      );
    }
    return (
      (b.expectedRoiScore ?? -Infinity) -
      (a.expectedRoiScore ?? -Infinity)
    );
  });
  const skipped = allPicks.filter(
    (p) => p.skipReason || p.expectedRoiScore == null,
  );

  // computedSize counts UNIQUE tickers with at least one tradeable pick,
  // not total picks (else a ticker with 3 picks gets counted 3 times).
  const uniqueTickers = new Set(tradeable.map((p) => p.symbol));

  return {
    scanDay,
    picks: [...tradeable, ...skipped],
    universeSize: SELL_PUTS_UNIVERSE.length,
    computedSize: uniqueTickers.size,
  };
}
