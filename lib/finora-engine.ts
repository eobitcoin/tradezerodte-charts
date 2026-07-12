/**
 * Finora / BotWick Analysis — core engine (TypeScript port).
 *
 * Ported 1:1 from the Python reference (.claude/skills/finora-ai/scripts/
 * finora_analyze.py) and verified against it with golden vectors
 * (scripts/verify-finora-engine.mjs). Data-source-agnostic: feed it OHLCV
 * bars, get the indicator scorecard + Smart-Money levels + trend read.
 *
 * All rolling primitives match pandas semantics exactly:
 *   ema  = ewm(span=n, adjust=False)
 *   rma  = ewm(alpha=1/n, adjust=False)   (Wilder)
 *   rolling(n) => NaN until the window fills (min_periods = n)
 */

export interface FinoraBar {
  date: string; // ISO date or datetime
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Verdict = "bullish" | "bearish";

export interface IndicatorRead {
  verdict: Verdict;
  detail: string;
}

export interface AdxRead {
  verdict: "strong" | "moderate" | "weak";
  value: number;
  detail: string;
}

export interface FinoraIndicators {
  MACD: IndicatorRead;
  Vortex: IndicatorRead;
  PSAR: IndicatorRead;
  DMI: IndicatorRead;
  Stochastic: IndicatorRead;
  Momentum: IndicatorRead;
  RSI: IndicatorRead;
  MFI: IndicatorRead;
  Fisher: IndicatorRead;
  ADX: AdxRead;
}

export interface FinoraLevels {
  swingHigh: number;
  swingLow: number;
  equilibrium: number;
  resistance: number[];
  support: number[];
  clusters: Array<{ low: number; high: number; touches: number }>;
  imbalances: Array<{ type: "supply" | "demand"; low: number; high: number }>;
}

export interface FinoraTrend {
  trend: "bullish" | "bearish" | "neutral";
  structure: string;
  ema20: number;
  ema50: number;
}

export interface FinoraPriceAction {
  today: "bullish" | "bearish" | "neutral";
  week: "bullish" | "bearish" | "neutral";
  todayChg: number;
  weekChg: number;
}

// ---------------------------------------------------------------------------
// Series primitives (pandas-exact)
// ---------------------------------------------------------------------------

function emaArr(x: number[], n: number): number[] {
  const alpha = 2 / (n + 1);
  const out = new Array<number>(x.length);
  let prev = NaN;
  for (let i = 0; i < x.length; i++) {
    prev = Number.isNaN(prev) ? x[i] : alpha * x[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function rmaArr(x: number[], n: number): number[] {
  // Wilder: ewm(alpha=1/n, adjust=False). NaNs propagate-skip like pandas
  // (pandas ignores leading NaNs and seeds on the first valid value).
  const alpha = 1 / n;
  const out = new Array<number>(x.length).fill(NaN);
  let prev = NaN;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (Number.isNaN(v)) {
      out[i] = prev;
      continue;
    }
    prev = Number.isNaN(prev) ? v : alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function rollMin(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  for (let i = n - 1; i < x.length; i++) {
    let m = Infinity;
    for (let j = i - n + 1; j <= i; j++) m = Math.min(m, x[j]);
    out[i] = m;
  }
  return out;
}

function rollMax(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  for (let i = n - 1; i < x.length; i++) {
    let m = -Infinity;
    for (let j = i - n + 1; j <= i; j++) m = Math.max(m, x[j]);
    out[i] = m;
  }
  return out;
}

function rollSum(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  for (let i = n - 1; i < x.length; i++) {
    let s = 0;
    let bad = false;
    for (let j = i - n + 1; j <= i; j++) {
      if (Number.isNaN(x[j])) {
        bad = true;
        break;
      }
      s += x[j];
    }
    out[i] = bad ? NaN : s;
  }
  return out;
}

function rollMean(x: number[], n: number): number[] {
  const s = rollSum(x, n);
  return s.map((v) => (Number.isNaN(v) ? NaN : v / n));
}

function trueRangeArr(bars: FinoraBar[]): number[] {
  // pandas concat([h-l, |h-pc|, |l-pc|]).max(axis=1): bar 0 has NaN pc, so
  // max skips it and returns h-l.
  const out = new Array<number>(bars.length);
  for (let i = 0; i < bars.length; i++) {
    const hl = bars[i].h - bars[i].l;
    if (i === 0) {
      out[i] = hl;
    } else {
      const pc = bars[i - 1].c;
      out[i] = Math.max(hl, Math.abs(bars[i].h - pc), Math.abs(bars[i].l - pc));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------------

function rsiArr(close: number[], n = 14): number[] {
  const up = new Array<number>(close.length).fill(NaN);
  const dn = new Array<number>(close.length).fill(NaN);
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    up[i] = Math.max(d, 0);
    dn[i] = Math.max(-d, 0);
  }
  const au = rmaArr(up, n);
  const ad = rmaArr(dn, n);
  return close.map((_, i) => {
    if (Number.isNaN(au[i]) || Number.isNaN(ad[i])) return 50;
    if (ad[i] === 0) return 50; // python: rs -> NaN -> fillna(50)
    const rs = au[i] / ad[i];
    return 100 - 100 / (1 + rs);
  });
}

function stochasticArr(bars: FinoraBar[], k = 14, d = 3) {
  const ll = rollMin(bars.map((b) => b.l), k);
  const hh = rollMax(bars.map((b) => b.h), k);
  const kfast = bars.map((b, i) => {
    const denom = hh[i] - ll[i];
    if (Number.isNaN(denom) || denom === 0) return NaN;
    return (100 * (b.c - ll[i])) / denom;
  });
  const kslow = rollMean(kfast, d);
  const dslow = rollMean(kslow, d);
  return { k: kslow, d: dslow };
}

function adxDmiArr(bars: FinoraBar[], n = 14) {
  const len = bars.length;
  const plusDm = new Array<number>(len).fill(NaN);
  const minusDm = new Array<number>(len).fill(NaN);
  plusDm[0] = 0;
  minusDm[0] = 0;
  for (let i = 1; i < len; i++) {
    const up = bars[i].h - bars[i - 1].h;
    const dn = bars[i - 1].l - bars[i].l;
    plusDm[i] = up > dn && up > 0 ? up : 0;
    minusDm[i] = dn > up && dn > 0 ? dn : 0;
  }
  // python: np.where on diff() gives NaN>x = False -> 0.0 at i=0. Match: 0.
  const tr = rmaArr(trueRangeArr(bars), n);
  const pdi = rmaArr(plusDm, n).map((v, i) => (tr[i] === 0 || Number.isNaN(tr[i]) ? NaN : (100 * v) / tr[i]));
  const mdi = rmaArr(minusDm, n).map((v, i) => (tr[i] === 0 || Number.isNaN(tr[i]) ? NaN : (100 * v) / tr[i]));
  const dx = pdi.map((p, i) => {
    const m = mdi[i];
    const denom = p + m;
    if (Number.isNaN(p) || Number.isNaN(m) || denom === 0) return NaN;
    return (100 * Math.abs(p - m)) / denom;
  });
  return { adx: rmaArr(dx, n), pdi, mdi };
}

function vortexArr(bars: FinoraBar[], n = 14) {
  const len = bars.length;
  const tr = trueRangeArr(bars);
  const vip = new Array<number>(len).fill(NaN);
  const vim = new Array<number>(len).fill(NaN);
  for (let i = 1; i < len; i++) {
    vip[i] = Math.abs(bars[i].h - bars[i - 1].l);
    vim[i] = Math.abs(bars[i].l - bars[i - 1].h);
  }
  const sumTr = rollSum(tr, n);
  const sumVip = rollSum(vip, n);
  const sumVim = rollSum(vim, n);
  return {
    vip: sumVip.map((v, i) => v / sumTr[i]),
    vim: sumVim.map((v, i) => v / sumTr[i]),
  };
}

function psarArr(bars: FinoraBar[], af0 = 0.02, afStep = 0.02, afMax = 0.2): number[] {
  const high = bars.map((b) => b.h);
  const low = bars.map((b) => b.l);
  const n = bars.length;
  const sar = new Array<number>(n).fill(NaN);
  let bull = true;
  let af = af0;
  let ep = high[0];
  sar[0] = low[0];
  for (let i = 1; i < n; i++) {
    const prev = sar[i - 1];
    sar[i] = prev + af * (ep - prev);
    if (bull) {
      sar[i] = Math.min(sar[i], low[i - 1], low[Math.max(i - 2, 0)]);
      if (low[i] < sar[i]) {
        bull = false;
        sar[i] = ep;
        ep = low[i];
        af = af0;
      } else if (high[i] > ep) {
        ep = high[i];
        af = Math.min(af + afStep, afMax);
      }
    } else {
      sar[i] = Math.max(sar[i], high[i - 1], high[Math.max(i - 2, 0)]);
      if (high[i] > sar[i]) {
        bull = true;
        sar[i] = ep;
        ep = high[i];
        af = af0;
      } else if (low[i] < ep) {
        ep = low[i];
        af = Math.min(af + afStep, afMax);
      }
    }
  }
  return sar;
}

function mfiArr(bars: FinoraBar[], n = 14): number[] {
  const len = bars.length;
  const tp = bars.map((b) => (b.h + b.l + b.c) / 3);
  const pos = new Array<number>(len).fill(NaN);
  const neg = new Array<number>(len).fill(NaN);
  // python: tp > tp.shift(1) is False at i=0 -> rmf.where(cond, 0) -> 0.
  pos[0] = 0;
  neg[0] = 0;
  for (let i = 1; i < len; i++) {
    const rmf = tp[i] * bars[i].v;
    pos[i] = tp[i] > tp[i - 1] ? rmf : 0;
    neg[i] = tp[i] < tp[i - 1] ? rmf : 0;
  }
  const ps = rollSum(pos, n);
  const ns = rollSum(neg, n);
  return tp.map((_, i) => {
    if (Number.isNaN(ps[i]) || Number.isNaN(ns[i]) || ns[i] === 0) return NaN;
    return 100 - 100 / (1 + ps[i] / ns[i]);
  });
}

function fisherArr(bars: FinoraBar[], n = 9) {
  const med = bars.map((b) => (b.h + b.l) / 2);
  const ll = rollMin(med, n);
  const hh = rollMax(med, n);
  const len = bars.length;
  const v = new Array<number>(len).fill(0);
  const fish = new Array<number>(len).fill(0);
  const raw = med.map((m, i) => {
    const denom = hh[i] - ll[i];
    if (Number.isNaN(denom) || denom === 0) return 0; // python fillna(0)
    return 2 * ((m - ll[i]) / denom - 0.5);
  });
  for (let i = 1; i < len; i++) {
    let vi = 0.66 * raw[i] + 0.67 * v[i - 1];
    vi = Math.min(Math.max(vi, -0.999), 0.999);
    v[i] = vi;
    fish[i] = 0.5 * Math.log((1 + vi) / (1 - vi)) + 0.5 * fish[i - 1];
  }
  return { fisher: fish, prior: [NaN, ...fish.slice(0, -1)] };
}

// ---------------------------------------------------------------------------
// Public: indicator verdicts (entry timeframe)
// ---------------------------------------------------------------------------

const f2 = (x: number) => x.toFixed(2);
const f1 = (x: number) => x.toFixed(1);

export function indicatorVerdicts(bars: FinoraBar[]): FinoraIndicators {
  const close = bars.map((b) => b.c);
  const last = bars.length - 1;

  const e12 = emaArr(close, 12);
  const e26 = emaArr(close, 26);
  const line = e12.map((v, i) => v - e26[i]);
  const signal = emaArr(line, 9);
  const macdRead: IndicatorRead = {
    verdict: line[last] > signal[last] ? "bullish" : "bearish",
    detail: `line ${f2(line[last])} vs signal ${f2(signal[last])}`,
  };

  const { vip, vim } = vortexArr(bars);
  const { adx, pdi, mdi } = adxDmiArr(bars);
  const ps = psarArr(bars);
  const { k, d } = stochasticArr(bars);
  const mom = close.map((c, i) => (i >= 10 ? c - close[i - 10] : NaN));
  const rs = rsiArr(close);
  const mf = mfiArr(bars);
  const { fisher, prior } = fisherArr(bars);

  const adxV = adx[last];
  return {
    MACD: macdRead,
    Vortex: {
      verdict: vip[last] > vim[last] ? "bullish" : "bearish",
      detail: `VI+ ${f2(vip[last])} / VI- ${f2(vim[last])}`,
    },
    PSAR: {
      verdict: close[last] > ps[last] ? "bullish" : "bearish",
      detail: `price ${f2(close[last])} vs SAR ${f2(ps[last])}`,
    },
    DMI: {
      verdict: pdi[last] > mdi[last] ? "bullish" : "bearish",
      detail: `+DI ${f1(pdi[last])} / -DI ${f1(mdi[last])}`,
    },
    Stochastic: {
      verdict: k[last] > d[last] ? "bullish" : "bearish",
      detail: `%K ${f1(k[last])} vs %D ${f1(d[last])}`,
    },
    Momentum: {
      verdict: mom[last] > 0 ? "bullish" : "bearish",
      detail: `${mom[last] >= 0 ? "+" : ""}${f2(mom[last])} over 10 bars`,
    },
    RSI: { verdict: rs[last] >= 50 ? "bullish" : "bearish", detail: f1(rs[last]) },
    MFI: { verdict: mf[last] >= 50 ? "bullish" : "bearish", detail: f1(mf[last]) },
    Fisher: {
      verdict: fisher[last] > prior[last] ? "bullish" : "bearish",
      detail: `${f2(fisher[last])} vs prior ${f2(prior[last])}`,
    },
    ADX: {
      verdict: adxV >= 25 ? "strong" : adxV < 20 ? "weak" : "moderate",
      value: Math.round(adxV * 10) / 10,
      detail: `ADX ${f1(adxV)} — ${adxV >= 25 ? "trending" : adxV < 20 ? "range-bound / choppy" : "developing"}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Smart-Money levels (higher timeframe)
// ---------------------------------------------------------------------------

function pivots(bars: FinoraBar[], left = 3, right = 3) {
  const highs: Array<[number, number]> = [];
  const lows: Array<[number, number]> = [];
  const h = bars.map((b) => b.h);
  const l = bars.map((b) => b.l);
  for (let i = left; i < bars.length - right; i++) {
    const winH = h.slice(i - left, i + right + 1);
    const winL = l.slice(i - left, i + right + 1);
    const maxH = Math.max(...winH);
    const minL = Math.min(...winL);
    if (h[i] === maxH && winH.some((x) => h[i] > x)) highs.push([i, h[i]]);
    if (l[i] === minL && winL.some((x) => l[i] < x)) lows.push([i, l[i]]);
  }
  return { highs, lows };
}

function roundLevels(price: number, span = 0.12): Set<number> {
  const out = new Set<number>();
  const lo = price * (1 - span);
  const hi = price * (1 + span);
  for (const step of [5, 10, 25]) {
    let x = Math.floor(lo / step) * step;
    while (x <= hi) {
      if (x >= lo && x <= hi) out.add(Math.round(x * 100) / 100);
      x += step;
    }
  }
  return out;
}

function dedup(levels: number[], tol = 0.004): number[] {
  const sorted = [...levels].sort((a, b) => a - b);
  const kept: number[] = [];
  for (const lv of sorted) {
    if (kept.length === 0 || Math.abs(lv - kept[kept.length - 1]) / Math.max(lv, 1) > tol) {
      kept.push(Math.round(lv * 100) / 100);
    }
  }
  return kept;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function levelsBlock(hbars: FinoraBar[], price: number): FinoraLevels {
  const { highs, lows } = pivots(hbars);
  const tail40High = Math.max(...hbars.slice(-40).map((b) => b.h));
  const tail40Low = Math.min(...hbars.slice(-40).map((b) => b.l));
  const swingHigh = highs.length ? highs[highs.length - 1][1] : tail40High;
  const swingLow = lows.length ? lows[lows.length - 1][1] : tail40Low;
  const equilibrium = r2((swingHigh + swingLow) / 2);

  const pivPrices = [...highs.map(([, p]) => p), ...lows.map(([, p]) => p)];
  const candidates = new Set<number>([...pivPrices.map(r2), ...roundLevels(price)]);

  const resistance = dedup([...candidates].filter((lv) => lv > price * 1.0008)).slice(0, 6);
  const support = dedup([...candidates].filter((lv) => lv < price * 0.9992))
    .sort((a, b) => b - a)
    .slice(0, 6);

  // Clusters: >=2 pivots within ~1.2%, near price, sorted by distance.
  const pivSorted = pivPrices.filter((p) => Math.abs(p - price) / price <= 0.15).sort((a, b) => a - b);
  const clusters: Array<{ low: number; high: number; touches: number }> = [];
  let i = 0;
  while (i < pivSorted.length) {
    const grp = [pivSorted[i]];
    let j = i + 1;
    while (j < pivSorted.length && (pivSorted[j] - grp[0]) / Math.max(grp[0], 1) <= 0.012) {
      grp.push(pivSorted[j]);
      j++;
    }
    if (grp.length >= 2) {
      clusters.push({ low: r2(Math.min(...grp)), high: r2(Math.max(...grp)), touches: grp.length });
    }
    i = j;
  }
  clusters.sort((a, b) => Math.abs((a.low + a.high) / 2 - price) - Math.abs((b.low + b.high) / 2 - price));

  // Fair value gaps (3-bar), near price, sane width, actionable side.
  const fvgs: Array<{ type: "supply" | "demand"; low: number; high: number }> = [];
  const h = hbars.map((b) => b.h);
  const l = hbars.map((b) => b.l);
  for (let idx = 2; idx < hbars.length; idx++) {
    let kind: "supply" | "demand";
    let zlo: number;
    let zhi: number;
    if (l[idx] > h[idx - 2]) {
      kind = "demand";
      zlo = r2(h[idx - 2]);
      zhi = r2(l[idx]);
    } else if (h[idx] < l[idx - 2]) {
      kind = "supply";
      zlo = r2(h[idx]);
      zhi = r2(l[idx - 2]);
    } else {
      continue;
    }
    const mid = (zlo + zhi) / 2;
    const width = (zhi - zlo) / price;
    if (!(Math.abs(mid - price) / price <= 0.06 && width >= 0.001 && width <= 0.035)) continue;
    if (kind === "supply" && mid < price * 0.997) continue;
    if (kind === "demand" && mid > price * 1.003) continue;
    fvgs.push({ type: kind, low: zlo, high: zhi });
  }
  fvgs.sort((a, b) => Math.abs((a.low + a.high) / 2 - price) - Math.abs((b.low + b.high) / 2 - price));
  const seen = new Set<number>();
  const imbalances: typeof fvgs = [];
  for (const f of fvgs) {
    const key = Math.round((f.low + f.high) / 2);
    if (seen.has(key)) continue;
    seen.add(key);
    imbalances.push(f);
    if (imbalances.length >= 4) break;
  }

  return {
    swingHigh: r2(swingHigh),
    swingLow: r2(swingLow),
    equilibrium,
    resistance,
    support,
    clusters: clusters.slice(0, 4),
    imbalances,
  };
}

export function trendBlock(hbars: FinoraBar[]): FinoraTrend {
  const close = hbars.map((b) => b.c);
  const e20 = emaArr(close, 20);
  const e50 = emaArr(close, 50);
  const { highs, lows } = pivots(hbars);
  let structure = "neutral";
  if (highs.length >= 2 && lows.length >= 2) {
    const hh = highs[highs.length - 1][1] > highs[highs.length - 2][1];
    const hl = lows[lows.length - 1][1] > lows[lows.length - 2][1];
    if (hh && hl) structure = "uptrend (HH/HL)";
    else if (!hh && !hl) structure = "downtrend (LH/LL)";
  }
  const last = close.length - 1;
  // pandas .iloc[-5] is the 5th element from the end == index (last - 4).
  const emaBull = e20[last] > e50[last] && e20[last] > e20[last - 4];
  const emaBear = e20[last] < e50[last] && e20[last] < e20[last - 4];
  return {
    trend: emaBull ? "bullish" : emaBear ? "bearish" : "neutral",
    structure,
    ema20: r2(e20[last]),
    ema50: r2(e50[last]),
  };
}

export function priceActionBlock(dbars: FinoraBar[]): FinoraPriceAction {
  const a = rmaArr(trueRangeArr(dbars), 14);
  const atrLast = a[a.length - 1];
  const last = dbars[dbars.length - 1];
  const today = last.c - last.o;
  const week = dbars.length > 6 ? dbars[dbars.length - 1].c - dbars[dbars.length - 6].c : today;
  const label = (x: number): "bullish" | "bearish" | "neutral" =>
    Math.abs(x) < 0.25 * atrLast ? "neutral" : x > 0 ? "bullish" : "bearish";
  return { today: label(today), week: label(week), todayChg: r2(today), weekChg: r2(week) };
}

/** Net directional bias: HTF trend anchors; LTF indicator tally breaks ties. */
export function netBias(trend: FinoraTrend, inds: FinoraIndicators): "bullish" | "bearish" | "neutral" {
  const keys: Array<keyof Omit<FinoraIndicators, "ADX">> = [
    "MACD", "Vortex", "PSAR", "DMI", "Stochastic", "Momentum", "RSI", "MFI", "Fisher",
  ];
  const bulls = keys.filter((k) => inds[k].verdict === "bullish").length;
  const bears = keys.filter((k) => inds[k].verdict === "bearish").length;
  if (trend.trend !== "neutral") return trend.trend;
  if (bulls > bears) return "bullish";
  if (bears > bulls) return "bearish";
  return "neutral";
}
