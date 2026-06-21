"use client";

/**
 * Renders the top-ranked squeeze candidates from one weekly squeeze_scans
 * row. Client component so we can do master-detail row expansion: clicking
 * a candidate row reveals a full-width row underneath with all three trade
 * idea cards in a side-by-side grid. Only one row is expanded at a time.
 */
import { Fragment, useState } from "react";
import type { SqueezeScan, SqueezeCandidate, SqueezeTradeIdea } from "@/lib/db/schema";
import { legsToUrlParams } from "@/lib/earnings-trade-builder";

/** Build the /research/risk-graph URL that auto-loads this trade idea
 *  into the builder. Reuses the same prefill encoder Earnings Scans /
 *  LEAPs / Options Edge already use, so Risk Graph parses it for free.
 *
 *  For single-expiry strategies (long call, bull call spread) we hand a
 *  payload expiry plus bare leg strikes. For the diagonal we set the
 *  payload expiry to the long leg AND tag the short leg with `@<expiry>`
 *  so RiskGraphBuilder lands it on the front month. */
function tradeIdeaToUrl(ticker: string, idea: SqueezeTradeIdea): string {
  const longLeg = idea.legs.find((l) => l.side === "long") ?? idea.legs[0];
  const primaryExpiry = longLeg?.expiration ?? "";
  const expiries = new Set(idea.legs.map((l) => l.expiration));
  const multiExpiry = expiries.size > 1;
  return `/research/risk-graph?${legsToUrlParams({
    ticker,
    strategy: idea.strategy,
    expiry: primaryExpiry,
    legs: idea.legs.map((l) => ({
      side: l.side === "long" ? "buy" : "sell",
      type: l.type,
      strike: l.strike,
      // Only emit per-leg @expiry when legs straddle different months.
      expiry: multiExpiry ? l.expiration : undefined,
    })),
  })}`;
}

function fmtPct(v: number | null, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = signed && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}
function fmtPrice(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function pctClass(v: number | null): string {
  if (v == null) return "text-black/50 dark:text-white/50";
  if (v > 0) return "text-emerald-600 dark:text-emerald-400";
  if (v < 0) return "text-red-600 dark:text-red-400";
  return "text-black/60 dark:text-white/60";
}

function TradeIdeaCard({ idea, ticker }: { idea: SqueezeTradeIdea; ticker: string }) {
  const strategyLabel = {
    long_call: "Long call",
    bull_call_spread: "Bull call spread",
    diagonal_call: "Diagonal",
  }[idea.strategy];
  return (
    <div className="rounded border border-black/10 dark:border-white/10 px-3 py-2.5 text-xs space-y-1.5 bg-black/[0.02] dark:bg-white/[0.02]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-black/85 dark:text-white/85 text-sm">{strategyLabel}</span>
        <span className="font-mono text-black/50 dark:text-white/50">{idea.dte}d</span>
      </div>
      <div className="text-black/65 dark:text-white/65 font-mono">{idea.label}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-black/55 dark:text-white/55">
        {idea.netDebit != null && <span>debit ${idea.netDebit.toFixed(2)}</span>}
        {idea.maxProfit != null && <span>max profit ${idea.maxProfit.toFixed(0)}</span>}
        {idea.maxLoss != null && <span>max loss ${idea.maxLoss.toFixed(0)}</span>}
        {idea.breakeven != null && <span>BE ${idea.breakeven.toFixed(2)}</span>}
      </div>
      <div className="text-black/55 dark:text-white/55 italic leading-snug">{idea.notes}</div>
      <a
        href={tradeIdeaToUrl(ticker, idea)}
        className="inline-block mt-0.5 underline text-emerald-700 dark:text-emerald-400 text-[11px]"
      >
        Open in Risk Graph →
      </a>
    </div>
  );
}

function scoreBadge(score: number): string {
  if (score >= 75) return "bg-red-500/20 text-red-700 dark:text-red-300 ring-1 ring-red-500/40";
  if (score >= 60) return "bg-amber-500/20 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/40";
  if (score >= 45) return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 ring-1 ring-yellow-500/30";
  return "bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60";
}

// Columns rendered (drives colSpan for the expanded detail row).
const TOTAL_COLS = 11;

export default function SqueezeView({ scan }: { scan: SqueezeScan }) {
  const candidates: SqueezeCandidate[] = scan.candidates ?? [];
  const [expanded, setExpanded] = useState<string | null>(null);

  if (candidates.length === 0) {
    return (
      <div className="rounded-lg border border-black/10 dark:border-white/10 p-8 text-center space-y-2">
        <h1 className="text-xl font-semibold">No Short Interest Squeeze candidates this scan</h1>
        <p className="text-sm text-black/60 dark:text-white/60 max-w-prose mx-auto">
          The {scan.universeSize}-name universe scanned this Sunday produced no names that cleared the
          filter bar (SI ≥ 10% of shares outstanding OR days-to-cover ≥ 3). Crowded
          shorts dried up across the watchlist this week.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Short Interest Squeeze</h1>
          <div className="text-xs text-black/50 dark:text-white/50">
            scan {scan.scanDay} · {scan.rankedSize} of {scan.universeSize} universe ranked
          </div>
        </div>
        <p className="text-sm text-black/60 dark:text-white/60">
          Weekly scan of high-short-interest candidates from a curated {scan.universeSize}-name
          universe. Composite score blends SI% of shares outstanding, days-to-cover,
          5-day price momentum, and IV rank. <strong>This is a watchlist, not a buy
          list</strong> — FINRA short interest is bi-monthly with a ~3-week lag, and
          we don&apos;t have cost-to-borrow signal so &quot;crowded&quot; doesn&apos;t
          always mean &quot;actively bleeding.&quot;
        </p>
        <p className="text-xs text-black/45 dark:text-white/45 pt-1">
          Click a row to view suggested option trade ideas (long call / bull call spread / diagonal).
          Trade ideas are generated for the top 10 candidates only.
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg ring-1 ring-black/10 dark:ring-white/10">
        <table className="w-full text-sm">
          <thead className="bg-black/[0.03] dark:bg-white/[0.03] text-[10px] uppercase tracking-wider text-black/55 dark:text-white/55">
            <tr>
              <th className="text-left px-3 py-2 w-8"></th>
              <th className="text-left px-3 py-2 w-8">#</th>
              <th className="text-left px-3 py-2">Ticker</th>
              <th className="text-left px-3 py-2 hidden sm:table-cell">Company</th>
              <th className="text-center px-3 py-2">Score</th>
              <th className="text-right px-3 py-2">SI%</th>
              <th className="text-right px-3 py-2">DTC</th>
              <th className="text-right px-3 py-2">5d</th>
              <th className="text-right px-3 py-2 hidden md:table-cell">30d</th>
              <th className="text-right px-3 py-2 hidden lg:table-cell">IV rank</th>
              <th className="text-right px-3 py-2">Price</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c, i) => {
              const ideas = c.tradeIdeas ?? [];
              const isExpanded = expanded === c.ticker;
              const hasIdeas = ideas.length > 0;
              return (
                <Fragment key={c.ticker}>
                  <tr
                    onClick={() => hasIdeas && setExpanded(isExpanded ? null : c.ticker)}
                    className={[
                      "border-t border-black/5 dark:border-white/5 transition-colors",
                      hasIdeas ? "cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02]" : "",
                      isExpanded ? "bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06]" : "",
                    ].join(" ")}
                  >
                    <td className="px-3 py-2 text-center text-black/40 dark:text-white/40 select-none">
                      {hasIdeas ? (isExpanded ? "▾" : "▸") : ""}
                    </td>
                    <td className="px-3 py-2 text-black/40 dark:text-white/40 tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2 font-mono font-bold">{c.ticker}</td>
                    <td className="px-3 py-2 text-black/60 dark:text-white/60 hidden sm:table-cell truncate max-w-[260px]">
                      {c.companyName ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded font-mono text-xs font-semibold ${scoreBadge(c.compositeScore)}`}>
                        {c.compositeScore.toFixed(0)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPct(c.shortInterestPctSO)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.daysToCover.toFixed(1)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${pctClass(c.priceChange5dPct)}`}>
                      {fmtPct(c.priceChange5dPct, true)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums hidden md:table-cell ${pctClass(c.priceChange30dPct)}`}>
                      {fmtPct(c.priceChange30dPct, true)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums hidden lg:table-cell text-black/60 dark:text-white/60">
                      {c.atmIvRank != null ? c.atmIvRank.toFixed(0) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPrice(c.lastClose)}</td>
                  </tr>
                  {isExpanded && hasIdeas && (
                    <tr className="bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06]">
                      <td colSpan={TOTAL_COLS} className="px-4 py-4">
                        <div className="space-y-2">
                          <div className="text-[10px] uppercase tracking-widest text-emerald-700 dark:text-emerald-400 font-semibold">
                            {c.ticker} — suggested trade ideas
                          </div>
                          {c.thesis && (
                            <p className="text-xs text-black/70 dark:text-white/70 italic">{c.thesis}</p>
                          )}
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                            {ideas.map((idea) => (
                              <TradeIdeaCard key={idea.strategy} idea={idea} ticker={c.ticker} />
                            ))}
                          </div>
                          <div className="text-[10px] text-black/45 dark:text-white/45 pt-1">
                            SI settlement {c.siSettlementDate} · last close {fmtPrice(c.lastClose)} · 30d
                            return <span className={pctClass(c.priceChange30dPct)}>{fmtPct(c.priceChange30dPct, true)}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="text-xs text-black/60 dark:text-white/60 space-y-2">
        <summary className="cursor-pointer font-semibold text-black/70 dark:text-white/70 select-none">
          How the composite score works
        </summary>
        <div className="mt-2 space-y-2 pl-1">
          <p>
            Each candidate gets four 0-100 sub-scores blended into a single composite:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>SI% (weight 35)</strong> — short interest ÷ shares outstanding, ramped 10% → 40%</li>
            <li><strong>DTC (weight 25)</strong> — days to cover (SI ÷ ADV), ramped 2 → 10</li>
            <li><strong>Momentum (weight 20)</strong> — 5-day total return, ramped −5% → +15%</li>
            <li><strong>IV rank (weight 20)</strong> — current 30d ATM IV percentile vs 1y history; neutral 50 when not covered by IV scan</li>
          </ul>
          <p className="text-black/50 dark:text-white/50">
            Score ≥ 75 = red badge (high conviction). 60-75 amber (worth watching). 45-60 yellow
            (on the radar). Below 45 grey.
          </p>
        </div>
      </details>

      <p className="text-[11px] text-black/40 dark:text-white/40 leading-relaxed">
        Data: FINRA short interest (bi-monthly, ~3-week lag) via Polygon. Shares outstanding from
        Polygon ticker overview. Price + volume from Polygon aggregates. IV rank from in-house
        iv_snapshots scan. We do <strong>not</strong> have real-time cost-to-borrow or utilization
        data — that would require Ortex / S3 Partners / Fintel integration.
      </p>
    </section>
  );
}
