/**
 * Shared bar / time helpers used by both ALMA strategies and the backtester.
 *
 * Previously each module kept its own near-duplicate copies of todayEt,
 * nowEtTime, sessionVwap, and dropOpenBar — drift hazard. Centralized here.
 */

import type { TradierBar } from "../tradier-adapter";

/** Today's date in America/New_York, ISO format YYYY-MM-DD. */
export function todayEt(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Current time in America/New_York as HH:MM (24h). */
export function nowEtTime(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hh = parts.hour === "24" ? "00" : (parts.hour ?? "00");
  return `${hh}:${parts.minute ?? "00"}`;
}

/**
 * Session VWAP from the closed bars. Uses bar.vwap when Tradier supplies it,
 * otherwise typical price (h+l+c)/3. Skips bars with zero or non-finite
 * volume. Returns null if no usable bars.
 */
export function sessionVwap(
  bars: Array<{ high: number; low: number; close: number; volume: number; vwap?: number }>,
): number | null {
  let pv = 0;
  let vol = 0;
  for (const b of bars) {
    const px = b.vwap ?? (b.high + b.low + b.close) / 3;
    if (!Number.isFinite(px) || !Number.isFinite(b.volume) || b.volume <= 0) continue;
    pv += px * b.volume;
    vol += b.volume;
  }
  return vol > 0 ? pv / vol : null;
}

/**
 * Drop a still-printing in-progress bar from the latest position.
 *
 * Tradier's `bar.time` is the bar START in ET ("HH:MM"). A 5-min bar with
 * time="09:30" covers 09:30–09:35 and is closed once now >= 09:35. We drop
 * when `nowMin - lastMin < 5` (still printing).
 */
export function dropOpenBar<T extends { time?: string }>(bars: T[], nowHHMM: string): T[] {
  if (bars.length === 0) return bars;
  const last = bars[bars.length - 1];
  if (!last.time) return bars;
  const lastHHMM = last.time.slice(-5);
  const [lh, lm] = lastHHMM.split(":").map(Number);
  const [nh, nm] = nowHHMM.split(":").map(Number);
  const lastMin = lh * 60 + lm;
  const nowMin = nh * 60 + nm;
  return nowMin - lastMin < 5 ? bars.slice(0, -1) : bars;
}

// Re-export TradierBar for callers that just want one import path.
export type { TradierBar };
