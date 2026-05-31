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
import type {
  EarningsBacktestStats,
  EarningsTickerEntry,
} from "@/lib/db/schema";
import {
  classifyBacktest,
  composeWeeklyRead,
  type AnalystNote,
} from "@/lib/earnings-analyst";

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
  rush: "Pre-earnings IV expansion (long vega, exit before EE) · heuristic",
  condor: "Iron condor through EE — collect IV crush + bounded move · V3 BACKTEST",
  straddle: "ATM straddle through EE — bet move exceeds implied · V3 BACKTEST",
  breakout: "Pre-EE directional bet for post-EE follow-through · heuristic",
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
      : tab === "straddle" || tab === "condor"
        ? // V3.1/V3.2: Straddle + Condor tabs are gated by backtest data,
          // not heuristic score. Sort priority:
          //   1. Tier: strong (≥4 cycles) > weak (2-3) > thin (1) > none (0)
          //      so a 100% win on 1 cycle never outranks a 60% on 5.
          //   2. Within tier: avg ROI desc.
          //   3. Tie-break: V1 heuristic score desc.
          [...tickers].sort((a, b) => {
            const at = signalTier(a.backtests?.[tab]);
            const bt = signalTier(b.backtests?.[tab]);
            if (at !== bt) return bt - at;
            const ar = a.backtests?.[tab]?.avgRoiPct;
            const br = b.backtests?.[tab]?.avgRoiPct;
            const av = typeof ar === "number" ? ar : -Infinity;
            const bv = typeof br === "number" ? br : -Infinity;
            if (av !== bv) return bv - av;
            return b.strategies[tab].score - a.strategies[tab].score;
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

      {(tab === "straddle" || tab === "condor") && (
        <>
          <WeeklyReadBox tickers={tickers} strategy={tab} />
          <BacktestSignalBanner tickers={tickers} strategy={tab} />
        </>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-white/55 italic py-8 text-center">
          {tab === "all"
            ? "No earnings reports this week passed the options-liquidity bar."
            : tab === "straddle"
              ? "No tickers with computed Straddle backtest data this week."
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
                  ) : (tab === "straddle" || tab === "condor") &&
                    t.backtests?.[tab] ? (
                    // V3.1/V3.2: real backtest data.
                    <td className="px-3 py-2" colSpan={1}>
                      <BacktestCell stats={t.backtests[tab]!} />
                    </td>
                  ) : (
                    <td className="px-3 py-2" colSpan={1}>
                      <div className="flex items-center gap-2 flex-wrap">
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
        <strong className="text-emerald-300">V3.2 SHIPPED:</strong>{" "}
        Straddle and Condor tabs now show actual 6-cycle Polygon-priced
        backtest results (Win %, Avg ROI, Wins:Losses). Rush and
        Breakout still use V1 heuristic scores pending V3.3 / V3.4. Use
        the backtest data to triage Straddle / Condor picks; the other
        two remain directional signals only. Verify everything against
        your broker before trading.
      </p>
    </section>
  );
}

/**
 * Renders one ticker's backtest stats inline: Win % chip, ROI value,
 * cycle count, and a sparkline of per-cycle ROIs (the visual at-a-
 * glance proxy for consistency).
 */
/**
 * Top-of-tab banner that summarizes how many tickers actually have
 * backtest signal this week for the given strategy. Without this, a
 * slow earnings week with no STRONG candidates reads as if the page
 * is broken — the table just shows a sea of "no priceable cycles" rows.
 *
 * Tone:
 *   ≥1 STRONG    → emerald, count of qualified picks
 *   0 STRONG + ≥1 WEAK → amber, "directional only — no qualified picks"
 *   0 of both    → gray,  "no qualified candidates this week"
 */
function BacktestSignalBanner({
  tickers,
  strategy,
}: {
  tickers: EarningsTickerEntry[];
  strategy: "straddle" | "condor";
}) {
  let strong = 0;
  let weak = 0;
  let thin = 0;
  for (const t of tickers) {
    const tier = signalTier(t.backtests?.[strategy]);
    if (tier === 3) strong++;
    else if (tier === 2) weak++;
    else if (tier === 1) thin++;
  }
  const label = strategy === "straddle" ? "Straddle" : "Condor";

  if (strong > 0) {
    return (
      <div className="rounded border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-xs">
        <span className="font-bold text-emerald-200 uppercase tracking-widest text-[10px] mr-2">
          ✓ {strong} Strong {strong === 1 ? "pick" : "picks"}
        </span>
        <span className="text-white/65">
          {strong} ticker{strong === 1 ? " has" : "s have"} ≥4 cycles of
          historical {label} backtest data this week — those are the
          actionable rows.
          {(weak + thin) > 0 &&
            ` (${weak + thin} more show directional-only data.)`}
        </span>
      </div>
    );
  }
  if (weak > 0) {
    return (
      <div className="rounded border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2 text-xs">
        <span className="font-bold text-amber-300 uppercase tracking-widest text-[10px] mr-2">
          ⚠ No Strong picks
        </span>
        <span className="text-white/65">
          {weak} ticker{weak === 1 ? "" : "s"} returned 2-3 cycles of{" "}
          {label} backtest data — directional only, sample too small to
          trust. Treat as a watchlist, not a trade list.
        </span>
      </div>
    );
  }
  return (
    <div className="rounded border border-white/15 bg-white/[0.03] px-3 py-2 text-xs">
      <span className="font-bold text-white/65 uppercase tracking-widest text-[10px] mr-2">
        No qualified candidates
      </span>
      <span className="text-white/55">
        Zero tickers had enough priceable historical option cycles to
        produce a reliable {label} backtest this week.
        {thin > 0 &&
          ` ${thin} surfaced 1-cycle data (informational only).`}{" "}
        Slow earnings weeks and recent IPOs both tend to leave the{" "}
        {label} tab empty — that&apos;s the signal working, not breaking.
      </span>
    </div>
  );
}

/**
 * Map cycle count → confidence tier. Drives sort order, chip color,
 * and overall cell opacity. 6 cycles is the max we ever attempt.
 *   3 = STRONG  (≥4 cycles)   — trust the win-rate
 *   2 = WEAK    (2-3 cycles)  — directional only
 *   1 = THIN    (1 cycle)     — single print, ignore
 *   0 = NONE    (0 cycles)    — backtest failed
 */
function signalTier(stats: EarningsBacktestStats | undefined): number {
  if (!stats || stats.cyclesUsed <= 0) return 0;
  if (stats.cyclesUsed === 1) return 1;
  if (stats.cyclesUsed <= 3) return 2;
  return 3;
}

function BacktestCell({ stats }: { stats: EarningsBacktestStats }) {
  const { avgRoiPct, winRate, wins, losses, cyclesUsed, totalCycles, cycles } = stats;
  if (cyclesUsed === 0) {
    return (
      <span className="text-xs text-white/45 italic">
        No priceable cycles ({totalCycles} attempted)
      </span>
    );
  }
  const tier = signalTier(stats);
  const tierChip =
    tier === 3
      ? { label: "STRONG", cls: "border-emerald-400/50 text-emerald-200 bg-emerald-500/[0.12]" }
      : tier === 2
        ? { label: "WEAK", cls: "border-amber-500/40 text-amber-300/90 bg-amber-500/[0.08]" }
        : { label: "THIN", cls: "border-white/20 text-white/55 bg-white/[0.04]" };
  // Dim everything below STRONG so the eye can scan to real signal.
  const cellOpacity = tier === 3 ? "" : tier === 2 ? "opacity-80" : "opacity-55";
  const roiTone =
    avgRoiPct != null && avgRoiPct >= 30 ? "text-emerald-300 font-bold"
    : avgRoiPct != null && avgRoiPct >= 0 ? "text-emerald-400"
    : avgRoiPct != null && avgRoiPct > -30 ? "text-rose-400"
    : "text-rose-300 font-bold";
  const winTone =
    winRate != null && winRate >= 0.7 ? "border-emerald-500/50 text-emerald-200 bg-emerald-500/[0.12]"
    : winRate != null && winRate >= 0.5 ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.06]"
    : winRate != null && winRate >= 0.4 ? "border-amber-500/40 text-amber-300 bg-amber-500/[0.08]"
    : "border-rose-500/40 text-rose-300 bg-rose-500/[0.08]";

  // Sparkline: per-cycle ROI bars, emerald=positive, rose=negative.
  const priced = cycles.filter((c) => c.roiPct != null);
  const maxAbs = Math.max(...priced.map((c) => Math.abs(c.roiPct ?? 0)), 1);

  // Analyst note: short prose interpretation of the stats.
  const note = classifyBacktest(stats);

  return (
    <div className={`space-y-1 ${cellOpacity}`}>
    <div className={`flex items-center gap-3 flex-wrap text-xs`}>
      <span
        className={`px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-widest font-bold font-mono ${tierChip.cls}`}
        title={
          tier === 3
            ? "≥4 cycles of historical backtest data — actionable signal."
            : tier === 2
              ? "2-3 cycles only — directional read, sample too small to trust."
              : "Single cycle — informational only."
        }
      >
        {tierChip.label}
      </span>
      <span
        className={`px-2 py-0.5 rounded border text-[10px] uppercase tracking-widest font-bold font-mono ${winTone}`}
      >
        {winRate != null ? `${Math.round(winRate * 100)}%` : "—"} win
      </span>
      <span className="font-mono">
        <span className="text-white/55 uppercase tracking-widest text-[9px] mr-1">
          Avg ROI
        </span>
        <span className={roiTone}>
          {avgRoiPct != null
            ? `${avgRoiPct >= 0 ? "+" : ""}${avgRoiPct.toFixed(0)}%`
            : "—"}
        </span>
      </span>
      <span className="text-white/55 font-mono text-[10px]">
        {wins}W / {losses}L
        <span className="text-white/30"> · {cyclesUsed}/{totalCycles} cycles</span>
      </span>
      {/* Sparkline */}
      <div className="flex items-center gap-px h-5" title="Per-cycle ROI">
        {priced.map((c, i) => {
          const roi = c.roiPct ?? 0;
          const heightPct = Math.min(100, (Math.abs(roi) / maxAbs) * 100);
          const positive = roi >= 0;
          return (
            <div
              key={i}
              className="w-1.5 flex items-center"
              style={{ height: "100%" }}
            >
              <div
                className={`w-full ${positive ? "bg-emerald-400" : "bg-rose-400"}`}
                style={{
                  height: `${heightPct}%`,
                  alignSelf: positive ? "flex-end" : "flex-start",
                }}
                title={`${c.earningsDate}: ${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`}
              />
            </div>
          );
        })}
      </div>
    </div>
    <AnalystNoteLine note={note} />
    </div>
  );
}

/** One-line analyst read shown directly under the backtest cell. The
 *  color encodes tone (positive/caution/negative); the icon previews
 *  the gist at a glance. Hover for the help-page category. */
function AnalystNoteLine({ note }: { note: AnalystNote }) {
  const cls =
    note.tone === "positive"
      ? "text-emerald-300/90"
      : note.tone === "negative"
        ? "text-rose-300/90"
        : note.tone === "caution"
          ? "text-amber-300/90"
          : "text-white/55";
  const icon =
    note.tone === "positive"
      ? "✓"
      : note.tone === "negative"
        ? "✗"
        : note.tone === "caution"
          ? "⚠"
          : "·";
  return (
    <p
      className={`text-[11px] italic ${cls}`}
      title={`Category: ${note.category}`}
    >
      {icon} {note.text}
    </p>
  );
}

/** Top-of-tab hero box with the synthesized "this week's read" — names
 *  the highest-conviction setup, a second pick if one stands out, and
 *  any deceptive row to skip. Renders nothing when no STRONG-tier rows
 *  exist (the empty-state banner below handles that case). */
function WeeklyReadBox({
  tickers,
  strategy,
}: {
  tickers: EarningsTickerEntry[];
  strategy: "straddle" | "condor";
}) {
  const rows = tickers
    .filter((t) => t.backtests?.[strategy] != null)
    .map((t) => ({ symbol: t.symbol, stats: t.backtests![strategy]! }));
  const label = strategy === "straddle" ? "Straddle" : "Condor";
  const read = composeWeeklyRead(rows, label);
  if (!read) return null;
  return (
    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.05] p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest font-bold text-emerald-200">
          ★ This week&apos;s read
        </span>
        <span className="text-[10px] uppercase tracking-widest text-emerald-200/55">
          · {label}
        </span>
      </div>
      <p className="text-sm text-white/85 leading-relaxed">{read.paragraph}</p>
    </div>
  );
}
