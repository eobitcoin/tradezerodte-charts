"use client";

/**
 * Position builder — sidebar listing the legs the user has added.
 *
 * Each row shows side chip (B/S), qty input, type/strike/expiry,
 * entry price, IV. Qty and entry price are editable; entry IV is
 * read-only (taken from the chain at add-time). Trash icon removes
 * the leg.
 */

import type { PositionLeg } from "./RiskGraphBuilder";

interface Props {
  legs: PositionLeg[];
  onUpdateLeg: (idx: number, patch: Partial<PositionLeg>) => void;
  onRemoveLeg: (idx: number) => void;
  onClear: () => void;
}

function fmtExpiry(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

/** True when bid/ask exists and (ask − bid) / mid > 20% — i.e. the
 *  midpoint is unreliable and we should flag the leg. */
function wideSpread(leg: PositionLeg): boolean {
  const bid = leg.entryBid;
  const ask = leg.entryAsk;
  if (
    typeof bid !== "number" || bid <= 0 ||
    typeof ask !== "number" || ask <= bid ||
    !leg.entryPrice || leg.entryPrice <= 0
  ) {
    return false;
  }
  return (ask - bid) / leg.entryPrice > 0.20;
}

export default function PositionBuilderPanel({
  legs,
  onUpdateLeg,
  onRemoveLeg,
  onClear,
}: Props) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs uppercase tracking-widest text-white/55">
          Position ({legs.length} {legs.length === 1 ? "leg" : "legs"})
        </h2>
        {legs.length > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] uppercase tracking-widest text-white/45 hover:text-rose-300"
          >
            Clear
          </button>
        )}
      </div>
      {legs.length === 0 ? (
        <p className="text-xs text-white/45 italic py-3">
          No legs yet. Click <span className="text-emerald-300">+</span> /{" "}
          <span className="text-rose-300">−</span> on the chain to buy / sell.
        </p>
      ) : (
        <ul className="space-y-2">
          {legs.map((leg, i) => (
            <li
              key={`${leg.contractTicker}-${i}`}
              className="rounded border border-white/10 bg-white/[0.02] p-2 space-y-1.5"
            >
              <div className="flex items-baseline gap-2 flex-wrap text-xs">
                <span
                  className={[
                    "px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-widest font-semibold",
                    leg.side === "long"
                      ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/[0.08]"
                      : "border-rose-500/40 text-rose-300 bg-rose-500/[0.08]",
                  ].join(" ")}
                >
                  {leg.side === "long" ? "BUY" : "SELL"}
                </span>
                <input
                  type="number"
                  min={1}
                  value={leg.qty}
                  onChange={(e) =>
                    onUpdateLeg(i, {
                      qty: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                  className="w-12 rounded border border-white/15 bg-black/20 px-1 py-0.5 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                />
                <span className="font-mono text-white/90">
                  ${leg.strike >= 100 ? leg.strike.toFixed(0) : leg.strike.toFixed(2)}
                  {leg.type === "call" ? "C" : "P"}
                </span>
                <span className="font-mono text-white/55">
                  {fmtExpiry(leg.expiration)}
                </span>
                <button
                  onClick={() => onRemoveLeg(i)}
                  className="ml-auto text-rose-400 hover:text-rose-300 px-1 text-sm"
                  title="Remove leg"
                >
                  ×
                </button>
              </div>
              <div className="flex items-baseline gap-2 text-[10px] text-white/55 flex-wrap">
                <label className="flex items-baseline gap-1">
                  <span className="uppercase tracking-widest text-white/45">
                    Entry $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={leg.entryPrice}
                    onChange={(e) =>
                      onUpdateLeg(i, {
                        entryPrice: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="w-16 rounded border border-white/15 bg-black/20 px-1 py-0.5 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                  />
                </label>
                <span className="text-white/40">·</span>
                <span>IV {(leg.entryIv * 100).toFixed(0)}%</span>
                {wideSpread(leg) && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-300 bg-amber-500/[0.08] text-[9px] uppercase tracking-widest"
                    title={`Bid ${leg.entryBid?.toFixed(2)} / Ask ${leg.entryAsk?.toFixed(2)} — spread is ${((((leg.entryAsk ?? 0) - (leg.entryBid ?? 0)) / leg.entryPrice) * 100).toFixed(0)}% of mid. The mid is unreliable; verify on your broker before trading.`}
                  >
                    ! wide
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
