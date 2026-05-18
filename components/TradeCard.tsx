import type { Trade, TradeOutcome } from "@/lib/db/schema";
import { diffTrade, type MergedTrade } from "@/lib/merge-trades";

function gradeTone(grade: string | undefined): "good" | "ok" | "bad" {
  const g = (grade ?? "").toUpperCase();
  if (g.startsWith("A")) return "good";
  if (g.startsWith("B")) return "ok";
  return "bad";
}

function directionLabel(d: string | null | undefined): string {
  if (!d) return "";
  if (d === "call") return "Call";
  if (d === "put") return "Put";
  if (d === "long") return "Long";
  if (d === "short") return "Short";
  if (d === "avoid") return "Avoid";
  return d;
}

function fmtNumOrStr(x: number | string | null | undefined): string | null {
  if (x == null) return null;
  return String(x);
}

function outcomeBanner(
  outcome: TradeOutcome,
  pnl?: number | null,
  notes?: string | null,
): { label: string; tone: "good" | "bad" | "neutral" } {
  const pnlSuffix =
    typeof pnl === "number" && Number.isFinite(pnl)
      ? ` (${pnl > 0 ? "+" : ""}${pnl.toFixed(0)}%)`
      : "";
  const note = notes ? ` · ${notes}` : "";
  switch (outcome) {
    case "target1_hit":
      return { label: `Target 1 hit${pnlSuffix}${note}`, tone: "good" };
    case "target2_hit":
      return { label: `Target 2 hit${pnlSuffix}${note}`, tone: "good" };
    case "stopped":
      return { label: `Stopped${pnlSuffix}${note}`, tone: "bad" };
    case "no_fill":
      return { label: `No fill${note}`, tone: "neutral" };
    case "time_stopped":
      return { label: `Time-stopped${pnlSuffix}${note}`, tone: "neutral" };
    case "manual_exit":
      return { label: `Manual exit${pnlSuffix}${note}`, tone: "neutral" };
  }
}

function stampFor(trade: MergedTrade): { label: string; tone: "good" | "bad" | "neutral" | "warn" } | null {
  // Killed status wins over any outcome — the card never executed.
  if (trade.status === "killed") return { label: "Killed", tone: "bad" };
  if (!trade.outcome) return null;
  const pnl = trade.pnl_pct;
  const pnlSuffix =
    typeof pnl === "number" && Number.isFinite(pnl)
      ? ` ${pnl > 0 ? "+" : ""}${pnl.toFixed(0)}%`
      : "";
  switch (trade.outcome) {
    case "target1_hit":
      return { label: `T1 Hit${pnlSuffix}`, tone: "good" };
    case "target2_hit":
      return { label: `T2 Hit${pnlSuffix}`, tone: "good" };
    case "stopped":
      return { label: `Stopped${pnlSuffix}`, tone: "bad" };
    case "no_fill":
      return { label: "No Fill", tone: "neutral" };
    case "time_stopped":
      return { label: `Time Stop${pnlSuffix}`, tone: "warn" };
    case "manual_exit": {
      const tone: "good" | "bad" | "neutral" =
        typeof pnl === "number" ? (pnl > 0 ? "good" : pnl < 0 ? "bad" : "neutral") : "neutral";
      return { label: `Manual Exit${pnlSuffix}`, tone };
    }
  }
}

function sourceBadge(source: MergedTrade["source"], addedAt?: MergedTrade["addedAt"]): {
  label: string;
  tone: "amber" | "emerald" | "rose";
} | null {
  if (source === "market_open") {
    return { label: "Updated · 9:45", tone: "amber" };
  }
  if (source === "analysis") {
    return { label: "Updated · post-close", tone: "amber" };
  }
  if (addedAt === "market_open") {
    return { label: "Added · 9:45", tone: "emerald" };
  }
  if (addedAt === "analysis") {
    return { label: "Added · post-close", tone: "emerald" };
  }
  return null;
}

interface TradeCardProps {
  trade: MergedTrade;
  /** When true, render the killed/revised diff sections. Defaults true. */
  showDiff?: boolean;
}

/**
 * Authoritative trade-card component. Renders the same visual layout used
 * across the authenticated TRADE CARDS tab and the public Explore Daily
 * headline. Status-driven badges, diff disclosure, and analysis outcome
 * footer are all encapsulated here so the layout stays consistent.
 */
export default function TradeCard({ trade, showDiff = true }: TradeCardProps) {
  const tone = gradeTone(trade.grade);
  const killed = trade.status === "killed";
  const revised = trade.status === "revised";
  const added = trade.status === "added" || trade.addedAt != null;
  const badge = sourceBadge(trade.source, trade.addedAt);

  const borderClass = killed
    ? "border-white/15 bg-white/[0.02] opacity-70"
    : revised
      ? "border-amber-500/40 bg-amber-500/[0.04]"
      : added
        ? "border-emerald-500/40 bg-emerald-500/[0.04]"
        : "border-red-500/40 bg-red-500/[0.04]";

  const diff =
    revised && showDiff && trade.originalPremarket
      ? diffTrade(trade.originalPremarket, trade)
      : [];

  const banner =
    trade.outcome != null
      ? outcomeBanner(trade.outcome, trade.pnl_pct, trade.result_notes)
      : null;

  const stamp = stampFor(trade);
  // Place the stamp inside the most appropriate section so it doesn't
  // overlay the Strike / Entry Zone / Target metrics at the top.
  // Priority: killed banner (killed cards) → entry trigger → rationale →
  // outcome banner → fallback at card floor.
  const stampSlot: "killed" | "trigger" | "rationale" | "outcome" | "floor" | null =
    stamp == null
      ? null
      : killed
        ? "killed"
        : trade.entry_trigger
          ? "trigger"
          : trade.rationale
            ? "rationale"
            : banner
              ? "outcome"
              : "floor";

  return (
    <div className={`relative rounded-lg border ${borderClass} overflow-hidden`}>
      {stamp && stampSlot === "floor" && (
        <Stamp label={stamp.label} tone={stamp.tone} />
      )}
      {/* Header row */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 bg-white/[0.02] border-b border-white/10">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2
            className={`text-2xl font-bold tracking-tight ${killed ? "line-through text-white/55" : ""}`}
          >
            {trade.ticker}
          </h2>
          {trade.direction && (
            <span className="px-2 py-0.5 rounded bg-white/[0.05] text-white/65 text-xs uppercase tracking-widest">
              {directionLabel(trade.direction)}
            </span>
          )}
          {trade.rank != null && (
            <span className="text-xs text-white/45">Rank #{trade.rank}</span>
          )}
          {badge && (
            <span
              className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded ${
                badge.tone === "amber"
                  ? "bg-amber-500/15 text-amber-300"
                  : badge.tone === "emerald"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-rose-500/15 text-rose-300"
              }`}
            >
              {badge.label}
            </span>
          )}
        </div>
        {trade.grade && (
          <span
            className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded font-mono ${
              tone === "good"
                ? "bg-emerald-500/15 text-emerald-300"
                : tone === "ok"
                  ? "bg-amber-500/15 text-amber-300"
                  : "bg-rose-500/15 text-rose-300"
            }`}
          >
            Grade {trade.grade}
          </span>
        )}
      </div>

      {/* Killed banner — short-circuits the metrics */}
      {killed && (
        <div className="relative px-4 py-3 bg-rose-500/[0.06] border-b border-white/5">
          {stamp && stampSlot === "killed" && (
            <Stamp label={stamp.label} tone={stamp.tone} />
          )}
          <div className="text-[10px] uppercase tracking-widest text-rose-300 mb-1">
            Killed {trade.source === "market_open" ? "at market open" : "post-close"}
          </div>
          {trade.kill_reason && (
            <p className="text-sm leading-relaxed text-white/80 pr-36">{trade.kill_reason}</p>
          )}
        </div>
      )}

      {/* Metrics grid (skipped when killed since the plan is no longer actionable) */}
      {!killed && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 px-4 py-3 text-sm">
          {trade.strike && <Metric label="Strike" value={fmtNumOrStr(trade.strike)!} />}
          {trade.expiry && <Metric label="Expiry" value={trade.expiry} />}
          {trade.entry_zone && <Metric label="Entry zone" value={trade.entry_zone} />}
          {trade.target1 && (
            <Metric label="Target 1" value={fmtNumOrStr(trade.target1)!} tone="good" />
          )}
          {trade.target2 && (
            <Metric label="Target 2" value={fmtNumOrStr(trade.target2)!} tone="good" />
          )}
          {trade.stop && <Metric label="Stop" value={fmtNumOrStr(trade.stop)!} tone="bad" />}
          {trade.time_stop && <Metric label="Time stop" value={trade.time_stop} />}
        </div>
      )}

      {/* Revised diff */}
      {revised && diff.length > 0 && (
        <details className="px-4 py-3 border-t border-white/5 bg-amber-500/[0.03] group">
          <summary className="cursor-pointer text-[10px] uppercase tracking-widest text-amber-300 hover:text-amber-200">
            Changed from premarket ({diff.length}) {trade.revision_summary ? "·" : ""}{" "}
            {trade.revision_summary && (
              <span className="normal-case tracking-normal text-white/75 ml-1">
                {trade.revision_summary}
              </span>
            )}
          </summary>
          <ul className="mt-2 space-y-1 text-xs font-mono">
            {diff.map((d) => (
              <li key={d.field} className="text-white/75">
                <span className="text-white/45">{d.label}:</span>{" "}
                <span className="line-through text-rose-300/80">{d.from}</span>{" "}
                <span className="text-emerald-300">→ {d.to}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Entry trigger (skipped when killed) */}
      {!killed && trade.entry_trigger && (
        <div className="relative px-4 py-3 border-t border-white/5 bg-amber-500/[0.04]">
          {stamp && stampSlot === "trigger" && (
            <Stamp label={stamp.label} tone={stamp.tone} />
          )}
          <div className="text-[10px] uppercase tracking-widest text-amber-300 mb-1">
            Entry trigger
          </div>
          <p
            className={`text-sm leading-relaxed ${stampSlot === "trigger" ? "pr-40" : ""}`}
          >
            {trade.entry_trigger}
          </p>
        </div>
      )}

      {/* Rationale */}
      {!killed && trade.rationale && (
        <div className="relative px-4 py-3 border-t border-white/5">
          {stamp && stampSlot === "rationale" && (
            <Stamp label={stamp.label} tone={stamp.tone} />
          )}
          <div className="text-[10px] uppercase tracking-widest text-white/55 mb-2">
            Rationale
          </div>
          <p
            className={`text-sm leading-relaxed text-white/80 ${stampSlot === "rationale" ? "pr-40" : ""}`}
          >
            {trade.rationale}
          </p>
        </div>
      )}

      {/* Analysis-scan outcome footer */}
      {banner && (
        <div
          className={`relative px-4 py-3 border-t border-white/5 text-sm ${
            banner.tone === "good"
              ? "bg-emerald-500/[0.08] text-emerald-200"
              : banner.tone === "bad"
                ? "bg-rose-500/[0.08] text-rose-200"
                : "bg-white/[0.04] text-white/75"
          }`}
        >
          {stamp && stampSlot === "outcome" && (
            <Stamp label={stamp.label} tone={stamp.tone} />
          )}
          <div className="text-[10px] uppercase tracking-widest mb-1 opacity-70">
            Result
          </div>
          <div className={`font-medium ${stampSlot === "outcome" ? "pr-40" : ""}`}>
            {banner.label}
          </div>
          {(trade.actual_entry != null || trade.actual_exit != null) && (
            <div className="text-xs mt-1 opacity-80 font-mono">
              {trade.actual_entry != null && <>Entry {fmtNumOrStr(trade.actual_entry)} </>}
              {trade.actual_exit != null && <>· Exit {fmtNumOrStr(trade.actual_exit)}</>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-white/45">
        {label}
      </span>
      <span
        className={`text-base font-mono ${
          tone === "good"
            ? "text-emerald-400"
            : tone === "bad"
              ? "text-rose-400"
              : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Rubber-stamp overlay sitting diagonally across the upper-right of a card.
 * Pure CSS — semi-transparent ink color, thick double border, rotated
 * uppercase mono. Drawn over the card content via `absolute` positioning;
 * `pointer-events-none` so clicks pass through to anything underneath.
 */
function Stamp({
  label,
  tone,
}: {
  label: string;
  tone: "good" | "bad" | "neutral" | "warn";
}) {
  const ring =
    tone === "good"
      ? "border-emerald-400/55 text-emerald-300/80 shadow-emerald-500/10"
      : tone === "bad"
        ? "border-rose-400/55 text-rose-300/80 shadow-rose-500/10"
        : tone === "warn"
          ? "border-amber-400/55 text-amber-300/85 shadow-amber-500/10"
          : "border-white/35 text-white/65 shadow-white/5";
  return (
    <div
      aria-hidden
      className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 z-10 pointer-events-none select-none"
      style={{ transform: "translateY(-50%) rotate(-10deg)" }}
    >
      <div
        className={`px-3.5 py-1.5 border-[3px] rounded-sm font-mono uppercase font-bold tracking-[0.2em] text-xs sm:text-sm shadow-lg bg-black/30 backdrop-blur-[1px] ${ring}`}
      >
        {label}
      </div>
    </div>
  );
}

/** Coerces a plain `Trade` (no merge metadata) into a `MergedTrade` for
 *  rendering by `TradeCard`. Used by the Explore Daily headline before the
 *  scan-hierarchy was wired in, and by anywhere that has just a Trade. */
export function tradeToMerged(t: Trade): MergedTrade {
  return {
    ...t,
    status: t.status ?? "confirmed",
    source: "premarket",
  };
}
