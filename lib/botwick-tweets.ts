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

export const MAX_DAILY_TWEETS = 3;

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
/**
 * The tweetable plan levels for a report — SHARED between the morning card
 * (formatTweet) and the EOD updater (formatUpdateReply) so the evening grade
 * is judged against exactly the numbers that were tweeted.
 *
 * Triggers: the level whose daily close breaks/confirms each direction.
 * Bullish bias: bull trigger = first resistance (continuation breakout),
 * bear trigger = demand floor / second support (invalidation). Bearish bias
 * mirrors: bear trigger = first support, bull trigger = supply top / second
 * resistance (the bias-flip level). Targets = the bias-direction ladder
 * BEYOND the trigger (the trigger itself isn't a target).
 */
export function planLevels(r: BotwickTickerReport) {
  const lv = r.levels;
  const bull = r.bias === "bullish";
  const supply = lv.imbalances.find((z) => z.type === "supply");
  const demand = lv.imbalances.find((z) => z.type === "demand");
  let bullTrigger = bull ? lv.resistance[0] : (supply?.high ?? lv.resistance[1] ?? lv.swingHigh);
  let bearTrigger = bull ? (demand?.low ?? lv.support[1] ?? lv.swingLow) : lv.support[0];
  // Side-sanity guardrail: a bull trigger must sit ABOVE price and a bear
  // trigger BELOW it. The swing fallbacks can violate this after a violent
  // gap (price outside the last confirmed swing — e.g. an earnings crash),
  // so repair from the side-correct ladders, then a ±3% last resort.
  const r2 = (x: number) => Math.round(x * 100) / 100;
  if (!(Number.isFinite(bullTrigger) && bullTrigger > r.price)) {
    bullTrigger = lv.resistance.find((x) => x > r.price) ?? r2(r.price * 1.03);
  }
  if (!(Number.isFinite(bearTrigger) && bearTrigger < r.price)) {
    bearTrigger = [...lv.support].find((x) => x < r.price) ?? r2(r.price * 0.97);
  }
  const ladder = bull ? lv.resistance : lv.support;
  const targets = ladder.slice(1, 4).length >= 2 ? ladder.slice(1, 4) : ladder.slice(0, 3);
  return { bull, bullTrigger, bearTrigger, targets, supply, demand };
}

export function formatTweet(r: BotwickTickerReport): string {
  const lv = r.levels;
  const { bull, bullTrigger, bearTrigger, targets, supply, demand } = planLevels(r);

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
  // EQ is only meaningful while price trades INSIDE the swing. Outside it
  // (post-crash/breakout), state the regime instead of a bogus pivot.
  const eq =
    r.price < lv.swingLow
      ? `⚠️ Trading below the prior ${fmt(lv.swingLow)}–${fmt(lv.swingHigh)} swing (breakdown)`
      : r.price > lv.swingHigh
        ? `🚀 Trading above the prior ${fmt(lv.swingLow)}–${fmt(lv.swingHigh)} swing (breakout)`
        : `EQ ${fmt(lv.equilibrium)} = ${r.price >= lv.equilibrium ? "premium" : "discount"} pivot`;
  const footer = `Link in bio · Not financial advice`;

  // Degradation order: the Timeframe filler drops before the EQ/regime line —
  // on a post-crash name the regime warning is the most informative line.
  const variants = [
    [header, tf, keyLevels, ...triggers, tgt, zone, eq, footer],
    [header, keyLevels, ...triggers, tgt, zone, eq, footer],
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

/** One completed session's OHLC + prior close, for grading the plan. */
export interface DayOutcome {
  o: number;
  h: number;
  l: number;
  c: number;
  prevClose: number | null;
}

/**
 * EOD update reply — grades the completed session against the SAME triggers
 * and targets the morning card tweeted (via planLevels). Trigger grading is
 * close-based (the card says "daily close"); target grading is touch-based
 * (a take-profit fills on the touch).
 */
export function formatUpdateReply(r: BotwickTickerReport, day: DayOutcome): string {
  const { bull, bullTrigger, bearTrigger, targets } = planLevels(r);

  const pct =
    day.prevClose && day.prevClose > 0 ? ((day.c - day.prevClose) / day.prevClose) * 100 : null;
  const pctStr = pct == null ? "" : ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% on day)`;

  const header = `$${r.symbol} EOD update 📊`;
  const summary = `Close ${fmt(day.c)}${pctStr} · Range ${fmt(day.l)}–${fmt(day.h)}`;

  // Trigger status (close-based, matching the card's "(daily close)").
  const bullFired = Number.isFinite(bullTrigger) && day.c > bullTrigger;
  const bearFired = Number.isFinite(bearTrigger) && day.c < bearTrigger;
  const triggerLines: string[] = [];
  if (bullFired) triggerLines.push(`🟩 Bull trigger fired — closed above ${fmt(bullTrigger)}`);
  if (bearFired) triggerLines.push(`🟥 Bear trigger fired — closed below ${fmt(bearTrigger)}`);
  if (!bullFired && !bearFired) {
    if (Number.isFinite(bullTrigger) && day.h >= bullTrigger) {
      triggerLines.push(`⏳ Tested ${fmt(bullTrigger)} intraday — no close above yet`);
    } else if (Number.isFinite(bearTrigger) && day.l <= bearTrigger) {
      triggerLines.push(`⏳ Tested ${fmt(bearTrigger)} intraday — no close below yet`);
    } else {
      triggerLines.push(`⏸ Triggers intact — closed inside the range`);
    }
  }
  // A close through the trigger AGAINST the card's bias = plan invalidated.
  if ((bull && bearFired) || (!bull && bullFired)) {
    triggerLines.push(`⚠️ ${bull ? "Bullish" : "Bearish"} read invalidated`);
  }

  // Targets (touch-based, bias direction).
  const hit = targets.filter((t) => (bull ? day.h >= t : day.l <= t));
  const remaining = targets.filter((t) => !hit.includes(t));
  const targetLine =
    hit.length > 0
      ? `${"🎯".repeat(Math.min(hit.length, 3))} ${hit.length}/${targets.length} target${targets.length === 1 ? "" : "s"} hit: ${hit.map(fmt).join(", ")} (${bull ? "high" : "low"} ${fmt(bull ? day.h : day.l)})`
      : null;
  const nextLine = remaining.length > 0 ? `Next: ${remaining.map(fmt).join(" → ")}` : null;

  const footer = `Not financial advice`;

  const variants = [
    [header, summary, ...triggerLines, targetLine, nextLine, footer],
    [header, summary, ...triggerLines, targetLine, footer],
    [header, summary, triggerLines[0], footer],
  ];
  for (const lines of variants) {
    const text = lines.filter((x): x is string => x != null).join("\n");
    if (weightedLength(text) <= MAX_CHARS) return text;
  }
  return `${header}\n${summary}\n${footer}`;
}

/**
 * Full website-style detail — the same narrative sections rendered on the
 * BotWick Analysis tab, formatted for X. Appended below the card in one
 * long post when the account has X Premium; otherwise posted as a reply
 * thread via chunkDetail().
 */
export function formatDetail(r: BotwickTickerReport): string {
  const s = r.sections;
  const section = (title: string, bullets: string[]) =>
    bullets.length ? `${title}\n${bullets.map((b) => `– ${b}`).join("\n")}` : null;
  return [
    section("📈 Critical Levels", s.levels),
    section("💡 Trade Ideas", s.ideas),
    section("✅ Example Scenario for Short Entry", s.shortScenario),
    section("✅ Example Scenario for Long Entry", s.longScenario),
    section("🌌 My Expectation (BotWick)", s.expectation),
  ]
    .filter((x): x is string => x != null)
    .join("\n\n");
}

/**
 * Split the detail into ≤270-weighted-char chunks for the thread fallback,
 * breaking at bullet/section boundaries (never mid-sentence). Each chunk is
 * one reply tweet.
 */
export function chunkDetail(detail: string, max = 270): string[] {
  const lines = detail.split("\n");
  const chunks: string[] = [];
  let cur = "";
  for (const line of lines) {
    const candidate = cur ? `${cur}\n${line}` : line;
    if (weightedLength(candidate) > max && cur) {
      chunks.push(cur);
      cur = line;
    } else {
      cur = candidate;
    }
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}
