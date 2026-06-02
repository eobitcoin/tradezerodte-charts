"use client";

/**
 * Ranked Calendar Trades view.
 *
 * Displays the ok-tier picks (passed every filter) as a ranked table
 * with: composite score · symbol · spot · strike · front/back DTE ·
 * front/back IV · term-structure ratio · IV rank · post-EE timing ·
 * net debit · BUILD button.
 *
 * BUILD pre-populates Risk Graph with both legs (sell front call,
 * buy back call) using `legsToUrlParams`.
 */

import Link from "next/link";
import type { CalendarPick } from "@/lib/db/schema";
import { legsToUrlParams } from "@/lib/earnings-trade-builder";

interface Props {
  scanDay: string;
  picks: CalendarPick[];
  universeSize: number;
  computedSize: number;
}

function fmtUsd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function fmtPct(v: number | null, decimals = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(decimals)}%`;
}

function fmtIv(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

function scoreTone(s: number | null): string {
  if (s == null) return "border-white/15 text-white/55";
  if (s >= 70)
    return "border-emerald-500/50 text-emerald-200 bg-emerald-500/[0.10]";
  if (s >= 55)
    return "border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.06]";
  if (s >= 40)
    return "border-amber-500/40 text-amber-300 bg-amber-500/[0.08]";
  return "border-rose-500/40 text-rose-300 bg-rose-500/[0.08]";
}

function tsTone(r: number | null): string {
  if (r == null) return "text-white/55";
  if (r >= 1.15) return "text-emerald-300 font-bold";
  if (r >= 1.05) return "text-emerald-400";
  return "text-white/65";
}

export default function CalendarScanView({
  scanDay,
  picks,
  universeSize,
  computedSize,
}: Props) {
  const tradeable = picks.filter(
    (p) => p.skipReason === "ok" && p.compositeScore != null,
  );

  return (
    <section className="space-y-4">
      <div className="text-sm text-white/55">
        Scan day · {fmtDate(scanDay)} · {computedSize} qualifying picks of{" "}
        {universeSize} universe · front 20–40 DTE · back 60–120 DTE
      </div>

      {tradeable.length === 0 ? (
        <p className="text-sm text-white/55 italic py-8 text-center">
          No qualifying calendar setups this scan. The universe may be in
          a low-IV regime where front-month options aren&apos;t expensive
          enough vs. their 1-year range. Calendars need an IV-rank top
          40% to be mathematically favored.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-white/55 bg-white/[0.03]">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Symbol</th>
                <th className="px-3 py-2 text-right">Spot</th>
                <th className="px-3 py-2 text-right">Strike</th>
                <th className="px-3 py-2 text-left">Front expiry</th>
                <th className="px-3 py-2 text-left">Back expiry</th>
                <th className="px-3 py-2 text-right">Front IV</th>
                <th className="px-3 py-2 text-right">Back IV</th>
                <th className="px-3 py-2 text-right">TS ratio</th>
                <th className="px-3 py-2 text-right">IV rank</th>
                <th className="px-3 py-2 text-right">Net debit</th>
                <th className="px-3 py-2 text-right">Score</th>
                <th className="px-3 py-2 text-left">Notes</th>
                <th className="px-3 py-2 text-right">Build</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {tradeable.map((p, i) => (
                <tr
                  key={`${p.symbol}-${p.strike}-${p.frontExpiration}`}
                  className="hover:bg-white/[0.02]"
                >
                  <td className="px-3 py-2 text-white/45 font-mono text-xs">
                    {i + 1}
                  </td>
                  <td className="px-3 py-2 font-mono font-bold">
                    <Link
                      href={`/tickers/${p.symbol}`}
                      className="hover:underline"
                    >
                      {p.symbol}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fmtUsd(p.spot)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fmtUsd(p.strike)}
                    <span className="text-white/45">C</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {fmtDate(p.frontExpiration)}
                    <span className="text-white/40"> ({p.frontDte}d)</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {fmtDate(p.backExpiration)}
                    <span className="text-white/40"> ({p.backDte}d)</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-white/75">
                    {fmtIv(p.frontIv)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-white/55">
                    {fmtIv(p.backIv)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${tsTone(p.termStructureRatio)}`}
                  >
                    {p.termStructureRatio != null
                      ? p.termStructureRatio.toFixed(2)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-amber-300">
                    {fmtPct(p.ivRank)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fmtUsd(p.netDebit)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={`px-2 py-0.5 rounded border text-xs font-bold font-mono ${scoreTone(p.compositeScore)}`}
                    >
                      {p.compositeScore}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-white/55">
                    {p.notes || "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {p.strike != null && p.backExpiration && (
                      <Link
                        href={`/research/risk-graph?${legsToUrlParams({
                          ticker: p.symbol,
                          strategy: "calendar",
                          expiry: p.backExpiration,
                          legs: [
                            {
                              side: "sell",
                              type: "call",
                              strike: p.strike,
                            },
                            {
                              side: "buy",
                              type: "call",
                              strike: p.strike,
                            },
                          ],
                        })}`}
                        className="inline-block rounded border border-amber-500/40 bg-amber-500/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-widest text-amber-300 hover:bg-amber-500/15 transition-colors"
                        title={`Open Risk Graph with this ${p.strike}C calendar pre-loaded (sell front, buy back at same strike)`}
                      >
                        Build →
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-white/45 leading-relaxed max-w-3xl">
        <strong className="text-emerald-300">Ranking model:</strong>{" "}
        Composite score = 35% × IV rank + 30% × clamp((front/back IV − 1)
        × 100, 0..25) + 20% × post-EE timing bonus + 15% × DTE quality.
        Higher is better. Hard filters: IV rank ≥ 60%, no earnings in
        next 30 days, front IV ≥ back IV. BUILD button drops both legs
        (sell front call + buy back call at same strike) into Risk
        Graph. Calendars work best when the underlying stays close to
        the strike through front expiry, so verify spot vs. nearby
        support/resistance before entering. Backtest (historical
        simulated P&amp;L per name) ships in V2.
      </p>
    </section>
  );
}
