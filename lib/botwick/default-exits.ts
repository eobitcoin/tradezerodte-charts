/**
 * Default-exit AST synthesis.
 *
 * Builds target/stop/time_stop AST branches from `bot_config` so:
 *   - ALMA × VWAP trades, which have no plan-supplied exits, still have a
 *     safety net.
 *   - Plan-based trades whose parser couldn't extract a branch fall back to
 *     defaults instead of running with `null` exits (= ride to force-exit).
 *
 * Conventions:
 *   - All percentages are stored as positive magnitudes on bot_config;
 *     this module applies the sign (`stop` is always negative-direction).
 *   - `time_stop` uses an ABSOLUTE ET time. The caller passes the signal's
 *     ET time ("HH:MM") and we add `defaultTimeStopMin` to it, clamped to
 *     16:00 so it doesn't run past close (force-exit handles that anyway).
 */

import type { Condition } from "./types";
import type { BotConfig } from "@/lib/db/schema";

/** "HH:MM" + minutes → "HH:MM", clamped to 16:00. Wraps past 23:59 not handled
 *  (we're always in RTH 09:30–16:00 at signal time). */
function addMinutesEt(hhmm: string, minutes: number): string {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return hhmm;
  const total = Number(m[1]) * 60 + Number(m[2]) + minutes;
  const clamped = Math.min(total, 16 * 60); // cap at 16:00 ET
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export type DefaultExitBranches = {
  target1: Condition;
  target2: Condition;
  stop: Condition;
  time_stop: Condition | null;
};

/**
 * Build default exit branches from config. `signalEt` is "HH:MM" ET of the
 * bar that fired the entry; we use it to compute the absolute time_stop.
 * When `signalEt` is omitted (e.g., plan-based ingest before any entry has
 * fired), time_stop returns null and the caller can patch it at signal-arm.
 */
export function buildDefaultExits(cfg: BotConfig, signalEt?: string): DefaultExitBranches {
  const t1 = Number(cfg.defaultTarget1Pct);
  const t2 = Number(cfg.defaultTarget2Pct);
  const stop = Number(cfg.defaultStopLossPct);
  const timeMin = cfg.defaultTimeStopMin;

  return {
    target1: { premium_pct_gte: t1 },
    target2: { premium_pct_gte: t2 },
    // Stop applies as `premium_pct_lte -X` (premium dropped by X% from fill).
    stop: { premium_pct_lte: -Math.abs(stop) },
    time_stop: signalEt
      ? { time_after: { et: addMinutesEt(signalEt, timeMin) } }
      : null,
  };
}

/**
 * Patch a parsed AST with defaults for any null branches. Plan-supplied
 * branches WIN — defaults only fill gaps. Returns a new AST object.
 */
export function fillMissingExits<T extends {
  target1: Condition | null;
  target2: Condition | null;
  stop: Condition | null;
  time_stop: Condition | null;
}>(ast: T, defaults: DefaultExitBranches): T {
  return {
    ...ast,
    target1: ast.target1 ?? defaults.target1,
    target2: ast.target2 ?? defaults.target2,
    stop: ast.stop ?? defaults.stop,
    time_stop: ast.time_stop ?? defaults.time_stop,
  };
}
