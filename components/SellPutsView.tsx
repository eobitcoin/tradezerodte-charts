"use client";

/**
 * Ranked Sell Puts view. Three sub-tabs (Balanced default, then
 * Conservative, Aggressive, All) filter by PoP tier so users can match
 * the picks to their risk philosophy:
 *
 *   Conservative — PoP ≥ 85%, sorted by annualized return desc.
 *                  Safety-first; lower premium, deeper OTM cushion.
 *   Balanced     — PoP 70-85%, sorted by expected ROI desc.
 *                  Wheel-strategy sweet spot.
 *   Aggressive   — PoP < 70%, sorted by expected ROI desc.
 *                  Fattest credit, thinnest cushion. ATM-ish.
 *   All          — Every tradeable pick across tiers.
 *
 * Each tier shows ONE pick per ticker (the best within that PoP band).
 * Skipped tickers (chain fetch failed, no candidates, etc.) are NOT
 * rendered.
 */

import { useState } from "react";
import Link from "next/link";
import type { SellPutPick, SellPutTier } from "@/lib/db/schema";
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

function tierBadgeTone(tier: SellPutTier): string {
  if (tier === "conservative")
    return "border-emerald-500/50 text-emerald-200 bg-emerald-500/[0.10]";
  if (tier === "balanced")
    return "border-amber-500/50 text-amber-200 bg-amber-500/[0.10]";
  return "border-rose-500/50 text-rose-300 bg-rose-500/[0.10]";
}

function slippageTone(s: number | null): string {
  if (s == null) return "text-white/55";
  if (s <= 5) return "text-emerald-300";
  if (s <= 15) return "text-amber-300";
  return "text-rose-300";
}

type TabKey = SellPutTier | "all";

const TABS: Array<{ id: TabKey; label: string; desc: string }> = [
  {
    id: "balanced",
    label: "Balanced",
    desc: "PoP 70–85% · sorted by Expected ROI · the wheel-strategy sweet spot",
  },
  {
    id: "conservative",
    label: "Conservative",
    desc: "PoP ≥ 85% · sorted by Annualized return · deeper OTM, smaller credit",
  },
  {
    id: "aggressive",
    label: "Aggressive",
    desc: "PoP < 70% · sorted by Expected ROI · fattest credit, thinnest cushion",
  },
  {
    id: "all",
    label: "All",
    desc: "Every tradeable pick across tiers (may show up to 3 per ticker)",
  },
];

export default function SellPutsView({
  scanDay,
  picks,
  universeSize,
  computedSize,
}: Props) {
  const [tab, setTab] = useState<TabKey>("balanced");

  const tradeable = picks.filter(
    (p) => !p.skipReason && p.expectedRoiScore != null,
  );
  // Tier-defaulting for back-compat with older scans pre-tier.
  const tieredTradeable = tradeable.map((p) => ({
    ...p,
    tier: (p.tier ?? "aggressive") as SellPutTier,
  }));

  const filtered =
    tab === "all"
      ? tieredTradeable
      : tieredTradeable.filter((p) => p.tier === tab);

  const tabCounts: Record<TabKey, number> = {
    conservative: tieredTradeable.filter((p) => p.tier === "conservative")
      .length,
    balanced: tieredTradeable.filter((p) => p.tier === "balanced").length,
    aggressive: tieredTradeable.filter((p) => p.tier === "aggressive")
      .length,
    all: tieredTradeable.length,
  };

  const activeTabMeta = TABS.find((t) => t.id === tab)!;

  return (
    <section className="space-y-4">
      <div className="text-sm text-white/55">
        Scan day · {fmtExpiry(scanDay)} · {computedSize} tickers with at
        least one tradeable pick of {universeSize} universe · 21–45 DTE
      </div>

      {/* Tier tabs */}
      <nav className="flex flex-wrap gap-1.5 border-b border-white/10 pb-2">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={[
                "px-3 py-1.5 rounded border text-xs uppercase tracking-widest font-semibold transition-colors flex items-center gap-1.5",
                active
                  ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
                  : "border-white/15 text-white/55 hover:border-white/30 hover:text-white",
              ].join(" ")}
            >
              <span>{t.label}</span>
              <span
                className={
                  active
                    ? "text-amber-200/65 font-mono text-[10px]"
                    : "text-white/35 font-mono text-[10px]"
                }
              >
                {tabCounts[t.id]}
              </span>
            </button>
          );
        })}
      </nav>
      <p className="text-xs text-white/55 italic">{activeTabMeta.desc}</p>

      {filtered.length === 0 ? (
        <p className="text-sm text-white/55 italic py-8 text-center">
          No picks in the {tab} tier this scan. Try a different tier or
          wait for the next Monday-evening refresh.
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
              {filtered.map((p, i) => (
                <tr key={`${p.symbol}-${p.contractTicker}`} className="hover:bg-white/[0.02]">
                  <td className="px-3 py-2 text-white/45 font-mono text-xs">
                    {i + 1}
                  </td>
                  <td className="px-3 py-2 font-mono font-bold">
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`/tickers/${p.symbol}`}
                        className="hover:underline"
                      >
                        {p.symbol}
                      </Link>
                      {tab === "all" && p.tier && (
                        <span
                          className={`text-[8px] uppercase tracking-widest px-1 py-px rounded border font-mono font-bold ${tierBadgeTone(p.tier)}`}
                        >
                          {p.tier.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
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
