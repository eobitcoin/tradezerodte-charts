"use client";

/**
 * Earnings Scans view — one client component with a strategy-tab
 * switcher.
 *
 * Sub-tabs: All | Rush | Condor | Straddle | Breakout
 *   - "All" shows every reporting ticker with the best-of-any score
 *   - Each strategy tab filters to picks where that strategy scored
 *     ≥ 50 and sorts by that strategy's score descending
 *
 * Each row shows:
 *   - Symbol + earnings date/hour (BMO/AMC)
 *   - Spot + ATM IV + implied move %
 *   - Historical EE stats (median |move|, max, min)
 *   - The four strategy scores as small pills
 *   - Per-strategy rationale (expandable on row click — v2)
 */

import { useState } from "react";
import Link from "next/link";
import type { EarningsTickerEntry } from "@/lib/db/schema";

interface Props {
  coveredFrom: string;
  coveredTo: string;
  tickers: EarningsTickerEntry[];
}

type StrategyKey = "all" | "rush" | "condor" | "straddle" | "breakout";

const TABS: Array<{ id: StrategyKey; label: string }> = [
  { id: "all", label: "All" },
  { id: "rush", label: "Rush" },
  { id: "condor", label: "Condor" },
  { id: "straddle", label: "Straddle" },
  { id: "breakout", label: "Breakout" },
];

const STRATEGY_DESC: Record<Exclude<StrategyKey, "all">, string> = {
  rush: "Pre-earnings IV expansion (long vega, exit before EE)",
  condor: "Iron condor through EE — collect IV crush + bounded move",
  straddle: "ATM straddle through EE — bet move exceeds implied",
  breakout: "Pre-EE directional bet for post-EE follow-through",
};

function fmtPct(v: number | null, sign = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = sign && v >= 0 ? "+" : "";
  return `${s}${v.toFixed(1)}%`;
}
function fmtIv(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}
function fmtUsd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(v >= 100 ? 0 : 2)}`;
}
function fmtDate(iso: string): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function scoreTone(score: number): string {
  if (score >= 75) return "border-emerald-500/50 text-emerald-200 bg-emerald-500/[0.12]";
  if (score >= 50) return "border-amber-500/40 text-amber-300 bg-amber-500/[0.08]";
  if (score >= 25) return "border-white/20 text-white/65 bg-white/[0.04]";
  return "border-white/10 text-white/45 bg-white/[0.02]";
}

function hourLabel(h: "bmo" | "amc" | "dmh"): string {
  return h === "bmo" ? "BMO" : h === "amc" ? "AMC" : "DMH";
}

export default function EarningsScanView({ coveredFrom, coveredTo, tickers }: Props) {
  const [tab, setTab] = useState<StrategyKey>("all");

  const filtered =
    tab === "all"
      ? [...tickers].sort((a, b) => {
          const aMax = Math.max(
            a.strategies.rush.score,
            a.strategies.condor.score,
            a.strategies.straddle.score,
            a.strategies.breakout.score,
          );
          const bMax = Math.max(
            b.strategies.rush.score,
            b.strategies.condor.score,
            b.strategies.straddle.score,
            b.strategies.breakout.score,
          );
          return bMax - aMax;
        })
      : [...tickers]
          .filter((t) => t.strategies[tab].score >= 50)
          .sort((a, b) => b.strategies[tab].score - a.strategies[tab].score);

  return (
    <section className="space-y-4">
      <div className="text-sm text-white/55">
        Week of {fmtDate(coveredFrom)} – {fmtDate(coveredTo)} · {tickers.length}{" "}
        ticker{tickers.length === 1 ? "" : "s"} with liquid options reporting
      </div>

      {/* Strategy tabs */}
      <nav className="flex flex-wrap gap-1.5 border-b border-white/10 pb-2">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={[
                "px-3 py-1.5 rounded border text-xs uppercase tracking-widest font-semibold transition-colors",
                active
                  ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
                  : "border-white/15 text-white/55 hover:border-white/30 hover:text-white",
              ].join(" ")}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab !== "all" && (
        <p className="text-xs text-white/55 italic">{STRATEGY_DESC[tab]}</p>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-white/55 italic py-8 text-center">
          {tab === "all"
            ? "No earnings reports this week passed the options-liquidity bar."
            : `No tickers scored ≥ 50 for the ${tab} strategy this week.`}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-white/55 bg-white/[0.03]">
              <tr>
                <th className="px-3 py-2 text-left">Symbol</th>
                <th className="px-3 py-2 text-left">Earnings</th>
                <th className="px-3 py-2 text-right">Spot</th>
                <th className="px-3 py-2 text-right">ATM IV</th>
                <th className="px-3 py-2 text-right">Implied move</th>
                <th className="px-3 py-2 text-right">Hist |move|</th>
                <th className="px-3 py-2 text-right">Hist max</th>
                <th className="px-3 py-2 text-right">Cycles</th>
                <th className="px-3 py-2 text-center" colSpan={tab === "all" ? 4 : 1}>
                  {tab === "all" ? "Strategy scores" : "Score & rationale"}
                </th>
                <th className="px-3 py-2 text-right">Build</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={t.symbol}
                  className="border-t border-white/5 hover:bg-white/[0.03] transition-colors"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/tickers/${t.symbol}`}
                      className="font-mono font-bold hover:underline"
                    >
                      {t.symbol}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-mono">{fmtDate(t.earningsDate)}</div>
                    <div className="text-white/45 text-[10px] uppercase tracking-widest">
                      {hourLabel(t.hour)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{fmtUsd(t.spot)}</td>
                  <td className="px-3 py-2 text-right font-mono text-white/75">
                    {fmtIv(t.atmIv)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-amber-300">
                    {fmtPct(t.impliedMovePct)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fmtPct(t.historyStats.medianAbs)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-white/65">
                    {fmtPct(t.historyStats.max, true)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-white/55">
                    {t.historyStats.count}
                  </td>
                  {tab === "all" ? (
                    <>
                      {(["rush", "condor", "straddle", "breakout"] as const).map((k) => {
                        const s = t.strategies[k];
                        return (
                          <td key={k} className="px-1.5 py-2 text-center">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-widest font-bold font-mono ${scoreTone(s.score)}`}
                              title={`${k}: ${s.rationale}`}
                            >
                              {k.slice(0, 4)} {s.score}
                            </span>
                          </td>
                        );
                      })}
                    </>
                  ) : (
                    <td className="px-3 py-2" colSpan={1}>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded border text-xs font-bold font-mono ${scoreTone(t.strategies[tab].score)}`}
                        >
                          {t.strategies[tab].score}
                        </span>
                        <span className="text-xs text-white/65">
                          {t.strategies[tab].rationale}
                        </span>
                      </div>
                    </td>
                  )}
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/research/risk-graph?ticker=${t.symbol}`}
                      className="inline-block rounded border border-amber-500/40 bg-amber-500/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-widest text-amber-300 hover:bg-amber-500/15 transition-colors"
                      title="Open Risk Graph builder with this ticker pre-loaded"
                    >
                      Build →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-white/45 leading-relaxed">
        V1 — strategy scores are HEURISTIC, comparing historical EE move
        magnitudes and directional consistency against the current
        IV-implied move. V2 will replace these with actual 6-cycle
        options backtests (entry-to-exit P&L per strategy). Use the
        current scores to triage; verify each pick against your own
        thesis + the actual chain on your broker.
      </p>
    </section>
  );
}
