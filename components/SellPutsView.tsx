"use client";

/**
 * Ranked Sell Puts view. Renders the scan's `picks` array as a table
 * sorted by expected ROI score, with a "BUILD →" button per row that
 * pre-populates Risk Graph with the chosen short put.
 *
 * Output columns mirror the spec:
 *   Rank · Symbol · Expiration · Close · Strike · Breakeven ·
 *   Put Credit · P(profit) · Expected ROI · Annualized · IV ·
 *   Slippage · OI · BUILD
 *
 * Skipped tickers are NOT rendered here — they're kept in the persisted
 * data for diagnostics but the page only shows the tradeable set.
 */

import Link from "next/link";
import type { SellPutPick } from "@/lib/db/schema";
import { legsToUrlParams } from "@/lib/earnings-trade-builder";

interface Props {
  scanDay: string;
  picks: SellPutPick[];
  universeSize: number;
  computedSize: number;
}

function fmtUsd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function fmtPct(v: number | null, decimals = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(decimals)}%`;
}

function fmtProb(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function fmtIv(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function fmtExpiry(iso: string): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

function popTone(p: number | null): string {
  if (p == null) return "border-white/15 text-white/55";
  if (p >= 0.85) return "border-emerald-500/50 text-emerald-200 bg-emerald-500/[0.10]";
  if (p >= 0.7) return "border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.06]";
  if (p >= 0.55) return "border-amber-500/40 text-amber-300 bg-amber-500/[0.08]";
  return "border-rose-500/40 text-rose-300 bg-rose-500/[0.08]";
}

function slippageTone(s: number | null): string {
  if (s == null) return "text-white/55";
  if (s <= 5) return "text-emerald-300";
  if (s <= 15) return "text-amber-300";
  return "text-rose-300";
}

export default function SellPutsView({
  scanDay,
  picks,
  universeSize,
  computedSize,
}: Props) {
  const tradeable = picks.filter(
    (p) => !p.skipReason && p.expectedRoiScore != null,
  );

  return (
    <section className="space-y-4">
      <div className="text-sm text-white/55">
        Scan day · {fmtExpiry(scanDay)} · {computedSize} tradeable picks of{" "}
        {universeSize} universe · 21–45 DTE
      </div>

      {tradeable.length === 0 ? (
        <p className="text-sm text-white/55 italic py-8 text-center">
          No tradeable Sell Puts in this scan. The universe may be in a
          low-IV regime where short-put premiums don&apos;t justify the
          capital lock-up.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-white/55 bg-white/[0.03]">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Symbol</th>
                <th className="px-3 py-2 text-left">Expiration</th>
                <th className="px-3 py-2 text-right">Close</th>
                <th className="px-3 py-2 text-right">Strike</th>
                <th className="px-3 py-2 text-right">Breakeven</th>
                <th className="px-3 py-2 text-right">Cushion</th>
                <th className="px-3 py-2 text-right">Credit</th>
                <th className="px-3 py-2 text-right">Credit/Close</th>
                <th className="px-3 py-2 text-right">P(profit)</th>
                <th className="px-3 py-2 text-right">Exp. ROI score</th>
                <th className="px-3 py-2 text-right">Annualized</th>
                <th className="px-3 py-2 text-right">IV</th>
                <th className="px-3 py-2 text-right">Slip.</th>
                <th className="px-3 py-2 text-right">OI</th>
                <th className="px-3 py-2 text-right">Build</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {tradeable.map((p, i) => (
                <tr key={`${p.symbol}-${p.contractTicker}`} className="hover:bg-white/[0.02]">
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
                  <td className="px-3 py-2 font-mono text-xs">
                    {fmtExpiry(p.expiration)}
                    <span className="text-white/40"> ({p.dteDays}d)</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fmtUsd(p.close)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fmtUsd(p.strike)}P
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fmtUsd(p.breakeven)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-300">
                    {fmtPct(p.breakevenCushionPct, 1)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fmtUsd(p.putCredit)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fmtPct(p.creditToClosePct)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={`px-2 py-0.5 rounded border text-[10px] uppercase tracking-widest font-bold font-mono ${popTone(p.probabilityOfProfit)}`}
                    >
                      {fmtProb(p.probabilityOfProfit)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-amber-300">
                    {p.expectedRoiScore != null
                      ? p.expectedRoiScore.toFixed(2)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-400">
                    {fmtPct(p.annualizedReturnPct, 1)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-white/65">
                    {fmtIv(p.iv)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono text-xs ${slippageTone(p.quoteSlippagePct)}`}>
                    {fmtPct(p.quoteSlippagePct, 0)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-white/55 text-xs">
                    {p.openInterest != null
                      ? p.openInterest.toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/research/risk-graph?${legsToUrlParams({
                        ticker: p.symbol,
                        strategy: "sell-put",
                        expiry: p.expiration,
                        legs: [
                          { side: "sell", type: "put", strike: p.strike },
                        ],
                      })}`}
                      className="inline-block rounded border border-amber-500/40 bg-amber-500/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-widest text-amber-300 hover:bg-amber-500/15 transition-colors"
                      title={`Open Risk Graph with sell ${p.strike}P pre-loaded`}
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

      <p className="text-[11px] text-white/45 leading-relaxed max-w-3xl">
        <strong className="text-emerald-300">Ranking model:</strong> Expected
        ROI score = P(profit) × (credit / close), where P(profit) is the
        risk-neutral Black-Scholes probability that the stock closes
        above breakeven (= strike − credit) at expiry. Higher is better.
        Annualized ROI scales credit/close by 365/DTE. Cushion is the %
        distance the stock can drop before the trade goes negative at
        expiry. Slippage is the bid-ask gap as a % of ask — lower means
        cleaner execution. Verify each pick in your broker before
        trading; mid-prices and current snapshots can differ from your
        fill.
      </p>
    </section>
  );
}
