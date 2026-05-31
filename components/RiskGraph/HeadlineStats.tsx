"use client";

/**
 * Multi-row headline panel for the Risk Graph result.
 *
 *   1. Quote-type comparison table (Natural · Mid · Optimistic) showing
 *      entry debit/credit, max profit, max risk, R/R, and per-contract
 *      row at the bottom. Mid is highlighted as the default reference.
 *
 *   2. Breakevens + ratio strip — downside BE · upside BE ·
 *      max-profit/max-risk · max-profit/cost.
 *
 *   3. Combined Greeks row at current spot with Mid quote (Greeks
 *      reflect position structure, not entry slippage).
 *
 * Visually denser + more colorful than the v1 stats panel so the
 * "what am I really risking and what could I make" question is
 * answered in 2 seconds.
 */

import type {
  HeadlineStats as Headline,
  QuoteScenario,
} from "@/lib/risk-graph";

interface Props {
  headline: Headline;
  scenarios: QuoteScenario[];
  totalContracts: number;
}

function fmtUsd(v: number, opts: { sign?: boolean; abs?: boolean } = {}): string {
  if (!Number.isFinite(v)) return "—";
  const target = opts.abs ? Math.abs(v) : v;
  const sign = target < 0 ? "−" : opts.sign ? "+" : "";
  const abs = Math.abs(target);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPct(v: number | null, decimals = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(decimals)}%`;
}

const QUOTE_TONE: Record<string, string> = {
  natural: "border-rose-500/30 bg-rose-500/[0.04]",
  mid: "border-emerald-500/50 bg-emerald-500/[0.08]",
  optimistic: "border-amber-500/30 bg-amber-500/[0.04]",
};

const QUOTE_DESC: Record<string, string> = {
  natural: "Worst-case fills",
  mid: "Mid of bid/ask (default)",
  optimistic: "Best-case fills",
};

export default function HeadlineStats({
  headline,
  scenarios,
  totalContracts,
}: Props) {
  const { breakevens, riskRewardPct, greeks, maxProfit, maxRisk, entryDebit } = headline;
  // Max-Profit / Cost — "ROI if everything works out". Entry cost = abs(debit) for
  // long-debit structures; for credit positions, cost is the max risk.
  const cost = entryDebit > 0 ? Math.abs(entryDebit) : Math.abs(maxRisk);
  const maxProfitCostPct = cost > 0 ? (maxProfit / cost) * 100 : null;

  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
      {/* QUOTE-TYPE COMPARISON TABLE */}
      <div>
        <div className="text-xs uppercase tracking-widest text-white/75 font-semibold mb-2">
          Quote scenarios ({totalContracts} {totalContracts === 1 ? "contract" : "contracts"})
        </div>
        <div className="overflow-x-auto rounded border border-white/10">
          <table className="w-full text-xs">
            <thead className="bg-white/[0.03]">
              <tr className="text-[10px] uppercase tracking-widest text-white/55">
                <th className="px-3 py-2 text-left">Quote</th>
                <th className="px-3 py-2 text-right">Entry</th>
                <th className="px-3 py-2 text-right">Max profit</th>
                <th className="px-3 py-2 text-right">Max risk</th>
                <th className="px-3 py-2 text-right">R / R</th>
                <th className="px-3 py-2 text-right hidden sm:table-cell">
                  Per contract
                </th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {scenarios.map((s) => {
                const isMid = s.type === "mid";
                const tone = QUOTE_TONE[s.type] ?? "";
                const entryLabel = s.entryDebit > 0 ? "Debit" : s.entryDebit < 0 ? "Credit" : "Net";
                const entryColor =
                  s.entryDebit > 0
                    ? "text-rose-300"
                    : s.entryDebit < 0
                      ? "text-emerald-300"
                      : "text-white/85";
                const perContract = totalContracts > 0 ? s.entryDebit / totalContracts : 0;
                return (
                  <tr
                    key={s.type}
                    className={`border-t border-white/5 ${tone} ${isMid ? "font-bold" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <span className={`uppercase tracking-widest text-[10px] ${
                          isMid ? "text-emerald-300" : "text-white/65"
                        }`}>
                          {s.label}
                          {isMid && " ★"}
                        </span>
                        <span className="text-[9px] text-white/45 normal-case tracking-normal">
                          {QUOTE_DESC[s.type]}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className={entryColor}>
                        {entryLabel} {fmtUsd(s.entryDebit, { abs: true })}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-300">
                      {fmtUsd(s.maxProfit, { sign: true })}
                    </td>
                    <td className="px-3 py-2 text-right text-rose-300">
                      {fmtUsd(s.maxRisk)}
                    </td>
                    <td className="px-3 py-2 text-right text-amber-300">
                      {fmtPct(s.riskRewardPct)}
                    </td>
                    <td className="px-3 py-2 text-right text-white/65 hidden sm:table-cell">
                      {entryLabel} {fmtUsd(perContract, { abs: true })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* BREAKEVENS + RATIOS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Cell
          label="Downside breakeven"
          value={
            breakevens.length === 0
              ? "—"
              : `$${breakevens[0].toFixed(breakevens[0] >= 100 ? 0 : 2)}`
          }
          tone="text-amber-300 font-bold"
        />
        <Cell
          label="Upside breakeven"
          value={
            breakevens.length < 2
              ? breakevens.length === 1
                ? `$${breakevens[0].toFixed(breakevens[0] >= 100 ? 0 : 2)}`
                : "—"
              : `$${breakevens[breakevens.length - 1].toFixed(
                  breakevens[breakevens.length - 1] >= 100 ? 0 : 2,
                )}`
          }
          tone="text-amber-300 font-bold"
        />
        <Cell
          label="Max profit / Max risk"
          value={fmtPct(riskRewardPct)}
          tone="text-emerald-300 font-bold"
        />
        <Cell
          label="Max profit / Cost"
          value={fmtPct(maxProfitCostPct)}
          tone="text-emerald-300 font-bold"
        />
      </div>

      {/* COMBINED GREEKS */}
      <div className="border-t border-white/5 pt-3 space-y-1">
        <div className="text-[10px] uppercase tracking-widest text-white/55">
          Position Greeks (mid quote, current spot)
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <Cell
            label="Δ Delta (shares)"
            value={`${greeks.delta >= 0 ? "+" : ""}${greeks.delta.toFixed(0)}`}
            tone={
              greeks.delta > 0
                ? "text-emerald-300 font-bold"
                : greeks.delta < 0
                  ? "text-rose-300 font-bold"
                  : "text-white/85"
            }
          />
          <Cell label="Γ Gamma" value={greeks.gamma.toFixed(2)} />
          <Cell
            label="Θ Theta /day"
            value={`${greeks.theta >= 0 ? "+" : ""}${greeks.theta.toFixed(0)}`}
            tone={
              greeks.theta > 0
                ? "text-emerald-300 font-bold"
                : "text-rose-300 font-bold"
            }
          />
          <Cell
            label="V Vega /1% IV"
            value={`${greeks.vega >= 0 ? "+" : ""}${greeks.vega.toFixed(0)}`}
            tone={
              greeks.vega > 0
                ? "text-emerald-300 font-bold"
                : "text-rose-300 font-bold"
            }
          />
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-white/55">
        {label}
      </div>
      <div className={`font-mono mt-0.5 ${tone ?? "text-white/85"}`}>{value}</div>
    </div>
  );
}
