/**
 * Market-hours predicate for BotWick.
 *
 * The cron endpoint hits us every minute. We don't want to burn Tradier
 * quota / log noise on weekend nights or 4am Tuesday — bail out fast when
 * we're outside regular trading hours.
 *
 * Range used: 09:30–16:00 ET (or 13:00 ET on half-days), Monday–Friday.
 * Pre/after-hours skipped by default; a future `extendedHours` knob could
 * relax this. Full holidays (Memorial Day, etc.) are NOT handled — the bot
 * just sees empty bars and skips cleanly.
 */

export type MarketHoursPhase = "rth" | "pre_market" | "after_hours" | "weekend";

// NYSE early-close days (close at 13:00 ET). Maintain manually each year.
// The cost of missing one is over-holding by ~3 hours after market close,
// which is a real risk for 0DTE: Tradier auto-exercises ITM options at
// 16:00 ET on the OCC's terms.
const EARLY_CLOSE_13_00: ReadonlySet<string> = new Set([
  // 2026
  "2026-07-03", // Friday before Independence Day (July 4 Sat)
  "2026-11-27", // Day after Thanksgiving
  "2026-12-24", // Christmas Eve (Thursday)
  // 2027
  "2027-07-02", // Friday before Independence Day (July 4 Sun)
  "2027-11-26", // Day after Thanksgiving
  "2027-12-24", // Christmas Eve (Friday)
]);

function todayEtIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Today's market close in minutes-since-midnight ET. 16:00 normally, 13:00 on half-days. */
export function todayCloseMinutesEt(): number {
  return EARLY_CLOSE_13_00.has(todayEtIso()) ? 13 * 60 : 16 * 60;
}

/** True if today is a known NYSE half-day. */
export function isHalfDay(): boolean {
  return EARLY_CLOSE_13_00.has(todayEtIso());
}

function nowEtParts(): { dow: number; hh: number; mm: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  // "Sun","Mon"... → 0..6 like getDay()
  const dowMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dow = dowMap[parts.weekday as string] ?? 0;
  return { dow, hh: Number(parts.hour), mm: Number(parts.minute) };
}

export function getMarketHoursPhase(): MarketHoursPhase {
  const { dow, hh, mm } = nowEtParts();
  if (dow === 0 || dow === 6) return "weekend";
  const minutes = hh * 60 + mm;
  const rthStart = 9 * 60 + 30; // 09:30
  const rthEnd = todayCloseMinutesEt(); // 16:00 normally, 13:00 half-days
  if (minutes < rthStart) return "pre_market";
  if (minutes >= rthEnd) return "after_hours";
  return "rth";
}

export function isRegularTradingHours(): boolean {
  return getMarketHoursPhase() === "rth";
}

/**
 * "Are we in the day-trade force-exit window?" — defined as the 5 minutes
 * before the day's close. Standard sessions: 15:55–15:59 ET. Half-days
 * (13:00 close): 12:55–12:59 ET.
 *
 * Crons run every minute, so any tick whose ET time is within [close-5, close)
 * is the last chance to flat-close before the bell.
 */
export function isForceExitWindow(): boolean {
  const { dow, hh, mm } = nowEtParts();
  if (dow === 0 || dow === 6) return false;
  const close = todayCloseMinutesEt();
  const minutes = hh * 60 + mm;
  return minutes >= close - 5 && minutes < close;
}
