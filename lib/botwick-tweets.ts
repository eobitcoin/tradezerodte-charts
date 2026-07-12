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

const SITE_URL = "https://www.oliviatrades.com/today";
/** X wraps every URL to a t.co link of fixed length. */
const TCO_LEN = 23;
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

/** Effective length as X counts it (URL collapses to t.co). */
function xLength(text: string): number {
  return text.replace(SITE_URL, "x".repeat(TCO_LEN)).length;
}

/**
 * Compose one post. Lines degrade gracefully: if the full version exceeds
 * 280, the invalidation line drops first, then the zone line — the header,
 * targets, link, and disclaimer always survive.
 */
export function formatTweet(r: BotwickTickerReport): string {
  const lv = r.levels;
  const bull = r.bias === "bullish";
  const badge = bull ? "🟢 Bullish" : "🔴 Bearish";
  const eqSide = r.price >= lv.equilibrium ? "Premium vs" : "Discount vs";

  const supply = lv.imbalances.find((z) => z.type === "supply");
  const demand = lv.imbalances.find((z) => z.type === "demand");

  const zone = bull
    ? demand
      ? `Demand ${fmt(demand.low)}–${fmt(demand.high)} below`
      : `Support ${lv.support.slice(0, 2).map(fmt).join(" / ")}`
    : supply
      ? `Supply ${fmt(supply.low)}–${fmt(supply.high)} overhead`
      : `Resistance ${lv.resistance.slice(0, 2).map(fmt).join(" / ")}`;

  const targets = bull ? lv.resistance.slice(0, 3) : lv.support.slice(0, 3);
  const flip = bull ? (lv.support[1] ?? lv.swingLow) : (lv.resistance[1] ?? lv.swingHigh);

  const header = `$${r.symbol} ${badge} — 6AM BotWick read · $${fmt(r.price)}`;
  const context = `${eqSide} EQ ${fmt(lv.equilibrium)} · ${zone}`;
  const plan = `Targets ${targets.map(fmt).join(" → ")}`;
  const invalidation = bull ? `Bias flips below ${fmt(flip)}` : `Bias flips above ${fmt(flip)}`;
  const footer = `Full levels & scenarios → ${SITE_URL}\nEducational only, not financial advice`;

  const variants = [
    [header, context, plan, invalidation, footer],
    [header, context, plan, footer],
    [header, plan, footer],
  ];
  for (const lines of variants) {
    const text = lines.join("\n");
    if (xLength(text) <= MAX_CHARS) return text;
  }
  // Last resort: header + link only (always fits).
  return `${header}\n${footer}`;
}
