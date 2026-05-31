/**
 * Earnings Scans V1.
 *
 * For each company reporting earnings in the upcoming week, computes
 * historical earnings-effect stats from past N cycles + current ATM
 * IV + implied move, and scores each of the four strategies (Rush,
 * Condor, Straddle, Breakout) based on how the historical pattern
 * fits each strategy's edge case.
 *
 * V1 does NOT do a full options backtest — that's V2/V3. Instead it
 * uses HEURISTIC scoring driven by:
 *   - Historical earnings move magnitude (median |move|)
 *   - Move directionality (avg signed move — bullish/bearish bias)
 *   - Current IV-implied move (from ATM straddle at the first
 *     post-earnings expiry)
 *   - Comparison: implied vs historical (over/under-pricing)
 *
 * Heuristic edge cases:
 *   - Straddle WINS when historical |move| >> implied move (market
 *     under-pricing volatility into earnings)
 *   - Condor WINS when historical |move| << implied move (market
 *     over-pricing volatility) — bonus if move is consistent (low max)
 *   - Rush WINS when implied IV is currently low relative to peak
 *     historical IVs (we proxy this with "implied move headroom")
 *   - Breakout WINS when historical post-EE moves show directional
 *     consistency (skewed positive or negative average move)
 *
 * V2 will replace these heuristics with actual backtest stats.
 */

import {
  fetchOptionChain,
  fetchUnderlyingDailyBars,
} from "@/lib/polygon";
import {
  fetchEarningsHistory,
  type FinnhubEarningsEvent,
} from "@/lib/finnhub";
import type {
  EarningsHistoryPoint,
  EarningsStrategySuggestion,
  EarningsTickerEntry,
} from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Liquidity bar — without options volume there's nothing to scan.
// ---------------------------------------------------------------------------

const MIN_TOTAL_OI = 5_000;       // sum across the nearest expiry
const MIN_HISTORY_CYCLES = 4;     // need at least 4 past EEs for stable stats
const TARGET_HISTORY_CYCLES = 10; // ideal

// ---------------------------------------------------------------------------
// Per-EE price-change computation.
// ---------------------------------------------------------------------------

/**
 * Compute the surrounding close-to-close % change for one past
 * earnings event. The window depends on BMO vs AMC:
 *
 *   BMO (Before Market Open): reaction is from PRIOR close → SAME-day
 *     close. Buy yesterday afternoon, sell same-day close.
 *   AMC (After Market Close): reaction is from SAME-day close →
 *     NEXT-day close. Buy this afternoon, sell tomorrow's close.
 *   DMH (unknown/intraday): default to same as AMC.
 *
 * Returns null when bars are missing.
 */
function computeEePriceChange(
  closes: Map<string, number>,
  eeDate: string,
  hour: "bmo" | "amc" | "dmh",
): { pricePctChange: number | null; before: number | null; after: number | null } {
  const allDates = [...closes.keys()].sort();
  const idx = allDates.indexOf(eeDate);
  if (idx === -1) {
    // The EE date itself isn't in the bar set (weekend? holiday? non-traded
    // day). Use the closest preceding trading day as anchor.
    let i = allDates.length - 1;
    while (i >= 0 && allDates[i] > eeDate) i--;
    if (i < 0) return { pricePctChange: null, before: null, after: null };
    return { pricePctChange: null, before: closes.get(allDates[i]) ?? null, after: null };
  }
  const sameDayClose = closes.get(allDates[idx])!;
  const priorClose = idx > 0 ? closes.get(allDates[idx - 1]) ?? null : null;
  const nextClose = idx < allDates.length - 1 ? closes.get(allDates[idx + 1]) ?? null : null;

  let before: number | null = null;
  let after: number | null = null;
  if (hour === "bmo") {
    before = priorClose;
    after = sameDayClose;
  } else {
    // amc or dmh
    before = sameDayClose;
    after = nextClose;
  }
  if (before == null || after == null || before <= 0) {
    return { pricePctChange: null, before, after };
  }
  return {
    pricePctChange: ((after - before) / before) * 100,
    before,
    after,
  };
}

function summarize(values: Array<number | null>): {
  count: number;
  median: number | null;
  mean: number | null;
  max: number | null;
  min: number | null;
  medianAbs: number | null;
} {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length === 0) {
    return { count: 0, median: null, mean: null, max: null, min: null, medianAbs: null };
  }
  const sorted = [...v].sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const absSorted = [...v.map(Math.abs)].sort((a, b) => a - b);
  const medianAbs =
    absSorted.length % 2 === 1
      ? absSorted[(absSorted.length - 1) / 2]
      : (absSorted[absSorted.length / 2 - 1] + absSorted[absSorted.length / 2]) / 2;
  return {
    count: v.length,
    median,
    mean,
    max: Math.max(...v),
    min: Math.min(...v),
    medianAbs,
  };
}

// ---------------------------------------------------------------------------
// Current chain helpers — spot, ATM IV, implied move.
// ---------------------------------------------------------------------------

/**
 * Find the closest listed expiry on or after the target date, then
 * extract ATM call IV + implied move from the ATM straddle midprice.
 *
 * implied move % ≈ (atm_call_mid + atm_put_mid) / spot × 100
 *
 * This is the conventional "earnings expected move" approximation.
 * Returns nulls when the chain can't be parsed.
 */
async function fetchChainSnapshot(
  symbol: string,
  postEeDate: string,
): Promise<{
  spot: number | null;
  atmIv: number | null;
  impliedMovePct: number | null;
  totalOi: number;
}> {
  let chain;
  try {
    chain = await fetchOptionChain(symbol);
  } catch {
    return { spot: null, atmIv: null, impliedMovePct: null, totalOi: 0 };
  }
  if (chain.length === 0) {
    return { spot: null, atmIv: null, impliedMovePct: null, totalOi: 0 };
  }

  // Spot from any contract.
  let spot: number | null = null;
  for (const c of chain) {
    const p = c.underlying_asset?.price;
    if (typeof p === "number" && Number.isFinite(p) && p > 0) {
      spot = p;
      break;
    }
  }
  if (spot == null) return { spot: null, atmIv: null, impliedMovePct: null, totalOi: 0 };

  // Closest expiry >= postEeDate (or, failing that, the closest expiry to
  // postEeDate at all).
  const expiries = [...new Set(chain.map((c) => c.details.expiration_date))].sort();
  let pickExpiry =
    expiries.find((e) => e >= postEeDate) ??
    expiries[expiries.length - 1] ??
    null;
  if (!pickExpiry) return { spot, atmIv: null, impliedMovePct: null, totalOi: 0 };

  const expiryContracts = chain.filter(
    (c) => c.details.expiration_date === pickExpiry,
  );

  // Find ATM strike — minimum |strike − spot|.
  let atmStrike = expiryContracts[0].details.strike_price;
  let atmDist = Math.abs(atmStrike - spot);
  for (const c of expiryContracts) {
    const d = Math.abs(c.details.strike_price - spot);
    if (d < atmDist) {
      atmDist = d;
      atmStrike = c.details.strike_price;
    }
  }
  const atmCall = expiryContracts.find(
    (c) => c.details.strike_price === atmStrike && c.details.contract_type === "call",
  );
  const atmPut = expiryContracts.find(
    (c) => c.details.strike_price === atmStrike && c.details.contract_type === "put",
  );
  const atmIv = atmCall?.implied_volatility ?? atmPut?.implied_volatility ?? null;

  // Implied move from ATM straddle mid.
  const callMid =
    typeof atmCall?.last_quote?.bid === "number" &&
    typeof atmCall?.last_quote?.ask === "number" &&
    atmCall.last_quote.ask > atmCall.last_quote.bid
      ? (atmCall.last_quote.bid + atmCall.last_quote.ask) / 2
      : null;
  const putMid =
    typeof atmPut?.last_quote?.bid === "number" &&
    typeof atmPut?.last_quote?.ask === "number" &&
    atmPut.last_quote.ask > atmPut.last_quote.bid
      ? (atmPut.last_quote.bid + atmPut.last_quote.ask) / 2
      : null;
  const impliedMovePct =
    callMid != null && putMid != null && spot > 0
      ? ((callMid + putMid) / spot) * 100
      : null;

  const totalOi = chain.reduce((s, c) => s + (c.open_interest ?? 0), 0);

  return { spot, atmIv, impliedMovePct, totalOi };
}

// ---------------------------------------------------------------------------
// Strategy scoring heuristics.
// ---------------------------------------------------------------------------

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Score each strategy 0-100 based on the historical EE pattern + current
 * implied move. Higher = stronger match.
 *
 * The four strategies and the patterns they want:
 *
 *   STRADDLE: market is UNDER-pricing the move. Historical |move| is
 *     consistently HIGHER than current implied. Long vol pays.
 *
 *   CONDOR: market is OVER-pricing the move. Historical |move| is
 *     consistently LOWER than current implied. Short vol pays.
 *     Bonus if max historical move is also bounded (no surprise spikes).
 *
 *   RUSH: pre-earnings IV expansion. Best when current implied is LOW
 *     and historical IV typically expands into earnings (proxy: low
 *     current implied move %). Captured by inverting CONDOR signal
 *     and weighting by current vol regime.
 *
 *   BREAKOUT: directional continuation. Best when historical signed
 *     moves are CONSISTENTLY in one direction (avg << median ABS, but
 *     same SIGN). Captured via mean signed move + win-rate of same-sign
 *     trades.
 */
function scoreStrategies(
  history: EarningsHistoryPoint[],
  stats: ReturnType<typeof summarize>,
  impliedMovePct: number | null,
): EarningsTickerEntry["strategies"] {
  const moves = history
    .map((h) => h.pricePctChange)
    .filter((x): x is number => x != null);
  const median = stats.median;
  const medianAbs = stats.medianAbs;
  const mean = stats.mean;

  // Sample sign-consistency: how many past moves matched the sign of
  // the mean. Used for Breakout.
  const signMatchRate =
    mean == null || moves.length === 0
      ? 0
      : moves.filter((m) => (m > 0 && mean > 0) || (m < 0 && mean < 0)).length / moves.length;

  // STRADDLE: |historical median| / implied > 1 means historical
  // tends to exceed implied. Score scales: 1.0 → 50, 1.5 → 75, 2.0+ → 100.
  let straddleScore = 0;
  let straddleRationale = "Insufficient data";
  if (medianAbs != null && impliedMovePct != null && impliedMovePct > 0) {
    const ratio = medianAbs / impliedMovePct;
    straddleScore = clamp(50 * ratio);
    if (ratio > 1.2) {
      straddleRationale = `Hist |move| ${medianAbs.toFixed(1)}% > implied ${impliedMovePct.toFixed(1)}% (${ratio.toFixed(2)}×) — long vol favored`;
    } else if (ratio < 0.8) {
      straddleRationale = `Hist |move| ${medianAbs.toFixed(1)}% < implied ${impliedMovePct.toFixed(1)}% (${ratio.toFixed(2)}×) — long vol disfavored`;
    } else {
      straddleRationale = `Hist |move| ${medianAbs.toFixed(1)}% ≈ implied ${impliedMovePct.toFixed(1)}% — neutral`;
    }
  }

  // CONDOR: inverse of straddle — historical < implied is best.
  let condorScore = 0;
  let condorRationale = "Insufficient data";
  if (medianAbs != null && impliedMovePct != null && impliedMovePct > 0) {
    const ratio = medianAbs / impliedMovePct;
    condorScore = clamp(100 - 50 * ratio);
    // Penalize if any historical move spikes way past implied (tail risk).
    if (stats.max != null && stats.min != null) {
      const worstAbs = Math.max(Math.abs(stats.max), Math.abs(stats.min));
      if (impliedMovePct > 0 && worstAbs / impliedMovePct > 2.5) {
        condorScore = clamp(condorScore - 25);
      }
    }
    if (ratio < 0.8) {
      condorRationale = `Hist |move| ${medianAbs.toFixed(1)}% < implied ${impliedMovePct.toFixed(1)}% — IV crush + bounded move favored`;
    } else if (ratio > 1.2) {
      condorRationale = `Hist |move| ${medianAbs.toFixed(1)}% > implied ${impliedMovePct.toFixed(1)}% — wings likely tested, condor risky`;
    } else {
      condorRationale = `Hist |move| ${medianAbs.toFixed(1)}% ≈ implied ${impliedMovePct.toFixed(1)}% — neutral`;
    }
  }

  // BREAKOUT: directional sign-consistency. Score scales:
  //   signMatchRate 0.5 → 0; 0.7 → 50; 0.85 → 80; 1.0 → 100.
  const breakoutScore = clamp((signMatchRate - 0.5) * 200);
  const breakoutDir =
    mean != null && mean > 0 ? "bullish" : mean != null && mean < 0 ? "bearish" : "mixed";
  let breakoutRationale = "Insufficient data";
  if (stats.count >= MIN_HISTORY_CYCLES && mean != null) {
    breakoutRationale = `${(signMatchRate * 100).toFixed(0)}% of past EEs moved ${breakoutDir} (avg ${mean >= 0 ? "+" : ""}${mean.toFixed(1)}%)`;
  }

  // RUSH: long IV before crush. Best when implied is HIGH (lots of vega
  // to gain) and historical IV expansion is reliable. Proxy: high implied
  // move + decent historical magnitude.
  let rushScore = 0;
  let rushRationale = "Insufficient data";
  if (impliedMovePct != null && impliedMovePct > 0 && medianAbs != null) {
    // Implied move >5% suggests IV is rising into earnings (a lot to gain).
    const ivScore = clamp((impliedMovePct - 3) * 20);   // 3% → 0, 5% → 40, 8% → 100
    const histScore = clamp(medianAbs * 15);            // 3% → 45, 5% → 75
    rushScore = (ivScore + histScore) / 2;
    rushRationale = `Implied ${impliedMovePct.toFixed(1)}% + hist |move| ${medianAbs.toFixed(1)}% — pre-EE vega tradable`;
  }

  return {
    rush: {
      suggested: rushScore >= 60,
      score: Math.round(rushScore),
      rationale: rushRationale,
    },
    condor: {
      suggested: condorScore >= 60,
      score: Math.round(condorScore),
      rationale: condorRationale,
    },
    straddle: {
      suggested: straddleScore >= 60,
      score: Math.round(straddleScore),
      rationale: straddleRationale,
    },
    breakout: {
      suggested: breakoutScore >= 60,
      score: Math.round(breakoutScore),
      rationale: breakoutRationale,
    },
  };
}

// ---------------------------------------------------------------------------
// Top-level: compute one ticker's full entry.
// ---------------------------------------------------------------------------

export async function computeEarningsTickerEntry(opts: {
  event: FinnhubEarningsEvent;
}): Promise<EarningsTickerEntry | null> {
  const { event } = opts;
  const symbol = event.symbol;
  const notes: string[] = [];

  // Pull current chain (also yields total OI for our liquidity filter).
  const snap = await fetchChainSnapshot(symbol, event.date);
  if (snap.totalOi < MIN_TOTAL_OI) {
    return null; // illiquid — drop silently
  }

  // Past earnings + historical price changes.
  const earningsHistory = await fetchEarningsHistory(symbol, TARGET_HISTORY_CYCLES);
  if (earningsHistory.length < MIN_HISTORY_CYCLES) {
    notes.push(`Only ${earningsHistory.length} past EEs — stats may be noisy`);
  }
  // Need underlying bars across the full history window.
  const earliestEE = earningsHistory.length > 0
    ? earningsHistory[earningsHistory.length - 1].date
    : null;
  const today = new Date().toISOString().slice(0, 10);
  let bars = new Map<string, number>();
  if (earliestEE) {
    const from = new Date(earliestEE);
    from.setUTCDate(from.getUTCDate() - 5); // pad for weekends/holidays
    try {
      bars = await fetchUnderlyingDailyBars(symbol, from.toISOString().slice(0, 10), today);
    } catch (err) {
      notes.push(`Aggregates fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const history: EarningsHistoryPoint[] = earningsHistory.map((e) => {
    const { pricePctChange, before, after } = computeEePriceChange(bars, e.date, e.hour);
    return {
      date: e.date,
      hour: e.hour,
      pricePctChange,
      priceBefore: before,
      priceAfter: after,
    };
  });

  const stats = summarize(history.map((h) => h.pricePctChange));
  const strategies = scoreStrategies(history, stats, snap.impliedMovePct);

  return {
    symbol,
    earningsDate: event.date,
    hour: event.hour,
    spot: snap.spot,
    atmIv: snap.atmIv,
    impliedMovePct: snap.impliedMovePct,
    history,
    historyStats: stats,
    strategies,
    notes,
  };
}

/** Universe-level scan: walk all upcoming events, compute entries. */
export async function runEarningsScan(
  events: FinnhubEarningsEvent[],
  opts: { perEventDelayMs?: number } = {},
): Promise<EarningsTickerEntry[]> {
  const perEventDelayMs = opts.perEventDelayMs ?? 600;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const out: EarningsTickerEntry[] = [];
  let first = true;
  for (const event of events) {
    if (!first) await sleep(perEventDelayMs);
    first = false;
    try {
      const entry = await computeEarningsTickerEntry({ event });
      if (entry) out.push(entry);
    } catch {
      // Whole-event failure: skip silently, keep the scan moving.
    }
  }
  return out;
}
