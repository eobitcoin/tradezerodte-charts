/**
 * Sell Puts analyst layer — top-of-page weekly read synthesized from
 * the ranked picks. Same pattern as the Earnings Scans hero box.
 *
 * Picks a "best Balanced" as the primary recommendation, optionally
 * mentions a Conservative companion for safety-first accounts, and
 * calls out an Aggressive setup ONLY when it has materially better
 * credit (otherwise it's just noise — Aggressive is by definition
 * thinner-cushion than Balanced).
 *
 * All deterministic — no model calls. Same picks always produce the
 * same prose.
 */

import type { SellPutPick } from "@/lib/db/schema";

export interface SellPutsWeeklyRead {
  paragraph: string;
  /** Symbols mentioned in the prose, in order. The view uses this to
   *  visually highlight matching rows in the table (future). */
  highlighted: string[];
}

function fmt(n: number | null | undefined, decimals = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

function pickName(p: SellPutPick): string {
  return `${p.symbol} ${p.strike}P`;
}

/**
 * Compose the weekly-read paragraph from the ranked picks.
 * Returns null when there are no tradeable picks (nothing to say).
 */
export function composeSellPutsWeeklyRead(
  picks: SellPutPick[],
): SellPutsWeeklyRead | null {
  const tradeable = picks.filter(
    (p) => !p.skipReason && p.expectedRoiScore != null,
  );
  if (tradeable.length === 0) return null;

  const balanced = tradeable.filter((p) => p.tier === "balanced");
  const conservative = tradeable.filter((p) => p.tier === "conservative");
  const aggressive = tradeable.filter((p) => p.tier === "aggressive");

  // Best Balanced by expected ROI score (tier's native sort key).
  const bestBalanced = [...balanced].sort(
    (a, b) =>
      (b.expectedRoiScore ?? -Infinity) -
      (a.expectedRoiScore ?? -Infinity),
  )[0];
  // Best Conservative by annualized return (tier's native sort key).
  const bestConservative = [...conservative].sort(
    (a, b) =>
      (b.annualizedReturnPct ?? -Infinity) -
      (a.annualizedReturnPct ?? -Infinity),
  )[0];
  // Best Aggressive by expected ROI.
  const bestAggressive = [...aggressive].sort(
    (a, b) =>
      (b.expectedRoiScore ?? -Infinity) -
      (a.expectedRoiScore ?? -Infinity),
  )[0];

  // Primary: Balanced — that's the default tab and the wheel sweet spot.
  // If no Balanced picks exist, fall back to Aggressive, then Conservative.
  const primary = bestBalanced || bestAggressive || bestConservative;
  if (!primary) return null;

  const highlighted: string[] = [primary.symbol];
  const primaryTier =
    primary.tier === "balanced"
      ? "Balanced"
      : primary.tier === "conservative"
        ? "Conservative"
        : "Aggressive";

  const pop = (primary.probabilityOfProfit ?? 0) * 100;
  const cushion = primary.breakevenCushionPct ?? 0;
  const credit = primary.creditToClosePct ?? 0;
  const annual = primary.annualizedReturnPct ?? 0;

  let p =
    `${pickName(primary)} · ${primary.expiration} (${primary.dteDays}d) ` +
    `is the highest-conviction ${primaryTier} pick this week — ` +
    `${fmt(pop, 0)}% PoP × ${fmt(credit, 2)}% credit/close, ` +
    `with ${fmt(cushion, 1)}% breakeven cushion ` +
    `(annualizes to ${fmt(annual, 1)}%).`;

  // Conservative companion — only if it's a DIFFERENT ticker and has
  // a materially attractive yield (≥10% annualized is a reasonable bar
  // for "worth mentioning vs. T-bills").
  if (
    bestConservative &&
    bestConservative.symbol !== primary.symbol &&
    (bestConservative.annualizedReturnPct ?? 0) >= 10
  ) {
    const cAnnual = bestConservative.annualizedReturnPct ?? 0;
    const cPop = (bestConservative.probabilityOfProfit ?? 0) * 100;
    p +=
      ` For capital-preservation accounts, ${pickName(bestConservative)} ` +
      `(${fmt(cPop, 0)}% PoP, ${fmt(cAnnual, 1)}% annualized) is the top ` +
      `Conservative pick — wider OTM, lower premium, higher safety.`;
    highlighted.push(bestConservative.symbol);
  }

  // Aggressive callout — only when its credit/close is materially fatter
  // than the Balanced primary (>50% relative bump), so we don't recommend
  // it without a reason. If it doesn't meet the bar, skip the mention.
  if (
    bestAggressive &&
    primary.tier === "balanced" &&
    bestAggressive.symbol !== primary.symbol &&
    (bestAggressive.creditToClosePct ?? 0) >
      (primary.creditToClosePct ?? 0) * 1.5
  ) {
    const aPop = (bestAggressive.probabilityOfProfit ?? 0) * 100;
    const aCredit = bestAggressive.creditToClosePct ?? 0;
    const aCushion = bestAggressive.breakevenCushionPct ?? 0;
    p +=
      ` ${pickName(bestAggressive)} sits in Aggressive with a fatter ` +
      `${fmt(aCredit, 2)}% credit but only ${fmt(aCushion, 1)}% cushion ` +
      `at ${fmt(aPop, 0)}% PoP — skip unless you genuinely want assignment ` +
      `at ${bestAggressive.strike}.`;
    highlighted.push(bestAggressive.symbol);
  }

  // Closer — total picks across tiers + reminder that BUILD pre-fills
  // Risk Graph.
  p +=
    ` ${tradeable.length} tradeable picks across all tiers — click BUILD on ` +
    `any row to drop the position into Risk Graph.`;

  return { paragraph: p, highlighted };
}
