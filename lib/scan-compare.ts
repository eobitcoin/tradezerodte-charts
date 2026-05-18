/**
 * Deterministic scan comparison.
 *
 * Given a premarket scan + a market-open scan for the same trading_day, produce:
 *   - A row-per-ticker comparison table with grade / direction deltas and a
 *     "Both" / "Premarket only" / "Market open only" tag.
 *   - A high-probability picks list (ticker shortlist) using a transparent rule:
 *       1. Appears in BOTH scans
 *       2. Same direction in both (call/long stay call/long; put/short stay put/short)
 *       3. Grade ≥ A in both (or grade improved between premarket and market_open)
 *       4. Direction is not "avoid"
 *
 * Pure functions; no DB / network. Drives the ANALYSIS tab.
 */

import type { Trade } from "@/lib/db/schema";

export type ScanLineage = "both" | "premarket_only" | "market_open_only";

export type GradeDelta = "upgraded" | "downgraded" | "same" | "n/a";

export type DirectionDelta = "same" | "flipped" | "to_avoid" | "from_avoid" | "n/a";

export type ComparisonRow = {
  ticker: string;
  lineage: ScanLineage;
  premarket: Trade | null;
  marketOpen: Trade | null;
  gradeDelta: GradeDelta;
  /** Signed grade difference: positive = market_open is a *better* grade. */
  gradeDeltaSteps: number;
  directionDelta: DirectionDelta;
  isHighProbability: boolean;
  /** Human-readable explanation of why this is/isn't a high-probability pick. */
  reason: string;
};

export type ComparisonResult = {
  rows: ComparisonRow[];
  highProbability: ComparisonRow[];
  newAtOpen: ComparisonRow[];
  droppedAtOpen: ComparisonRow[];
};

const GRADE_ORDER = [
  "A+", "A", "A-",
  "B+", "B", "B-",
  "C+", "C", "C-",
  "D+", "D", "D-",
  "F",
] as const;

function gradeRank(g: string | null | undefined): number {
  if (!g) return GRADE_ORDER.length;
  const idx = (GRADE_ORDER as readonly string[]).indexOf(g);
  return idx === -1 ? GRADE_ORDER.length : idx;
}

function isHighProbabilityGrade(g: string | null | undefined): boolean {
  if (!g) return false;
  return gradeRank(g) <= GRADE_ORDER.indexOf("A-"); // A+ / A / A-
}

function directionSign(d: Trade["direction"] | undefined): "bull" | "bear" | "avoid" | null {
  if (!d) return null;
  if (d === "call" || d === "long") return "bull";
  if (d === "put" || d === "short") return "bear";
  return "avoid";
}

export function compareScans(args: {
  premarketTrades: Trade[];
  marketOpenTrades: Trade[];
}): ComparisonResult {
  const { premarketTrades, marketOpenTrades } = args;

  const preMap = new Map<string, Trade>();
  for (const t of premarketTrades) preMap.set(t.ticker.toUpperCase(), t);
  const mopMap = new Map<string, Trade>();
  for (const t of marketOpenTrades) mopMap.set(t.ticker.toUpperCase(), t);

  const allTickers = Array.from(new Set([...preMap.keys(), ...mopMap.keys()])).sort();
  const rows: ComparisonRow[] = allTickers.map((ticker) => {
    const pre = preMap.get(ticker) ?? null;
    const mop = mopMap.get(ticker) ?? null;

    let lineage: ScanLineage;
    if (pre && mop) lineage = "both";
    else if (pre) lineage = "premarket_only";
    else lineage = "market_open_only";

    let gradeDelta: GradeDelta = "n/a";
    let gradeDeltaSteps = 0;
    if (pre && mop && pre.grade && mop.grade) {
      const preRank = gradeRank(pre.grade);
      const mopRank = gradeRank(mop.grade);
      gradeDeltaSteps = preRank - mopRank; // positive = market_open is BETTER (lower rank index = better grade)
      if (gradeDeltaSteps > 0) gradeDelta = "upgraded";
      else if (gradeDeltaSteps < 0) gradeDelta = "downgraded";
      else gradeDelta = "same";
    }

    let directionDelta: DirectionDelta = "n/a";
    if (pre && mop) {
      const preDir = directionSign(pre.direction);
      const mopDir = directionSign(mop.direction);
      if (preDir == null || mopDir == null) {
        directionDelta = "n/a";
      } else if (preDir === mopDir) {
        directionDelta = "same";
      } else if (mopDir === "avoid") {
        directionDelta = "to_avoid";
      } else if (preDir === "avoid") {
        directionDelta = "from_avoid";
      } else {
        directionDelta = "flipped";
      }
    }

    // High-probability picks rule.
    let isHighProbability = false;
    let reason = "";
    if (lineage !== "both") {
      reason =
        lineage === "premarket_only"
          ? "Only appeared in the premarket scan (dropped at open)."
          : "Only appeared after the market opened (no premarket conviction).";
    } else if (directionDelta === "flipped" || directionDelta === "to_avoid") {
      reason = "Direction shifted between scans — conviction unclear.";
    } else if (mop?.direction === "avoid" || pre?.direction === "avoid") {
      reason = "One or both scans tag this AVOID.";
    } else if (!isHighProbabilityGrade(pre?.grade) || !isHighProbabilityGrade(mop?.grade)) {
      // Allow if upgraded into A-tier (e.g., B+ → A counts).
      if (gradeDelta === "upgraded" && isHighProbabilityGrade(mop?.grade)) {
        isHighProbability = true;
        reason = `Upgraded to ${mop?.grade} at open with direction confirmed.`;
      } else {
        reason = "Both scans need grade ≥ A- (or an upgrade into A-tier) to qualify.";
      }
    } else {
      isHighProbability = true;
      reason =
        gradeDelta === "same"
          ? `Held grade ${mop?.grade} across both scans with direction confirmed.`
          : gradeDelta === "upgraded"
            ? `Upgraded from ${pre?.grade} → ${mop?.grade} at open.`
            : `Downgraded slightly (${pre?.grade} → ${mop?.grade}) but still A-tier with direction confirmed.`;
    }

    return {
      ticker,
      lineage,
      premarket: pre,
      marketOpen: mop,
      gradeDelta,
      gradeDeltaSteps,
      directionDelta,
      isHighProbability,
      reason,
    };
  });

  // Order: high-probability picks first, then same-grade across both, then
  // changes worth attention, then new-only / dropped-only at the end.
  rows.sort((a, b) => {
    const score = (r: ComparisonRow) => {
      if (r.isHighProbability) return 0;
      if (r.lineage === "both") return 1;
      if (r.lineage === "market_open_only") return 2;
      return 3;
    };
    const s = score(a) - score(b);
    if (s !== 0) return s;
    return a.ticker.localeCompare(b.ticker);
  });

  return {
    rows,
    highProbability: rows.filter((r) => r.isHighProbability),
    newAtOpen: rows.filter((r) => r.lineage === "market_open_only"),
    droppedAtOpen: rows.filter((r) => r.lineage === "premarket_only"),
  };
}
