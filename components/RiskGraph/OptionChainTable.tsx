"use client";

/**
 * Option chain table — calls left, strikes middle, puts right.
 *
 * Each row shows (call) bid/ask/mid, IV, delta, OI, vol — strike —
 * (put) bid/ask/mid, IV, delta, OI, vol. The +/− buttons on each
 * side bubble up an add-leg event to the builder.
 *
 * Strikes are filtered to ±20% of spot by default so the table
 * doesn't blow up to 100+ rows on liquid names. User can toggle to
 * see all strikes.
 */

import { useState } from "react";

export interface ChainRow {
  contractTicker: string;
  strike: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  openInterest: number | null;
  volume: number | null;
}

interface Props {
  expiry: string;
  spot: number;
  calls: ChainRow[];
  puts: ChainRow[];
  onAdd: (
    row: ChainRow,
    expiration: string,
    type: "call" | "put",
    side: "long" | "short",
  ) => void;
}

function fmtUsd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}
function fmtPct(v: number | null, decimals = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(decimals)}%`;
}
function fmtNum(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString();
}

export default function OptionChainTable({
  expiry,
  spot,
  calls,
  puts,
  onAdd,
}: Props) {
  const [showAll, setShowAll] = useState(false);

  // Union of strikes from calls + puts.
  const strikes = [...new Set([...calls.map((c) => c.strike), ...puts.map((p) => p.strike)])]
    .sort((a, b) => a - b);

  const filtered = showAll
    ? strikes
    : strikes.filter((s) => s >= spot * 0.8 && s <= spot * 1.2);

  const callByStrike = new Map(calls.map((c) => [c.strike, c]));
  const putByStrike = new Map(puts.map((p) => [p.strike, p]));

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-3 py-2 border-b border-white/10">
        <div className="text-xs uppercase tracking-widest text-white/55">
          Chain · {expiry} · ${spot.toFixed(2)} spot
        </div>
        <button
          onClick={() => setShowAll((s) => !s)}
          className="text-[10px] uppercase tracking-widest text-white/55 hover:text-white"
        >
          {showAll ? "Filter to ±20%" : "Show all strikes"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[9px] uppercase tracking-widest text-white/45 bg-white/[0.02]">
            <tr>
              {/* Calls (LEFT) */}
              <th className="px-2 py-1.5 text-left" colSpan={2}>Buy / Sell</th>
              <th className="px-2 py-1.5 text-right">Bid</th>
              <th className="px-2 py-1.5 text-right">Ask</th>
              <th className="px-2 py-1.5 text-right">Δ</th>
              <th className="px-2 py-1.5 text-right">IV</th>
              <th className="px-2 py-1.5 text-right">OI</th>
              {/* Strike */}
              <th className="px-3 py-1.5 text-center bg-white/[0.04]">Strike</th>
              {/* Puts (RIGHT) */}
              <th className="px-2 py-1.5 text-right">OI</th>
              <th className="px-2 py-1.5 text-right">IV</th>
              <th className="px-2 py-1.5 text-right">Δ</th>
              <th className="px-2 py-1.5 text-right">Bid</th>
              <th className="px-2 py-1.5 text-right">Ask</th>
              <th className="px-2 py-1.5 text-right" colSpan={2}>Buy / Sell</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {filtered.map((strike) => {
              const call = callByStrike.get(strike);
              const put = putByStrike.get(strike);
              const isAtm =
                Math.abs(strike - spot) < (filtered[1] - filtered[0]) / 2 || false;
              return (
                <tr
                  key={strike}
                  className={[
                    "border-t border-white/5",
                    isAtm ? "bg-amber-500/[0.05]" : "",
                  ].join(" ")}
                >
                  {/* CALL +/- */}
                  <td className="px-1 py-1">
                    <button
                      onClick={() => call && onAdd(call, expiry, "call", "long")}
                      disabled={!call}
                      className="w-7 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-30 text-[10px]"
                      title="Buy call"
                    >
                      +
                    </button>
                  </td>
                  <td className="px-1 py-1">
                    <button
                      onClick={() => call && onAdd(call, expiry, "call", "short")}
                      disabled={!call}
                      className="w-7 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/15 disabled:opacity-30 text-[10px]"
                      title="Sell call"
                    >
                      −
                    </button>
                  </td>
                  <td className="px-2 py-1 text-right text-white/85">{fmtUsd(call?.bid ?? null)}</td>
                  <td className="px-2 py-1 text-right text-white/85">{fmtUsd(call?.ask ?? null)}</td>
                  <td className="px-2 py-1 text-right text-white/65">{call?.delta != null ? call.delta.toFixed(2) : "—"}</td>
                  <td className="px-2 py-1 text-right text-white/65">{fmtPct(call?.iv ?? null)}</td>
                  <td className="px-2 py-1 text-right text-white/45">{fmtNum(call?.openInterest ?? null)}</td>
                  {/* STRIKE */}
                  <td className="px-3 py-1 text-center bg-white/[0.04] font-bold text-white">
                    {strike >= 100 ? strike.toFixed(0) : strike.toFixed(2)}
                  </td>
                  {/* PUT side mirror */}
                  <td className="px-2 py-1 text-right text-white/45">{fmtNum(put?.openInterest ?? null)}</td>
                  <td className="px-2 py-1 text-right text-white/65">{fmtPct(put?.iv ?? null)}</td>
                  <td className="px-2 py-1 text-right text-white/65">{put?.delta != null ? put.delta.toFixed(2) : "—"}</td>
                  <td className="px-2 py-1 text-right text-white/85">{fmtUsd(put?.bid ?? null)}</td>
                  <td className="px-2 py-1 text-right text-white/85">{fmtUsd(put?.ask ?? null)}</td>
                  <td className="px-1 py-1">
                    <button
                      onClick={() => put && onAdd(put, expiry, "put", "long")}
                      disabled={!put}
                      className="w-7 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-30 text-[10px]"
                      title="Buy put"
                    >
                      +
                    </button>
                  </td>
                  <td className="px-1 py-1">
                    <button
                      onClick={() => put && onAdd(put, expiry, "put", "short")}
                      disabled={!put}
                      className="w-7 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/15 disabled:opacity-30 text-[10px]"
                      title="Sell put"
                    >
                      −
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
