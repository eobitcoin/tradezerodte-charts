"use client";

/**
 * Headline stat panel for the Risk Graph result.
 *
 * Top row: entry debit/credit + max profit + max risk + R/R + breakevens.
 * Bottom row: combined Greeks (Δ Γ Θ V).
 */

import type { HeadlineStats as Headline } from "@/lib/risk-graph";

interface Props {
  headline: Headline;
}

function fmtUsd(v: number, opts: { sign?: boolean } = {}): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v < 0 ? "−" : opts.sign ? "+" : "";
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(0)}%`;
}

export default function HeadlineStats({ headline }: Props) {
  const { entryDebit, maxProfit, maxRisk, breakevens, riskRewardPct, greeks } = headline;

  const debitLabel =
    entryDebit > 0 ? "Debit" : entryDebit < 0 ? "Credit" : "Net";
  const debitTone =
    entryDebit > 0 ? "text-rose-300" : entryDebit < 0 ? "text-emerald-300" : "";

  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
      {/* Top row: economics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 text-xs">
        <Cell label={debitLabel} value={fmtUsd(Math.abs(entryDebit))} tone={debitTone} />
        <Cell label="Max profit" value={fmtUsd(maxProfit, { sign: true })} tone={maxProfit > 0 ? "text-emerald-300" : ""} />
        <Cell label="Max risk" value={fmtUsd(maxRisk)} tone={maxRisk < 0 ? "text-rose-300" : ""} />
        <Cell label="Reward / Risk" value={fmtPct(riskRewardPct)} tone="text-amber-300" />
        <Cell
          label="Breakevens"
          value={
            breakevens.length === 0
              ? "—"
              : breakevens.map((b) => `$${b.toFixed(b >= 100 ? 0 : 2)}`).join(" / ")
          }
        />
      </div>
      {/* Bottom row: greeks */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs border-t border-white/5 pt-2">
        <Cell
          label="Δ Delta"
          value={`${greeks.delta >= 0 ? "+" : ""}${greeks.delta.toFixed(0)}`}
          tone={greeks.delta > 0 ? "text-emerald-300" : greeks.delta < 0 ? "text-rose-300" : ""}
        />
        <Cell label="Γ Gamma" value={greeks.gamma.toFixed(2)} />
        <Cell
          label="Θ Theta /day"
          value={`${greeks.theta >= 0 ? "+" : ""}${greeks.theta.toFixed(0)}`}
          tone={greeks.theta > 0 ? "text-emerald-300" : "text-rose-300"}
        />
        <Cell
          label="V Vega /1% IV"
          value={`${greeks.vega >= 0 ? "+" : ""}${greeks.vega.toFixed(0)}`}
          tone={greeks.vega > 0 ? "text-emerald-300" : "text-rose-300"}
        />
      </div>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.02] px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-white/45">
        {label}
      </div>
      <div className={`font-mono mt-0.5 ${tone ?? "text-white/85"}`}>{value}</div>
    </div>
  );
}
