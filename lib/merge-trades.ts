/**
 * Merge the three daily scans (premarket / market_open / analysis) into a
 * single authoritative list of trade cards.
 *
 * Hierarchy:  analysis > market_open > premarket.
 * Each later scan can confirm, revise, kill, or add a trade.
 *
 * Silence rule:
 *   A premarket trade not mentioned in a later scan is implicitly confirmed
 *   — the routine only needs to emit deltas. Explicit status="confirmed" is
 *   also allowed and behaves the same.
 *
 * Direction flips:
 *   When a later scan emits the SAME ticker with status="revised" and a new
 *   direction, the card stays as one merged entry with a flip in the diff.
 *
 * Same ticker emitted twice in one scan:
 *   Last-wins. The routine should produce one entry per ticker, but being
 *   lenient avoids brittle ingest behaviour.
 */

import type { Post, Trade, TradeStatus } from "@/lib/db/schema";

export interface MergedTrade extends Trade {
  /** Always set after merge — defaults to "confirmed" for premarket trades. */
  status: TradeStatus;
  /** Where the final state of this card came from. */
  source: "premarket" | "market_open" | "analysis" | "settlement";
  /** When status is "added", which scan added it. */
  addedAt?: "market_open" | "analysis" | "settlement";
  /** Snapshot of the premarket version, attached when a later scan revised or
   *  killed the trade. Used to render the "Changed from premarket" diff. */
  originalPremarket?: Trade;
}

function lastByTicker(trades: Trade[]): Map<string, Trade> {
  const m = new Map<string, Trade>();
  for (const t of trades) {
    if (!t.ticker) continue;
    m.set(t.ticker.toUpperCase(), t);
  }
  return m;
}

/** Fields that carry the post-close outcome of a trade. The settlement
 *  scan emits these on every trade it stamps; they must overlay onto the
 *  existing merged entry even when status="confirmed" (i.e. plan unchanged
 *  but outcome now known). */
const OUTCOME_FIELDS = [
  "outcome",
  "pnl_pct",
  "actual_entry",
  "actual_exit",
  "result_notes",
] as const;

function pickOutcomeFields(t: Trade): Partial<Trade> {
  const out: Partial<Trade> = {};
  for (const k of OUTCOME_FIELDS) {
    const v = t[k];
    if (v !== undefined && v !== null) {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

function applyLaterScan(
  base: MergedTrade[],
  scanTrades: Trade[],
  source: "market_open" | "analysis" | "settlement",
): MergedTrade[] {
  const byTicker = new Map(base.map((t) => [t.ticker.toUpperCase(), t]));
  const seen = lastByTicker(scanTrades);

  for (const [ticker, incoming] of seen) {
    const status = incoming.status ?? "confirmed";
    const existing = byTicker.get(ticker);

    if (!existing) {
      // Not in the base — must be a new trade (added).
      // Even if the routine forgot to set status="added", we treat any
      // unknown ticker as added rather than dropping it.
      const merged: MergedTrade = {
        ...incoming,
        status: "added",
        source,
        addedAt: source,
      };
      base.push(merged);
      byTicker.set(ticker, merged);
      continue;
    }

    if (status === "confirmed") {
      // "Confirmed" means the plan didn't change. But the settlement scan
      // emits status="confirmed" with outcome/pnl_pct/result_notes attached
      // — those MUST be folded into the existing entry so the TRADE CARDS
      // tab can stamp the result. Plan fields stay as-is; we only overlay
      // the outcome-related fields.
      const outcomeOverlay = pickOutcomeFields(incoming);
      if (Object.keys(outcomeOverlay).length > 0) {
        const merged: MergedTrade = {
          ...existing,
          ...outcomeOverlay,
          // Keep `status` as the previous status (e.g. revised/confirmed)
          // since the plan itself wasn't changed by this scan. But surface
          // the source so the UI can show "Updated · post-close" when it
          // came from settlement.
          source,
        };
        byTicker.set(ticker, merged);
        replaceIn(base, merged);
      }
      continue;
    }

    if (status === "killed") {
      // Preserve the original premarket fields so the card can show what
      // was killed. Drop the analysis outcome onto the killed entry too if
      // this is from the analysis scan (e.g. "killed: no fill").
      const originalPremarket = existing.originalPremarket ?? { ...existing };
      const merged: MergedTrade = {
        ...existing,
        status: "killed",
        source,
        kill_reason: incoming.kill_reason ?? existing.kill_reason,
        outcome: incoming.outcome ?? existing.outcome,
        result_notes: incoming.result_notes ?? existing.result_notes,
        originalPremarket,
      };
      byTicker.set(ticker, merged);
      replaceIn(base, merged);
      continue;
    }

    if (status === "revised") {
      // Overlay incoming fields onto existing. Keep the originalPremarket
      // snapshot so we can render a diff. If `existing` itself was already
      // a revision (e.g. market_open revised, now analysis revises again),
      // the diff still anchors to the original premarket entry.
      const originalPremarket = existing.originalPremarket ?? { ...stripMergedExtras(existing) };
      const merged: MergedTrade = {
        ...existing,
        ...overlay(incoming),
        status: "revised",
        source,
        originalPremarket,
      };
      byTicker.set(ticker, merged);
      replaceIn(base, merged);
      continue;
    }

    if (status === "added") {
      // Routine claimed "added" but the ticker already existed in base.
      // Treat as a revision rather than dropping the data.
      const originalPremarket = existing.originalPremarket ?? { ...stripMergedExtras(existing) };
      const merged: MergedTrade = {
        ...existing,
        ...overlay(incoming),
        status: "revised",
        source,
        originalPremarket,
      };
      byTicker.set(ticker, merged);
      replaceIn(base, merged);
      continue;
    }
  }
  return base;
}

/** Overlay only the fields that were actually present on the incoming
 *  trade — undefined fields don't clobber existing values. */
function overlay(incoming: Trade): Partial<Trade> {
  const out: Partial<Trade> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (v !== undefined && v !== null) {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/** Strip the merge-only extras off a MergedTrade so we get back a plain Trade
 *  snapshot suitable for archival in originalPremarket. */
function stripMergedExtras(m: MergedTrade): Trade {
  const {
    status: _s,
    source: _src,
    addedAt: _a,
    originalPremarket: _o,
    ...rest
  } = m;
  void _s;
  void _src;
  void _a;
  void _o;
  return rest;
}

function replaceIn(arr: MergedTrade[], merged: MergedTrade): void {
  const idx = arr.findIndex(
    (t) => t.ticker.toUpperCase() === merged.ticker.toUpperCase(),
  );
  if (idx >= 0) arr[idx] = merged;
  else arr.push(merged);
}

export interface MergeInput {
  premarket: Post | null;
  marketOpen: Post | null;
  analysis: Post | null;
  /** Post-close settlement scan — stamps end-of-day outcomes onto trades. */
  settlement?: Post | null;
}

export interface MergeResult {
  trades: MergedTrade[];
  /** Which scans were available — drives "Updated 9:45" / "Updated 4:30" badges. */
  hasMarketOpen: boolean;
  hasAnalysis: boolean;
  hasSettlement: boolean;
}

export function mergeDayScans(input: MergeInput): MergeResult {
  const premarketTrades: Trade[] = Array.isArray(input.premarket?.trades)
    ? (input.premarket?.trades ?? [])
    : [];
  // Last-wins dedupe within premarket too (defensive).
  const baseMap = lastByTicker(premarketTrades);
  let base: MergedTrade[] = Array.from(baseMap.values()).map((t) => ({
    ...t,
    status: "confirmed",
    source: "premarket",
  }));

  if (input.marketOpen) {
    base = applyLaterScan(base, input.marketOpen.trades ?? [], "market_open");
  }
  if (input.analysis) {
    base = applyLaterScan(base, input.analysis.trades ?? [], "analysis");
  }
  if (input.settlement) {
    base = applyLaterScan(base, input.settlement.trades ?? [], "settlement");
  }

  // Stable sort: rank ascending, undefined ranks last; ties broken by ticker.
  base.sort((a, b) => {
    const ar = typeof a.rank === "number" ? a.rank : Number.POSITIVE_INFINITY;
    const br = typeof b.rank === "number" ? b.rank : Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    return a.ticker.localeCompare(b.ticker);
  });

  return {
    trades: base,
    hasMarketOpen: !!input.marketOpen,
    hasAnalysis: !!input.analysis,
    hasSettlement: !!input.settlement,
  };
}

// ---------------------------------------------------------------------------
// Diff helper — used by the card UI to render the "Changed from premarket"
// list. Only fields that materially differ are surfaced.
// ---------------------------------------------------------------------------

export interface FieldDiff {
  field: string;
  label: string;
  from: string;
  to: string;
}

const DIFFABLE: Array<{ key: keyof Trade; label: string }> = [
  { key: "direction", label: "Direction" },
  { key: "strike", label: "Strike" },
  { key: "expiry", label: "Expiry" },
  { key: "entry_zone", label: "Entry zone" },
  { key: "entry_trigger", label: "Entry trigger" },
  { key: "target1", label: "Target 1" },
  { key: "target2", label: "Target 2" },
  { key: "stop", label: "Stop" },
  { key: "time_stop", label: "Time stop" },
  { key: "grade", label: "Grade" },
];

// ---------------------------------------------------------------------------
// Day scorecard — aggregates outcomes across a day's merged trades. Used by
// the TRADE CARDS tab header to render the wins/losses/PnL chip row.
// ---------------------------------------------------------------------------

export interface DayScorecard {
  total: number;
  /** Trades resolved with an outcome (analysis scan has run on them). */
  resolved: number;
  wins: number; // target1_hit + target2_hit
  losses: number; // stopped
  noFills: number;
  timeStops: number;
  manualExits: number;
  killed: number;
  /** Sum of pnl_pct across all resolved trades. NaN-safe. */
  netPnlPct: number;
  /** wins / (wins + losses). null when no completed wins/losses yet. */
  winRate: number | null;
  /** True when at least one trade has an outcome set. Drives whether to
   *  render the scorecard or a placeholder. */
  hasOutcomes: boolean;
}

export function scorecardFor(trades: MergedTrade[]): DayScorecard {
  let wins = 0;
  let losses = 0;
  let noFills = 0;
  let timeStops = 0;
  let manualExits = 0;
  let killed = 0;
  let resolved = 0;
  let netPnlPct = 0;

  for (const t of trades) {
    if (t.status === "killed") killed++;
    if (t.outcome != null) {
      resolved++;
      switch (t.outcome) {
        case "target1_hit":
        case "target2_hit":
          wins++;
          break;
        case "stopped":
          losses++;
          break;
        case "no_fill":
          noFills++;
          break;
        case "time_stopped":
          timeStops++;
          break;
        case "manual_exit":
          manualExits++;
          break;
      }
      if (typeof t.pnl_pct === "number" && Number.isFinite(t.pnl_pct)) {
        netPnlPct += t.pnl_pct;
      }
    }
  }
  const denom = wins + losses;
  return {
    total: trades.length,
    resolved,
    wins,
    losses,
    noFills,
    timeStops,
    manualExits,
    killed,
    netPnlPct,
    winRate: denom > 0 ? wins / denom : null,
    hasOutcomes: resolved > 0,
  };
}

export function diffTrade(original: Trade, current: Trade): FieldDiff[] {
  const out: FieldDiff[] = [];
  for (const { key, label } of DIFFABLE) {
    const a = original[key];
    const b = current[key];
    if (a == null && b == null) continue;
    if (String(a ?? "") === String(b ?? "")) continue;
    out.push({
      field: String(key),
      label,
      from: String(a ?? "—"),
      to: String(b ?? "—"),
    });
  }
  return out;
}
