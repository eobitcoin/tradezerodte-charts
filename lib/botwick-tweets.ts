/**
 * BotWick tweets — pick the 5 highest-conviction setups from the day's
 * BotWick Analysis scan and format them as ≤280-char posts.
 *
 * Selection is deterministic: non-neutral bias only, scored by how one-sided
 * the indicator board is (|bulls − bears|, 0–9) plus an ADX bonus (strong +3,
 * moderate +1) — i.e. prefer setups where the direction and the trend
 * strength agree. Ties resolve by universe display order.
 *
 * Formatting uses only numbers already computed by the verified engine —
 * the tweet is a faithful compression of the site report, never new claims.
 */

import type { BotwickTickerReport } from "@/lib/db/schema";

// NO URLs anywhere in the text — X's pay-per-use bills $0.20/post with a
// link vs $0.015 without, and even a bare domain gets auto-linked and
// counted. Traffic routes via "link in bio" on @TheBotWick instead.
const MAX_CHARS = 280;

export const MAX_DAILY_TWEETS = 5;

export function scoreReport(r: BotwickTickerReport): number {
  if (!r.ok || r.bias === "neutral") return -1;
  const margin = Math.abs(r.tally.bullish.length - r.tally.bearish.length);
  const adxBonus =
    r.indicators.ADX.verdict === "strong" ? 3 : r.indicators.ADX.verdict === "moderate" ? 1 : 0;
  return margin + adxBonus;
}

/** Top-N picks for the day, best-first. */
export function pickTop(reports: BotwickTickerReport[], n = MAX_DAILY_TWEETS): BotwickTickerReport[] {
  return reports
    .map((r, i) => ({ r, i, s: scoreReport(r) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, n)
    .map((x) => x.r);
}

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));

/** X's weighted count: emoji ≈ 2 (JS length already counts surrogate pairs
 *  as 2), but arrows (U+2190–21FF) weigh 2 while JS counts 1 — pad those. */
function weightedLength(text: string): number {
  const arrows = (text.match(/[←-⇿]/g) ?? []).length;
  return text.length + arrows;
}

/**
 * Compose one post as a "trading plan card": bias header, both triggers
 * (primary first), ladder targets past the trigger, the key zone, EQ context.
 * Lines degrade gracefully if over the limit: EQ drops first, then the zone,
 * then the timeframe — header, triggers, targets, and footer always survive.
 */
export function formatTweet(r: BotwickTickerReport): string {
  const lv = r.levels;
  const bull = r.bias === "bullish";

  const supply = lv.imbalances.find((z) => z.type === "supply");
  const demand = lv.imbalances.find((z) => z.type === "demand");

  // Triggers: the level whose daily close breaks/confirms each direction.
  // Bullish bias: bull trigger = first resistance (continuation breakout),
  // bear trigger = demand floor / second support (invalidation). Bearish
  // bias mirrors: bear trigger = first support, bull trigger = supply top /
  // second resistance (the bias-flip level).
  const bullTrigger = bull ? lv.resistance[0] : (supply?.high ?? lv.resistance[1] ?? lv.swingHigh);
  const bearTrigger = bull ? (demand?.low ?? lv.support[1] ?? lv.swingLow) : lv.support[0];

  // Targets: the ladder BEYOND the trigger (trigger itself isn't a target).
  const ladder = bull ? lv.resistance : lv.support;
  const targets = ladder.slice(1, 4).length >= 2 ? ladder.slice(1, 4) : ladder.slice(0, 3);

  // Ranges always print low–high regardless of ladder order.
  const asc = (arr: number[]) => [...arr].sort((a, b) => a - b);
  const zone = bull
    ? demand
      ? `🛡️ ${fmt(demand.low)}–${fmt(demand.high)} = demand zone`
      : `🛡️ ${asc(lv.support.slice(0, 2)).map(fmt).join("–")} = support shelf`
    : supply
      ? `🛡️ ${fmt(supply.low)}–${fmt(supply.high)} = supply lid`
      : `🛡️ ${asc(lv.resistance.slice(0, 2)).map(fmt).join("–")} = resistance lid`;

  const header = `$${r.symbol} ${bull ? "🟢" : "🔴"} BotWick Trading Plan | $${fmt(r.price)}`;
  const tf = `Timeframe: swing (days–weeks)`;
  const keyLevels = `KEY LEVELS`;
  const trigBull = `🟩 Bull trigger: > ${fmt(bullTrigger)} (daily close)`;
  const trigBear = `🟥 Bear trigger: < ${fmt(bearTrigger)} (daily close)`;
  const triggers = bull ? [trigBull, trigBear] : [trigBear, trigBull];
  const tgt = `🎯 ${targets.map(fmt).join(" → ")}`;
  const eq = `EQ ${fmt(lv.equilibrium)} = ${r.price >= lv.equilibrium ? "premium" : "discount"} pivot`;
  const footer = `Link in bio · Not financial advice`;

  const variants = [
    [header, tf, keyLevels, ...triggers, tgt, zone, eq, footer],
    [header, tf, keyLevels, ...triggers, tgt, zone, footer],
    [header, keyLevels, ...triggers, tgt, zone, footer],
    [header, ...triggers, tgt, footer],
  ];
  for (const lines of variants) {
    const text = lines.join("\n");
    if (weightedLength(text) <= MAX_CHARS) return text;
  }
  // Last resort: header + footer only (always fits).
  return `${header}\n${footer}`;
}
