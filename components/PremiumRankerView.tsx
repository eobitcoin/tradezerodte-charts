"use client";

/**
 * Premium Ranker view. Top: 3 headline trade cards (naked put + credit
 * spread, each deep-linked into Risk Graph). Below: the ranked table —
 * sortable by IV (default) or by short-put annualized premium, the two
 * rankings the scan produces.
 */
import { useMemo, useState } from "react";
import type {
  PremiumRankerScanData,
  PremiumRankerRow,
  PremiumRankerSuggestion,
} from "@/lib/db/schema";
import { legsToUrlParams } from "@/lib/earnings-trade-builder";

interface Props {
  scanDay: string;
  universeSize: number;
  computedSize: number;
  data: PremiumRankerScanData;
}

function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}
function fmtIv(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}
function fmtPct(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(d)}%`;
}
function fmtProb(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}
function fmtVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}
function fmtExpiry(iso: string): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

/** Build a Risk Graph deep-link for a single short put or a put credit spread. */
function riskGraphUrl(opts: {
  symbol: string;
  expiration: string;
  legs: Array<{ side: "buy" | "sell"; type: "call" | "put"; strike: number }>;
  strategy: string;
}): string {
  return `/research/risk-graph?${legsToUrlParams({
    ticker: opts.symbol,
    strategy: opts.strategy,
    expiry: opts.expiration,
    legs: opts.legs,
  })}`;
}

type SortKey = "iv" | "premium";

export default function PremiumRankerView({ scanDay, universeSize, computedSize, data }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("iv");

  const rows = useMemo(() => {
    const r = [...data.rows];
    if (sortKey === "iv") r.sort((a, b) => b.atmIv - a.atmIv);
    else r.sort((a, b) => (b.bestPut?.annualizedReturnPct ?? -1) - (a.bestPut?.annualizedReturnPct ?? -1));
    return r;
  }, [data.rows, sortKey]);

  return (
    <div className="space-y-6">
      {/* Headline suggestions */}
      {data.suggestions.length > 0 && (
        <section className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-amber-400">
            Top 3 premium-selling setups
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {data.suggestions.map((s) => (
              <SuggestionCard key={s.symbol} s={s} />
            ))}
          </div>
        </section>
      )}

      {/* Ranked table */}
      <section className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-[10px] uppercase tracking-widest text-amber-400">
            Ranked universe · {computedSize} of {universeSize} scanned names with usable IV
          </div>
          <div className="inline-flex rounded-md ring-1 ring-white/15 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setSortKey("iv")}
              className={`px-3 py-1 font-semibold ${sortKey === "iv" ? "bg-amber-500/20 text-amber-300" : "text-white/55 hover:text-white"}`}
            >
              Highest IV
            </button>
            <button
              type="button"
              onClick={() => setSortKey("premium")}
              className={`px-3 py-1 font-semibold ${sortKey === "premium" ? "bg-amber-500/20 text-amber-300" : "text-white/55 hover:text-white"}`}
            >
              Highest premium
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg ring-1 ring-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider text-white/55">
              <tr>
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Ticker</th>
                <th className="text-right px-3 py-2">Price</th>
                <th className="text-right px-3 py-2 hidden sm:table-cell">Volume</th>
                <th className="text-right px-3 py-2">IV</th>
                <th className="text-right px-3 py-2 hidden lg:table-cell">IV rank</th>
                <th className="text-right px-3 py-2 hidden md:table-cell">Straddle</th>
                <th className="text-right px-3 py-2 hidden md:table-cell">Best put</th>
                <th className="text-right px-3 py-2">Credit</th>
                <th className="text-right px-3 py-2">Ann. %</th>
                <th className="text-right px-3 py-2 hidden sm:table-cell">PoP</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Row key={r.symbol} r={r} idx={i + 1} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="text-[11px] text-white/40 leading-relaxed space-y-1">
        <p>
          Scan {scanDay}. Universe: every US stock in the Polygon snapshot priced ≥ ${data.filters.minPrice}
          {" "}with daily volume &gt; {data.filters.minDayVolume.toLocaleString()} and listed options. ATM IV is the
          average of the nearest-to-spot {data.filters.dteMin}–{data.filters.dteMax} DTE call + put implied vol.
          &quot;Best put&quot; maximizes P(profit) × credit% in that DTE window; annualized % = credit/spot × 365/DTE.
        </p>
        <p>
          Not advice. Premium selling carries assignment + tail risk — a high annualized number usually means high IV
          for a reason (earnings, event, or a falling knife). Size accordingly.
        </p>
      </footer>
    </div>
  );
}

function Row({ r, idx }: { r: PremiumRankerRow; idx: number }) {
  const bp = r.bestPut;
  const rgUrl = bp
    ? riskGraphUrl({
        symbol: r.symbol,
        expiration: bp.expiration,
        strategy: "naked_put",
        legs: [{ side: "sell", type: "put", strike: bp.strike }],
      })
    : null;
  return (
    <tr className="border-t border-white/5 hover:bg-white/[0.02]">
      <td className="px-3 py-2 text-white/40 tabular-nums">{idx}</td>
      <td className="px-3 py-2 font-mono font-bold">{r.symbol}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(r.price)}</td>
      <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell text-white/55">{fmtVol(r.dayVolume)}</td>
      <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-300">{fmtIv(r.atmIv)}</td>
      <td className="px-3 py-2 text-right tabular-nums hidden lg:table-cell text-white/55">
        {r.ivRank != null ? r.ivRank.toFixed(0) : "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell text-white/55">{fmtPct(r.atmStraddlePct)}</td>
      <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell text-white/70">
        {bp ? `${bp.strike}P ${fmtExpiry(bp.expiration)}` : "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(bp?.credit)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{fmtPct(bp?.annualizedReturnPct, 0)}</td>
      <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell text-white/70">{fmtProb(bp?.probabilityOfProfit)}</td>
      <td className="px-3 py-2 text-right">
        {rgUrl && (
          <a href={rgUrl} className="text-[11px] text-amber-300 hover:underline whitespace-nowrap">
            Risk Graph →
          </a>
        )}
      </td>
    </tr>
  );
}

function SuggestionCard({ s }: { s: PremiumRankerSuggestion }) {
  const np = s.nakedPut;
  const cs = s.creditSpread;
  const nakedUrl = riskGraphUrl({
    symbol: s.symbol,
    expiration: np.expiration,
    strategy: "naked_put",
    legs: [{ side: "sell", type: "put", strike: np.strike }],
  });
  const spreadUrl = cs
    ? riskGraphUrl({
        symbol: s.symbol,
        expiration: cs.expiration,
        strategy: "put_credit_spread",
        legs: [
          { side: "sell", type: "put", strike: cs.shortStrike },
          { side: "buy", type: "put", strike: cs.longStrike },
        ],
      })
    : null;
  return (
    <article className="rounded-lg ring-1 ring-white/10 bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono font-bold text-lg">{s.symbol}</span>
        <span className="text-xs text-white/55">{fmtUsd(s.price)} · IV {fmtIv(s.atmIv)}</span>
      </div>
      <p className="text-xs text-white/65 leading-snug">{s.thesis}</p>

      <div className="rounded-md ring-1 ring-white/[0.08] bg-white/[0.02] p-2.5 space-y-1.5 text-xs">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold text-white/85">Naked put</span>
          <span className="font-mono text-white/55">{np.dteDays}d</span>
        </div>
        <div className="font-mono text-white/70">Sell {np.strike}P · {fmtExpiry(np.expiration)}</div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-white/55">
          <span>credit ${np.credit.toFixed(2)}</span>
          <span>BE ${np.breakeven.toFixed(2)}</span>
          {np.annualizedReturnPct != null && <span className="text-emerald-300">{np.annualizedReturnPct.toFixed(0)}% ann.</span>}
          <span>PoP {fmtProb(np.probabilityOfProfit)}</span>
        </div>
        <a href={nakedUrl} className="inline-block text-[11px] text-amber-300 hover:underline">Open in Risk Graph →</a>
      </div>

      {cs && (
        <div className="rounded-md ring-1 ring-white/[0.08] bg-white/[0.02] p-2.5 space-y-1.5 text-xs">
          <div className="flex items-baseline justify-between">
            <span className="font-semibold text-white/85">Put credit spread</span>
            <span className="font-mono text-white/55">def. risk</span>
          </div>
          <div className="font-mono text-white/70">{cs.shortStrike}/{cs.longStrike}P · {fmtExpiry(cs.expiration)}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-white/55">
            <span>credit ${cs.netCredit.toFixed(2)}</span>
            <span className="text-emerald-300">max +${cs.maxProfit.toFixed(0)}</span>
            <span className="text-red-300">max −${cs.maxLoss.toFixed(0)}</span>
            <span>BE ${cs.breakeven.toFixed(2)}</span>
          </div>
          {spreadUrl && <a href={spreadUrl} className="inline-block text-[11px] text-amber-300 hover:underline">Open in Risk Graph →</a>}
        </div>
      )}
    </article>
  );
}
