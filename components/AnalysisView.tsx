import Link from "next/link";
import { renderMarkdown } from "@/lib/markdown";
import { gradeColors } from "@/lib/grade";
import { compareScans, type ComparisonRow } from "@/lib/scan-compare";
import type { Post, Trade } from "@/lib/db/schema";

type Props = {
  tradingDay: string;
  premarket: Post | null;
  marketOpen: Post | null;
  analysis: Post | null;
};

function dirLabel(d?: Trade["direction"]): string {
  if (!d) return "—";
  return d.toUpperCase();
}

/** Coerce a numeric|string level to a display string, or null if empty. */
function fmtLevel(v?: number | string): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * Build a compact actionable levels string for the Top Recommendations
 * box, e.g. "Entry 595–596 · T1 599 · T2 602 · Stop 593". Prefers the
 * explicit entry_zone, falls back to entry_trigger. Skips any missing
 * field so the line stays tight.
 */
function tradeLevels(t?: Trade | null): string {
  if (!t) return "";
  const parts: string[] = [];
  const entry = fmtLevel(t.entry_zone) ?? fmtLevel(t.entry_trigger);
  if (entry) parts.push(`Entry ${entry}`);
  const t1 = fmtLevel(t.target1);
  if (t1) parts.push(`T1 ${t1}`);
  const t2 = fmtLevel(t.target2);
  if (t2) parts.push(`T2 ${t2}`);
  const stop = fmtLevel(t.stop);
  if (stop) parts.push(`Stop ${stop}`);
  return parts.join(" · ");
}

function dirClass(d?: Trade["direction"]): string {
  if (d === "call" || d === "long")
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  if (d === "put" || d === "short")
    return "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30";
  if (d === "avoid")
    return "bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50 border-black/10 dark:border-white/10";
  return "bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60 border-black/10 dark:border-white/10";
}

function lineageClass(l: ComparisonRow["lineage"]): string {
  if (l === "both")
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  if (l === "market_open_only")
    return "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30";
  return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
}

function lineageLabel(l: ComparisonRow["lineage"]): string {
  if (l === "both") return "Both";
  if (l === "market_open_only") return "New at open";
  return "Premarket only";
}

function gradeDeltaSymbol(r: ComparisonRow): string {
  if (r.gradeDelta === "upgraded") return `▲ ${r.gradeDeltaSteps}`;
  if (r.gradeDelta === "downgraded") return `▼ ${Math.abs(r.gradeDeltaSteps)}`;
  if (r.gradeDelta === "same") return "·";
  return "—";
}

function gradeDeltaClass(r: ComparisonRow): string {
  if (r.gradeDelta === "upgraded") return "text-emerald-700 dark:text-emerald-300";
  if (r.gradeDelta === "downgraded") return "text-rose-600 dark:text-rose-400";
  return "text-black/45 dark:text-white/45";
}

function dirDeltaText(r: ComparisonRow): string {
  if (r.directionDelta === "flipped") return "flipped";
  if (r.directionDelta === "to_avoid") return "→ avoid";
  if (r.directionDelta === "from_avoid") return "from avoid";
  if (r.directionDelta === "same") return "same";
  return "—";
}

function dirDeltaClass(r: ComparisonRow): string {
  if (r.directionDelta === "flipped" || r.directionDelta === "to_avoid")
    return "text-rose-600 dark:text-rose-400";
  if (r.directionDelta === "same") return "text-emerald-700 dark:text-emerald-300";
  return "text-black/55 dark:text-white/55";
}

export default async function AnalysisView({
  tradingDay,
  premarket,
  marketOpen,
  analysis,
}: Props) {
  const preTrades = (premarket?.trades ?? []) as Trade[];
  const mopTrades = (marketOpen?.trades ?? []) as Trade[];

  // Without both source scans there's nothing meaningful to render.
  if (!premarket || !marketOpen) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
        <header className="space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Analysis · {tradingDay}</h1>
            <Link
              href="/learn/analysis"
              className="text-xs text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:underline"
            >
              Help · how to read this →
            </Link>
          </div>
          <p className="text-sm text-black/60 dark:text-white/60 mt-1">
            A side-by-side comparison of the premarket scan vs. the market-open scan, plus a
            synthesized narrative and high-probability picks.
          </p>
        </header>
        <div className="rounded border border-amber-500/30 bg-amber-500/[0.07] p-4 text-sm">
          {!premarket && !marketOpen && (
            <>Awaiting both scans for {tradingDay}. The premarket scan publishes around 8:30 ET; the market-open scan around 9:45 ET.</>
          )}
          {premarket && !marketOpen && (
            <>Awaiting the market-open scan (~9:45 ET). Once it lands, this tab will compare it against the premarket scan and surface high-probability picks.</>
          )}
          {!premarket && marketOpen && (
            <>Market-open scan landed without a premarket scan for {tradingDay}. Comparison requires both.</>
          )}
        </div>
      </div>
    );
  }

  const comparison = compareScans({
    premarketTrades: preTrades,
    marketOpenTrades: mopTrades,
  });

  const narrativeHtml = analysis
    ? await renderMarkdown(analysis.bodyMd, [])
    : null;

  return (
    <article className="max-w-4xl lg:max-w-5xl mx-auto px-4 py-8 space-y-8">
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50">
            Trading day · {tradingDay}
            {analysis?.runAt && (
              <>
                {" · Analysis run "}
                {new Date(analysis.runAt).toLocaleString("en-US", {
                  timeZone: "America/New_York",
                  dateStyle: "short",
                  timeStyle: "short",
                })}
                {" ET"}
              </>
            )}
          </div>
          <Link
            href="/learn/analysis"
            className="text-xs text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:underline"
          >
            Help · how to read this →
          </Link>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {analysis?.title || `Analysis — ${tradingDay}`}
        </h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Side-by-side comparison of the premarket and market-open scans. The narrative below is
          generated after market open; the table and picks underneath are computed deterministically
          from the two scans.
        </p>
      </header>

      {/* TOP RECOMMENDATIONS — hero summary box. Surfaced right under the
          headline so a reader can scan the highest-conviction picks without
          scrolling through the narrative. Same data as the deterministic
          high-probability filter (in BOTH scans · stable direction · grade
          ≥ A−), now elevated + made visually prominent with actionable
          levels (entry / targets / stop). */}
      <section
        aria-label="Top recommendations"
        className="rounded-xl border-2 border-emerald-500/50 bg-gradient-to-br from-emerald-500/[0.10] to-emerald-500/[0.02] shadow-lg shadow-emerald-900/10 p-4 sm:p-5 space-y-3"
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
            <span aria-hidden="true">★</span> Top Recommendations
          </h2>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700/80 dark:text-emerald-300/80">
            {comparison.highProbability.length} high-conviction{" "}
            {comparison.highProbability.length === 1 ? "pick" : "picks"}
          </span>
        </div>
        {comparison.highProbability.length === 0 ? (
          <p className="text-sm text-black/65 dark:text-white/65">
            No trades cleared the high-conviction bar in today&apos;s comparison
            (appears in both scans, stable direction, grade ≥ A−). Read the full
            analysis below for the nuanced picks.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {comparison.highProbability.map((r) => {
              const gc = gradeColors(r.marketOpen?.grade);
              const levels = tradeLevels(r.marketOpen);
              return (
                <li
                  key={r.ticker}
                  className="rounded-lg border border-emerald-500/25 bg-white/60 dark:bg-white/[0.03] p-3 space-y-1.5"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-base">{r.ticker}</span>
                    <span
                      className={`inline-block px-2 py-0.5 text-xs font-semibold rounded border ${dirClass(r.marketOpen?.direction)}`}
                    >
                      {dirLabel(r.marketOpen?.direction)}
                    </span>
                    <span
                      className={`inline-block px-2 py-0.5 text-xs font-semibold rounded border ${gc.pill}`}
                    >
                      {r.marketOpen?.grade ?? "—"}
                    </span>
                    {levels && (
                      <span className="font-mono text-xs text-black/70 dark:text-white/70 ml-auto">
                        {levels}
                      </span>
                    )}
                  </div>
                  {(r.marketOpen?.rationale || r.reason) && (
                    <p className="text-sm text-black/75 dark:text-white/75 leading-snug">
                      {r.marketOpen?.rationale || r.reason}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] text-black/45 dark:text-white/45">
          Read the full analysis below for context, the cross-scan comparison,
          and every ticker that appeared in either scan.
        </p>
      </section>

      {/* LLM narrative */}
      {narrativeHtml ? (
        <section
          className="prose prose-neutral dark:prose-invert max-w-none dte-post"
          dangerouslySetInnerHTML={{ __html: narrativeHtml }}
        />
      ) : (
        <section className="rounded border border-black/10 dark:border-white/10 p-4 text-sm text-black/60 dark:text-white/60">
          Narrative is generated by the 10:00 ET analysis routine. The comparison table and picks
          below are available right now from the two source scans.
        </section>
      )}

      {/* Cross-comparison table — the full ticker-by-ticker detail. The
          high-probability picks are surfaced in the Top Recommendations box
          above; the `isHighProbability` rows are still tinted here for
          continuity. */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          Cross-comparison ({comparison.rows.length})
        </h2>
        <p className="text-xs text-black/55 dark:text-white/55">
          Every ticker that appeared in either scan. Δ columns show how grade and direction shifted
          from premarket → market open. Rows tinted green cleared the high-conviction bar (shown up
          top).
        </p>
        <div className="overflow-x-auto border border-black/10 dark:border-white/10 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
              <tr className="text-left">
                <th className="px-3 py-2">Ticker</th>
                <th className="px-3 py-2">Lineage</th>
                <th className="px-3 py-2">Premarket</th>
                <th className="px-3 py-2">Dir</th>
                <th className="px-3 py-2">Market open</th>
                <th className="px-3 py-2">Dir</th>
                <th className="px-3 py-2">Δ Grade</th>
                <th className="px-3 py-2">Δ Dir</th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((r) => {
                const preGc = r.premarket ? gradeColors(r.premarket.grade) : null;
                const mopGc = r.marketOpen ? gradeColors(r.marketOpen.grade) : null;
                return (
                  <tr
                    key={r.ticker}
                    className={`border-t border-black/10 dark:border-white/10 align-top ${
                      r.isHighProbability ? "bg-emerald-500/[0.04]" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-mono font-semibold">{r.ticker}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded border ${lineageClass(r.lineage)}`}
                      >
                        {lineageLabel(r.lineage)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {r.premarket && preGc ? (
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-semibold rounded border ${preGc.pill}`}
                        >
                          {r.premarket.grade ?? "—"}
                        </span>
                      ) : (
                        <span className="text-black/35 dark:text-white/35">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.premarket ? (
                        <span
                          className={`inline-block px-2 py-0.5 text-xs rounded border ${dirClass(r.premarket.direction)}`}
                        >
                          {dirLabel(r.premarket.direction)}
                        </span>
                      ) : (
                        <span className="text-black/35 dark:text-white/35">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.marketOpen && mopGc ? (
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-semibold rounded border ${mopGc.pill}`}
                        >
                          {r.marketOpen.grade ?? "—"}
                        </span>
                      ) : (
                        <span className="text-black/35 dark:text-white/35">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.marketOpen ? (
                        <span
                          className={`inline-block px-2 py-0.5 text-xs rounded border ${dirClass(r.marketOpen.direction)}`}
                        >
                          {dirLabel(r.marketOpen.direction)}
                        </span>
                      ) : (
                        <span className="text-black/35 dark:text-white/35">—</span>
                      )}
                    </td>
                    <td className={`px-3 py-2 font-mono text-xs ${gradeDeltaClass(r)}`}>
                      {gradeDeltaSymbol(r)}
                    </td>
                    <td className={`px-3 py-2 text-xs ${dirDeltaClass(r)}`}>{dirDeltaText(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </article>
  );
}
