/**
 * ST Squeeze Ultra — core squeeze engine (TypeScript port).
 *
 * Ported 1:1 from the Python `squeeze_engine.py`, which is itself a verbatim
 * port of the Simpler Trading `ST_SqueezeUltra` ThinkScript. Data-source
 * agnostic: feed it ascending OHLC bars, get squeeze state + momentum + ideal
 * flag for every bar. Verified bar-for-bar against the Python engine's output
 * via scripts/verify-squeeze-engine.mjs (golden vectors).
 *
 * Source mapping (TOS -> here):
 *   Length          : 21 for Daily & Weekly (aP >= DAY)
 *   nBB             : 2.0
 *   Keltner mults   : {1.0, 1.5, 2.0} -> states {3:tight, 2:mid, 1:wide}
 *   Bollinger basis : EMA(close, L) +/- nBB*stdev   (EMA basis, by design)
 *   Keltner  basis  : SMA(close, L) +/- EMA(TR, L)*mult   (SMA basis, by design)
 *   state           : 3 if BB inside 1.0x KC, 2 if inside 1.5x, 1 if inside 2.0x, else 0
 *   momentum        : Inertia(close - ((HH+LL)/2 + SMA(close,L))/2, L)  [linreg endpoint]
 *   ideal           : EMA8>EMA13>EMA21 AND EMA13,EMA21 rising AND state == 2
 *
 * Calibration: TOS BollingerBands uses POPULATION stdev (ddof=0).
 */

export const SQ_LENGTH = 21; // Daily & Weekly both resolve to 21
const N_BB = 2.0;
const KC_MULT_TIGHT = 1.0; // state 3
const KC_MULT_MID = 1.5; // state 2
const KC_MULT_WIDE = 2.0; // state 1

/** state -> the on-chart dot label/colour in the original study. */
export const STATE_LABEL: Record<number, string> = { 0: "none", 1: "black", 2: "red", 3: "orange" };

export interface OhlcBar {
  date?: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export type MomColor = "cyan" | "blue" | "yellow" | "red" | null;

export interface SqueezeSignal {
  /** Integer squeeze state 0..3, or null during warmup. */
  state: number | null;
  /** Dot label: none / black(wide) / red(mid) / orange(tight). */
  label: string | null;
  /** state ∈ {1,2,3} — the bar is inside a squeeze. */
  inSqueeze: boolean;
  /** Bullish ideal: EMA 8>13>21 stacked + rising with a Mid-state squeeze. */
  ideal: boolean;
  /** Bearish ideal (mirror): EMA 8<13<21 stacked + falling with a Mid-state squeeze. */
  idealShort: boolean;
  /** TTM momentum oscillator value, or null during warmup. */
  momentum: number | null;
  /** cyan = +/rising, blue = +/falling, yellow = −/rising, red = −/falling. */
  momColor: MomColor;
}

// ---------------------------------------------------------------------------
// Series primitives — all match pandas semantics (warmup => NaN).
// ---------------------------------------------------------------------------

/** EMA with adjust=False (recursive), seeded at the first element. alpha = 2/(L+1). */
function emaAdjustFalse(x: number[], length: number): number[] {
  const alpha = 2 / (length + 1);
  const out = new Array<number>(x.length);
  let prev = NaN;
  for (let i = 0; i < x.length; i++) {
    if (Number.isNaN(prev)) {
      prev = x[i];
    } else {
      prev = alpha * x[i] + (1 - alpha) * prev;
    }
    out[i] = prev;
  }
  return out;
}

/** Simple moving average, min_periods = length (NaN until the window fills). */
function smaMinPeriods(x: number[], length: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i];
    if (i >= length) sum -= x[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

/** Rolling population standard deviation (ddof=0), min_periods = length. */
function rollingStdPop(x: number[], length: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  for (let i = length - 1; i < x.length; i++) {
    let mean = 0;
    for (let j = i - length + 1; j <= i; j++) mean += x[j];
    mean /= length;
    let varSum = 0;
    for (let j = i - length + 1; j <= i; j++) {
      const d = x[j] - mean;
      varSum += d * d;
    }
    out[i] = Math.sqrt(varSum / length); // ddof = 0
  }
  return out;
}

/** True range. Bar 0 has no prior close, so TR[0] = high − low (pandas skips NaN). */
function trueRange(bars: OhlcBar[]): number[] {
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
// Engine
// ---------------------------------------------------------------------------

function squeezeStateSeries(bars: OhlcBar[], length: number): number[] {
  const close = bars.map((b) => b.c);
  const bbBasis = emaAdjustFalse(close, length);
  const bbDev = rollingStdPop(close, length);
  const kcBasis = smaMinPeriods(close, length);
  const shift = emaAdjustFalse(trueRange(bars), length);

  const out = new Array<number>(bars.length).fill(NaN);
  for (let i = 0; i < bars.length; i++) {
    const bbUpper = bbBasis[i] + N_BB * bbDev[i];
    if (Number.isNaN(bbUpper)) continue; // warmup => NaN state
    const kc = kcBasis[i];
    // Cascading thresholds — tight overrides mid overrides wide (matches Python).
    let state = 0;
    if (bbUpper - (kc + shift[i] * KC_MULT_WIDE) <= 0) state = 1;
    if (bbUpper - (kc + shift[i] * KC_MULT_MID) <= 0) state = 2;
    if (bbUpper - (kc + shift[i] * KC_MULT_TIGHT) <= 0) state = 3;
    out[i] = state;
  }
  return out;
}

/**
 * Value of the least-squares line at the most recent bar (ThinkScript Inertia).
 * Centered/demeaned form for numerical stability — endpoint at x=n−1 is
 * ȳ + slope·((n−1)/2) since the x-mean is (n−1)/2.
 */
function linregEndpoint(y: number[]): number {
  const n = y.length;
  const xbar = (n - 1) / 2;
  let ybar = 0;
  for (let i = 0; i < n; i++) ybar += y[i];
  ybar /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xbar;
    num += dx * (y[i] - ybar);
    den += dx * dx;
  }
  const slope = num / den;
  return ybar + slope * (n - 1 - xbar);
}

function ttmMomentumSeries(bars: OhlcBar[], length: number): number[] {
  const close = bars.map((b) => b.c);
  const closeSma = smaMinPeriods(close, length);

  // delta = close − ((HH+LL)/2 + SMA(close,L)) / 2, with HH/LL rolling over L.
  const delta = new Array<number>(bars.length).fill(NaN);
  for (let i = length - 1; i < bars.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - length + 1; j <= i; j++) {
      if (bars[j].h > hh) hh = bars[j].h;
      if (bars[j].l < ll) ll = bars[j].l;
    }
    const midline = (hh + ll) / 2;
    const basis = (midline + closeSma[i]) / 2;
    delta[i] = close[i] - basis;
  }

  // momentum = rolling linreg endpoint over L deltas (min_periods = L: window must be fully valid).
  const out = new Array<number>(bars.length).fill(NaN);
  for (let i = length - 1; i < bars.length; i++) {
    if (i - length + 1 < 0) continue;
    const window = delta.slice(i - length + 1, i + 1);
    if (window.some((v) => Number.isNaN(v))) continue;
    out[i] = linregEndpoint(window);
  }
  return out;
}

function momentumColorSeries(osc: number[]): MomColor[] {
  const out = new Array<MomColor>(osc.length).fill(null);
  for (let i = 0; i < osc.length; i++) {
    const cur = osc[i];
    const prev = i > 0 ? osc[i - 1] : NaN;
    if (Number.isNaN(cur) || Number.isNaN(prev)) {
      out[i] = null;
      continue;
    }
    const rising = cur > prev;
    const pos = cur >= 0;
    out[i] = rising ? (pos ? "cyan" : "yellow") : pos ? "blue" : "red";
  }
  return out;
}

/** Bullish ideal (long) and bearish ideal (short) in one pass. */
function idealSeries(bars: OhlcBar[], state: number[]): { long: boolean[]; short: boolean[] } {
  const close = bars.map((b) => b.c);
  const e8 = emaAdjustFalse(close, 8);
  const e13 = emaAdjustFalse(close, 13);
  const e21 = emaAdjustFalse(close, 21);
  const long = new Array<boolean>(bars.length).fill(false);
  const short = new Array<boolean>(bars.length).fill(false);
  for (let i = 0; i < bars.length; i++) {
    const mid = state[i] === 2;
    const bullish = e8[i] > e13[i] && e13[i] > e21[i];
    const slopingUp = i > 0 && e13[i] > e13[i - 1] && e21[i] > e21[i - 1];
    long[i] = bullish && slopingUp && mid;
    // Mirror image: stacked down + falling.
    const bearish = e8[i] < e13[i] && e13[i] < e21[i];
    const slopingDown = i > 0 && e13[i] < e13[i - 1] && e21[i] < e21[i - 1];
    short[i] = bearish && slopingDown && mid;
  }
  return { long, short };
}

/** Per-bar signals for the whole series. */
export function computeSeries(bars: OhlcBar[], length: number = SQ_LENGTH): SqueezeSignal[] {
  const state = squeezeStateSeries(bars, length);
  const momentum = ttmMomentumSeries(bars, length);
  const momColor = momentumColorSeries(momentum);
  const ideal = idealSeries(bars, state);
  return bars.map((_, i) => {
    const s = state[i];
    const hasState = !Number.isNaN(s);
    return {
      state: hasState ? s : null,
      label: hasState ? STATE_LABEL[s] : null,
      inSqueeze: hasState && (s === 1 || s === 2 || s === 3),
      ideal: ideal.long[i],
      idealShort: ideal.short[i],
      momentum: Number.isNaN(momentum[i]) ? null : momentum[i],
      momColor: momColor[i],
    };
  });
}

/**
 * One-row summary of the most recent confirmed bar — what the scanner emits.
 * Returns null if there aren't enough bars to produce a state.
 */
export function latestSignal(bars: OhlcBar[], length: number = SQ_LENGTH): SqueezeSignal | null {
  if (bars.length === 0) return null;
  const series = computeSeries(bars, length);
  return series[series.length - 1];
}

// ---------------------------------------------------------------------------
// Daily -> Weekly resample (week ending Friday / ISO week bucketing).
// ---------------------------------------------------------------------------

/** ISO-week key (YYYY-Www) for a YYYY-MM-DD date, Monday-based. */
function isoWeekKey(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  // ISO 8601 week number (Thursday-anchored).
  const day = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const ftDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Aggregate ascending daily bars into weekly bars: open = first, high = max,
 * low = min, close = last, volume = sum. Bars must be date-ascending.
 */
export function resampleWeekly(daily: OhlcBar[]): OhlcBar[] {
  const buckets = new Map<string, OhlcBar>();
  const order: string[] = [];
  for (const b of daily) {
    if (!b.date) continue;
    const key = isoWeekKey(b.date);
    const cur = buckets.get(key);
    if (!cur) {
      buckets.set(key, { date: b.date, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 });
      order.push(key);
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c; // last
      cur.date = b.date; // last date in the week
      cur.v = (cur.v ?? 0) + (b.v ?? 0);
    }
  }
  return order.map((k) => buckets.get(k)!);
}
