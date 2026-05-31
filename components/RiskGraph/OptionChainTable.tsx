"use client";

/**
 * Option chain table — calls left, strikes middle, puts right.
 *
 *   - Bold "CALLS" / "PUTS" headers above each side so column ownership
 *     is unmistakable
 *   - Subtle emerald/rose column tint reinforces it visually
 *   - Wide-spread warning chip (▲) on rows where (ask − bid) / mid > 20%
 *     — flags contracts where the displayed mid is unreliable
 *   - Strikes filtered to ±20% of spot by default; toggle to show all
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

/** Subset of PositionLeg used by the chain table to compute net qty
 *  per strike. Decoupled so OptionChainTable doesn't import from
 *  RiskGraphBuilder (avoids a circular dep). */
export interface ChainTableLeg {
  type: "call" | "put";
  side: "long" | "short";
  strike: number;
  expiration: string;
  qty: number;
}

interface Props {
  expiry: string;
  spot: number;
  calls: ChainRow[];
  puts: ChainRow[];
  /** Current position legs — used to render the # column showing
   *  current net qty for each strike's calls and puts at this expiry. */
  legs: ChainTableLeg[];
  onAdd: (
    row: ChainRow,
    expiration: string,
    type: "call" | "put",
    side: "long" | "short",
  ) => void;
}

const WIDE_SPREAD_THRESHOLD = 0.20; // 20%

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

/** Spread % from bid/ask/mid. Returns null when math is degenerate. */
function spreadPct(row: ChainRow | undefined): number | null {
  if (!row) return null;
  if (
    typeof row.bid !== "number" || row.bid <= 0 ||
    typeof row.ask !== "number" || row.ask <= row.bid ||
    typeof row.mid !== "number" || row.mid <= 0
  ) {
    return null;
  }
  return (row.ask - row.bid) / row.mid;
}

function WideSpreadIcon({ pct }: { pct: number | null }) {
  if (pct == null || pct < WIDE_SPREAD_THRESHOLD) return null;
  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-amber-500/50 text-amber-300 text-[8px] font-bold leading-none"
      title={`Wide spread: ${(pct * 100).toFixed(0)}% — bid/ask are far apart, so the displayed mid is unreliable. Verify on your broker.`}
    >
      !
    </span>
  );
}

/** Compute signed net qty for a given (strike, expiry, type) across
 *  the position. Positive = long; negative = short; 0 = no leg. */
function netQty(
  legs: ChainTableLeg[],
  strike: number,
  expiration: string,
  type: "call" | "put",
): number {
  let net = 0;
  for (const l of legs) {
    if (l.expiration !== expiration || l.type !== type || l.strike !== strike) continue;
    net += (l.side === "long" ? 1 : -1) * l.qty;
  }
  return net;
}

/** Render the # cell for either calls (left) or puts (right). */
function QtyCell({ qty }: { qty: number }) {
  if (qty === 0) {
    return <span className="text-white/25">·</span>;
  }
  const tone =
    qty > 0
      ? "text-emerald-300 bg-emerald-500/[0.12] border-emerald-500/40"
      : "text-rose-300 bg-rose-500/[0.12] border-rose-500/40";
  return (
    <span
      className={`inline-block min-w-[28px] px-1 rounded border font-bold text-[11px] ${tone}`}
    >
      {qty > 0 ? `+${qty}` : qty}
    </span>
  );
}

export default function OptionChainTable({
  expiry,
  spot,
  calls,
  puts,
  legs,
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
          {/* Section header: CALLS · STRIKE · PUTS */}
          <thead>
            <tr>
              <th
                colSpan={8}
                className="px-3 py-1.5 text-center text-[10px] uppercase tracking-[0.2em] font-bold text-emerald-300 bg-emerald-500/[0.07] border-b border-emerald-500/30"
              >
                Calls
              </th>
              <th className="bg-white/[0.06] border-b border-white/10" />
              <th
                colSpan={8}
                className="px-3 py-1.5 text-center text-[10px] uppercase tracking-[0.2em] font-bold text-rose-300 bg-rose-500/[0.07] border-b border-rose-500/30"
              >
                Puts
              </th>
            </tr>
            {/* Column labels */}
            <tr className="text-[9px] uppercase tracking-widest text-white/45 bg-white/[0.02]">
              <th className="px-2 py-1.5 text-center bg-emerald-500/[0.04] border-r border-emerald-500/20">#</th>
              <th className="px-2 py-1.5 text-left bg-emerald-500/[0.025]" colSpan={2}>Buy / Sell</th>
              <th className="px-2 py-1.5 text-right bg-emerald-500/[0.025]">Bid</th>
              <th className="px-2 py-1.5 text-right bg-emerald-500/[0.025]">Ask</th>
              <th className="px-2 py-1.5 text-right bg-emerald-500/[0.025]">Δ</th>
              <th className="px-2 py-1.5 text-right bg-emerald-500/[0.025]">IV</th>
              <th className="px-2 py-1.5 text-right bg-emerald-500/[0.025]">OI</th>
              <th className="px-3 py-1.5 text-center bg-white/[0.06]">Strike</th>
              <th className="px-2 py-1.5 text-right bg-rose-500/[0.025]">OI</th>
              <th className="px-2 py-1.5 text-right bg-rose-500/[0.025]">IV</th>
              <th className="px-2 py-1.5 text-right bg-rose-500/[0.025]">Δ</th>
              <th className="px-2 py-1.5 text-right bg-rose-500/[0.025]">Bid</th>
              <th className="px-2 py-1.5 text-right bg-rose-500/[0.025]">Ask</th>
              <th className="px-2 py-1.5 text-right bg-rose-500/[0.025]" colSpan={2}>Buy / Sell</th>
              <th className="px-2 py-1.5 text-center bg-rose-500/[0.04] border-l border-rose-500/20">#</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {filtered.map((strike) => {
              const call = callByStrike.get(strike);
              const put = putByStrike.get(strike);
              const callSpread = spreadPct(call);
              const putSpread = spreadPct(put);
              const stepSize = filtered.length > 1 ? filtered[1] - filtered[0] : 1;
              const isAtm = Math.abs(strike - spot) < stepSize / 2;
              const callQty = netQty(legs, strike, expiry, "call");
              const putQty = netQty(legs, strike, expiry, "put");
              return (
                <tr
                  key={strike}
                  className={[
                    "border-t border-white/5",
                    isAtm ? "ring-1 ring-amber-500/30" : "",
                  ].join(" ")}
                >
                  {/* CALL # cell */}
                  <td className="px-2 py-1 text-center bg-emerald-500/[0.04] border-r border-emerald-500/15">
                    <QtyCell qty={callQty} />
                  </td>
                  {/* CALL +/- */}
                  <td className="px-1 py-1 bg-emerald-500/[0.025]">
                    <button
                      onClick={() => call && onAdd(call, expiry, "call", "long")}
                      disabled={!call}
                      className="w-7 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-30 text-[10px]"
                      title="Buy call"
                    >
                      +
                    </button>
                  </td>
                  <td className="px-1 py-1 bg-emerald-500/[0.025]">
                    <button
                      onClick={() => call && onAdd(call, expiry, "call", "short")}
                      disabled={!call}
                      className="w-7 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/15 disabled:opacity-30 text-[10px]"
                      title="Sell call"
                    >
                      −
                    </button>
                  </td>
                  <td className="px-2 py-1 text-right text-white/85 bg-emerald-500/[0.025]">{fmtUsd(call?.bid ?? null)}</td>
                  <td className="px-2 py-1 text-right text-white/85 bg-emerald-500/[0.025]">{fmtUsd(call?.ask ?? null)}</td>
                  <td className="px-2 py-1 text-right text-white/65 bg-emerald-500/[0.025]">{call?.delta != null ? call.delta.toFixed(2) : "—"}</td>
                  <td className="px-2 py-1 text-right text-white/65 bg-emerald-500/[0.025]">{fmtPct(call?.iv ?? null)}</td>
                  <td className="px-2 py-1 text-right text-white/45 bg-emerald-500/[0.025]">{fmtNum(call?.openInterest ?? null)}</td>
                  {/* STRIKE */}
                  <td className="px-3 py-1 text-center bg-white/[0.06] font-bold text-white">
                    <div className="flex items-center justify-center gap-1.5">
                      <WideSpreadIcon pct={callSpread} />
                      <span>{strike >= 100 ? strike.toFixed(0) : strike.toFixed(2)}</span>
                      <WideSpreadIcon pct={putSpread} />
                    </div>
                  </td>
                  {/* PUT side mirror */}
                  <td className="px-2 py-1 text-right text-white/45 bg-rose-500/[0.025]">{fmtNum(put?.openInterest ?? null)}</td>
                  <td className="px-2 py-1 text-right text-white/65 bg-rose-500/[0.025]">{fmtPct(put?.iv ?? null)}</td>
                  <td className="px-2 py-1 text-right text-white/65 bg-rose-500/[0.025]">{put?.delta != null ? put.delta.toFixed(2) : "—"}</td>
                  <td className="px-2 py-1 text-right text-white/85 bg-rose-500/[0.025]">{fmtUsd(put?.bid ?? null)}</td>
                  <td className="px-2 py-1 text-right text-white/85 bg-rose-500/[0.025]">{fmtUsd(put?.ask ?? null)}</td>
                  <td className="px-1 py-1 bg-rose-500/[0.025]">
                    <button
                      onClick={() => put && onAdd(put, expiry, "put", "long")}
                      disabled={!put}
                      className="w-7 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-30 text-[10px]"
                      title="Buy put"
                    >
                      +
                    </button>
                  </td>
                  <td className="px-1 py-1 bg-rose-500/[0.025]">
                    <button
                      onClick={() => put && onAdd(put, expiry, "put", "short")}
                      disabled={!put}
                      className="w-7 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/15 disabled:opacity-30 text-[10px]"
                      title="Sell put"
                    >
                      −
                    </button>
                  </td>
                  {/* PUT # cell */}
                  <td className="px-2 py-1 text-center bg-rose-500/[0.04] border-l border-rose-500/15">
                    <QtyCell qty={putQty} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2 border-t border-white/10 text-[10px] text-white/45 flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-amber-500/50 text-amber-300 text-[8px] font-bold leading-none">
          !
        </span>
        <span>= bid/ask spread &gt; 20% — the displayed mid is unreliable, especially outside market hours</span>
      </div>
    </div>
  );
}
