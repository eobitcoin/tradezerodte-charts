/**
 * BotWick Analysis — daily 6AM Finora-style SMC scan over the fixed universe.
 *
 * Per ticker: pull hourly (entries/indicators) + daily (trend/levels) bars
 * via the paged Polygon fetcher, cross-check against the live snapshot price
 * (anti-stale gate), run the Finora engine (lib/finora-engine — verified
 * bar-for-bar against the Python reference), then render the deterministic
 * Finora narrative sections + a defined-risk options idea.
 *
 * Per-ticker failures are recorded (`ok:false` + error), never fatal to the
 * scan — one bad symbol must not sink the other 20 reports.
 */

import {
  fetchOhlcBarsPaged,
  fetchTickerSnapshotPrice,
  type PolygonOhlcBar,
} from "@/lib/polygon";
import {
  indicatorVerdicts,
  levelsBlock,
  trendBlock,
  priceActionBlock,
  netBias,
  type FinoraBar,
  type FinoraIndicators,
  type FinoraLevels,
  type FinoraTrend,
} from "@/lib/finora-engine";
import type {
  BotwickTickerReport,
  BotwickSections,
  BotwickOptionsIdea,
} from "@/lib/db/schema";

/** The fixed BotWick universe, in display order. */
export const BOTWICK_TICKERS = [
  "AAPL", "AMD", "AMZN", "AVGO", "BABA", "GOOG", "GOOGL", "HOOD", "INTC",
  "META", "MSFT", "MU", "SNDK", "NFLX", "NVDA", "ORCL", "PLTR", "TSLA",
  "SPCX", "SPY", "QQQ",
] as const;

const SCAN_CONCURRENCY = 6;
const HTF_DAYS = 500; // daily bars lookback
const LTF_DAYS = 90; // hourly bars lookback

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function toFinora(bars: PolygonOhlcBar[]): FinoraBar[] {
  return bars.map((b) => ({ date: b.date, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => x.toFixed(2);

/** Liquid-ish strike increment by price magnitude. */
function strikeInc(price: number): number {
  if (price >= 500) return 25;
  if (price >= 250) return 10;
  if (price >= 100) return 5;
  if (price >= 50) return 2.5;
  return 1;
}

/** The Friday closest to ~35 DTE (within 28–49). */
function targetExpiry(now: Date): { expiration: string; dteDays: number } {
  let best: { expiration: string; dteDays: number } | null = null;
  for (let d = 28; d <= 49; d++) {
    const dt = new Date(now.getTime() + d * 86400000);
    if (dt.getUTCDay() !== 5) continue; // Friday
    if (!best || Math.abs(d - 35) < Math.abs(best.dteDays - 35)) {
      best = { expiration: dt.toISOString().slice(0, 10), dteDays: d };
    }
  }
  // There is always a Friday in a 21-day window; fallback keeps types honest.
  return best ?? { expiration: new Date(now.getTime() + 35 * 86400000).toISOString().slice(0, 10), dteDays: 35 };
}

// ---------------------------------------------------------------------------
// Deterministic Finora narration
// ---------------------------------------------------------------------------

function buildSections(opts: {
  symbol: string;
  price: number;
  bias: "bullish" | "bearish" | "neutral";
  trend: FinoraTrend;
  pa: { today: string; week: string };
  inds: FinoraIndicators;
  bulls: string[];
  bears: string[];
  lv: FinoraLevels;
  ltf: string;
  htf: string;
}): BotwickSections {
  const { symbol, price, bias, trend, pa, inds, bulls, bears, lv } = opts;
  const aboveEq = price >= lv.equilibrium;
  const zone = aboveEq ? "premium" : "discount";

  const general: string[] = [
    `Current price for ${symbol} is ${fmt(price)}, sitting ${aboveEq ? "above" : "below"} the equilibrium of the most recent swing (${fmt(lv.equilibrium)}) — in the ${zone} half of the ${fmt(lv.swingLow)}–${fmt(lv.swingHigh)} range.`,
    `The overall trend is ${trend.trend} on the ${opts.htf} timeframe (${trend.structure}; EMA20 ${fmt(trend.ema20)} vs EMA50 ${fmt(trend.ema50)}).`,
    bulls.length && bears.length
      ? `Indicators are mixed on the ${opts.ltf}: ${bulls.join(", ")} lean bullish while ${bears.join(", ")} lean bearish. ${inds.ADX.detail}.`
      : `Indicators are one-sided on the ${opts.ltf}: ${(bulls.length ? bulls : bears).join(", ")} all point ${bulls.length ? "bullish" : "bearish"}. ${inds.ADX.detail}.`,
    `Price action is ${pa.today} today and ${pa.week} this week.`,
  ];

  const nearestSupply = lv.imbalances.find((z) => z.type === "supply");
  const nearestDemand = lv.imbalances.find((z) => z.type === "demand");
  const cl = lv.clusters[0];

  const levels: string[] = [
    `Most recent swing high ${fmt(lv.swingHigh)}, swing low ${fmt(lv.swingLow)} — the key liquidity zones where sweeps/manipulations are likely.`,
    `Closest resistance above: ${lv.resistance.map(fmt).join(", ") || "—"}`,
    `Closest support below: ${lv.support.map(fmt).join(", ") || "—"}`,
  ];
  if (cl) levels.push(`Strongest nearby cluster: ${fmt(cl.low)}–${fmt(cl.high)} (${cl.touches} touches).`);
  if (nearestSupply)
    levels.push(`Supply imbalance overhead at ${fmt(nearestSupply.low)}–${fmt(nearestSupply.high)} — a zone where rallies can stall and reverse.`);
  if (nearestDemand)
    levels.push(`Demand imbalance below at ${fmt(nearestDemand.low)}–${fmt(nearestDemand.high)} — a zone where dips can find a bid.`);

  const res0 = lv.resistance[0];
  const sup0 = lv.support[0];
  const shortZoneLo = nearestSupply ? nearestSupply.low : res0;
  const shortZoneHi = nearestSupply ? nearestSupply.high : lv.resistance[1] ?? res0;
  const longZoneLo = nearestDemand ? nearestDemand.low : lv.support[1] ?? sup0;
  const longZoneHi = nearestDemand ? nearestDemand.high : sup0;

  const shortTargets = lv.support.slice(0, 3);
  const longTargets = lv.resistance.slice(0, 3);

  const ideas: string[] = [];
  if (bias === "bearish") {
    ideas.push(
      `With the ${opts.htf} trend bearish and price in the ${zone} zone, the primary setup is a short on rejection of the ${fmt(shortZoneLo)}–${fmt(shortZoneHi)} supply area.`,
      `First targets for shorts: ${shortTargets.map(fmt).join(" → ")}.`,
      `For a long, wait for a sweep of ${fmt(lv.swingLow)} (or the ${fmt(longZoneLo)}–${fmt(longZoneHi)} demand) with strong bullish reversal confirmation, then target ${longTargets.map(fmt).join(" → ")}.`,
    );
  } else if (bias === "bullish") {
    ideas.push(
      `With the ${opts.htf} trend bullish, the primary setup is a long on a dip into the ${fmt(longZoneLo)}–${fmt(longZoneHi)} demand area holding as support.`,
      `First targets for longs: ${longTargets.map(fmt).join(" → ")}.`,
      `For a short, wait for a sweep of ${fmt(lv.swingHigh)} (or a hard rejection of ${fmt(shortZoneLo)}–${fmt(shortZoneHi)}) with bearish confirmation, then target ${shortTargets.map(fmt).join(" → ")}.`,
    );
  } else {
    ideas.push(
      `Bias is neutral — let the decision zones pick the trade: short a confirmed rejection of ${fmt(shortZoneLo)}–${fmt(shortZoneHi)}, or long a confirmed bounce from ${fmt(longZoneLo)}–${fmt(longZoneHi)}.`,
      `Short targets: ${shortTargets.map(fmt).join(" → ")} · Long targets: ${longTargets.map(fmt).join(" → ")}.`,
    );
  }
  ideas.push(`Stops: just above the swing high (${fmt(lv.swingHigh)}) for shorts, just below the swing low (${fmt(lv.swingLow)}) for longs.`);

  const shortScenario: string[] = [
    `If price rallies into ${fmt(shortZoneLo)}–${fmt(shortZoneHi)}, watch for a lower-timeframe rejection (bearish engulfing, pin bar, or a lower-TF breakdown). Enter short after confirmation.`,
    `Take profit at ${fmt(shortTargets[0] ?? lv.equilibrium)} first${shortTargets[1] ? `, then scale at ${fmt(shortTargets[1])}` : ""}${shortTargets[2] ? ` and ${fmt(shortTargets[2])}` : ""}.`,
    `Stop-loss just above ${fmt(Math.max(shortZoneHi, lv.swingHigh === shortZoneHi ? shortZoneHi : shortZoneHi))} — or above the swing high ${fmt(lv.swingHigh)} for the conservative version.`,
  ];

  const longScenario: string[] = [
    `If price drops into ${fmt(longZoneLo)}–${fmt(longZoneHi)}, wait for a strong bullish pin bar, sharp rejection wick, or bullish divergence on lower timeframes.`,
    `Enter long on confirmation, aiming for ${fmt(longTargets[0] ?? lv.equilibrium)}${longTargets[1] ? ` and ${fmt(longTargets[1])}` : ""}.`,
    `Stop-loss just below ${fmt(longZoneLo)}, or below the swing low ${fmt(lv.swingLow)} if positioning for a deeper liquidity grab.`,
  ];

  const expectation: string[] = [];
  if (bias === "bearish") {
    expectation.push(
      `If price can't reclaim ${fmt(shortZoneLo)}–${fmt(shortZoneHi)} and confirms rejection, expect a move down toward ${shortTargets.map(fmt).join(", then ")}.`,
      `A clean break and hold above ${fmt(lv.resistance[1] ?? shortZoneHi)} flips the bias bullish, targeting ${fmt(lv.swingHigh)}.`,
    );
  } else if (bias === "bullish") {
    expectation.push(
      `As long as ${fmt(longZoneLo)}–${fmt(longZoneHi)} holds as support, expect continuation toward ${longTargets.map(fmt).join(", then ")}.`,
      `A decisive loss of ${fmt(lv.support[1] ?? longZoneLo)} flips the bias bearish, opening ${fmt(lv.swingLow)}.`,
    );
  } else {
    expectation.push(
      `Range conditions — expect rotation between ${fmt(sup0 ?? lv.swingLow)} and ${fmt(res0 ?? lv.swingHigh)} until one side breaks with conviction; trade the edges, not the middle.`,
    );
  }

  return { general, levels, ideas, shortScenario, longScenario, expectation };
}

function buildOptionsIdea(
  bias: "bullish" | "bearish" | "neutral",
  price: number,
  lv: FinoraLevels,
  now: Date,
): BotwickOptionsIdea | null {
  if (bias === "neutral") return null; // no directional expression to make
  const inc = strikeInc(price);
  const { expiration, dteDays } = targetExpiry(now);
  const snap = (x: number) => Math.round(x / inc) * inc;

  if (bias === "bearish") {
    const longStrike = snap(price);
    const target = lv.support[1] ?? lv.support[0] ?? price * 0.95;
    let shortStrike = snap(target);
    if (shortStrike >= longStrike) shortStrike = longStrike - inc;
    return {
      strategy: "put_debit_spread",
      direction: "short",
      expiration,
      dteDays,
      longStrike: r2(longStrike),
      shortStrike: r2(shortStrike),
      note: `Bearish expression of the supply-rejection read — defined risk, targets the ${fmt(target)} support.`,
    };
  }
  const longStrike = snap(price);
  const target = lv.resistance[1] ?? lv.resistance[0] ?? price * 1.05;
  let shortStrike = snap(target);
  if (shortStrike <= longStrike) shortStrike = longStrike + inc;
  return {
    strategy: "call_debit_spread",
    direction: "long",
    expiration,
    dteDays,
    longStrike: r2(longStrike),
    shortStrike: r2(shortStrike),
    note: `Bullish expression of the demand-hold read — defined risk, targets the ${fmt(target)} resistance.`,
  };
}

// ---------------------------------------------------------------------------
// Per-ticker analysis
// ---------------------------------------------------------------------------

const LTF_LABEL = "1h";
const HTF_LABEL = "daily";

export async function analyzeBotwickTicker(symbol: string): Promise<BotwickTickerReport> {
  const failed = (error: string): BotwickTickerReport => ({
    symbol,
    ok: false,
    error,
    price: 0,
    bias: "neutral",
    asOf: { lastTradePrice: null, lastLtfBar: "", lastHtfBar: "" },
    warnings: [],
    trend: { trend: "neutral", structure: "neutral", ema20: 0, ema50: 0 },
    priceAction: { today: "neutral", week: "neutral", todayChg: 0, weekChg: 0 },
    indicators: { ADX: { verdict: "weak", value: 0, detail: "" } } as BotwickTickerReport["indicators"],
    tally: { bullish: [], bearish: [] },
    levels: { swingHigh: 0, swingLow: 0, equilibrium: 0, resistance: [], support: [], clusters: [], imbalances: [] },
    sections: { general: [], levels: [], ideas: [], shortScenario: [], longScenario: [], expectation: [] },
    optionsIdea: null,
  });

  try {
    const today = new Date().toISOString().slice(0, 10);
    const [hourRaw, dayRaw, snap] = await Promise.all([
      fetchOhlcBarsPaged(symbol, 1, "hour", isoDaysAgo(LTF_DAYS), today),
      fetchOhlcBarsPaged(symbol, 1, "day", isoDaysAgo(HTF_DAYS), today),
      fetchTickerSnapshotPrice(symbol).catch(() => ({ price: null, prevClose: null })),
    ]);
    if (hourRaw.length < 60 || dayRaw.length < 60) {
      return failed(`insufficient bars (hour=${hourRaw.length}, day=${dayRaw.length})`);
    }
    const hbars = toFinora(dayRaw);
    const lbars = toFinora(hourRaw);

    // ---- Anti-stale gates (mirrors the Python engine) ----
    const barPrice = lbars[lbars.length - 1].c;
    const price = r2(snap.price ?? barPrice);
    if (snap.price && Math.abs(barPrice - snap.price) / snap.price > 0.015) {
      return failed(
        `stale bars: last 1h close ${fmt(barPrice)} vs live ${fmt(snap.price)} (>1.5%)`,
      );
    }
    const warnings: string[] = [];
    const now = Date.now();
    for (const [name, bars] of [["1h", lbars], ["daily", hbars]] as const) {
      const ageDays = (now - new Date(bars[bars.length - 1].date).getTime()) / 86400000;
      if (ageDays > 7) return failed(`${name} bars end ${ageDays.toFixed(1)} days ago — stale feed`);
      if (ageDays > 3) warnings.push(`${name} bars end ${ageDays.toFixed(1)} days ago (holiday/weekend gap?)`);
    }

    const inds = indicatorVerdicts(lbars);
    const lv = levelsBlock(hbars, price);
    const trend = trendBlock(hbars);
    const pa = priceActionBlock(hbars);
    const bias = netBias(trend, inds);

    const indKeys = ["MACD", "Vortex", "PSAR", "DMI", "Stochastic", "Momentum", "RSI", "MFI", "Fisher"] as const;
    const bulls = indKeys.filter((k) => inds[k].verdict === "bullish") as unknown as string[];
    const bears = indKeys.filter((k) => inds[k].verdict === "bearish") as unknown as string[];

    const sections = buildSections({
      symbol,
      price,
      bias,
      trend,
      pa: { today: pa.today, week: pa.week },
      inds,
      bulls,
      bears,
      lv,
      ltf: LTF_LABEL,
      htf: HTF_LABEL,
    });
    const optionsIdea = buildOptionsIdea(bias, price, lv, new Date());

    return {
      symbol,
      ok: true,
      price,
      bias,
      asOf: {
        lastTradePrice: snap.price,
        lastLtfBar: lbars[lbars.length - 1].date,
        lastHtfBar: hbars[hbars.length - 1].date,
      },
      warnings,
      trend,
      priceAction: pa,
      indicators: inds as unknown as BotwickTickerReport["indicators"],
      tally: { bullish: bulls, bearish: bears },
      levels: {
        swingHigh: lv.swingHigh,
        swingLow: lv.swingLow,
        equilibrium: lv.equilibrium,
        resistance: lv.resistance,
        support: lv.support,
        clusters: lv.clusters,
        imbalances: lv.imbalances,
      },
      sections,
      optionsIdea,
    };
  } catch (err) {
    return failed(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Full-universe scan
// ---------------------------------------------------------------------------

export interface BotwickScanResult {
  reports: BotwickTickerReport[];
  okCount: number;
  timing: { totalSec: number };
}

export async function runBotwickScan(): Promise<BotwickScanResult> {
  const start = Date.now();
  const tickers = [...BOTWICK_TICKERS];
  const out: BotwickTickerReport[] = new Array(tickers.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(SCAN_CONCURRENCY, tickers.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= tickers.length) return;
      out[i] = await analyzeBotwickTicker(tickers[i]);
    }
  });
  await Promise.all(workers);
  return {
    reports: out,
    okCount: out.filter((r) => r.ok).length,
    timing: { totalSec: (Date.now() - start) / 1000 },
  };
}
