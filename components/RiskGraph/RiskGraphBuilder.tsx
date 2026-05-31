"use client";

/**
 * Risk Graph builder — client-side state machine.
 *
 * Flow:
 *   1. User types a ticker → press Enter → fetch /api/options/chain/[T]
 *   2. Chain renders: expiry tabs at top, calls-strikes-puts table below
 *   3. User clicks +/− on rows to add legs → position builder fills
 *      in the right sidebar
 *   4. Position changes recompute the risk graph live (no submit needed)
 *   5. User can save the trade idea (requires name + signed-in user)
 *
 * State stays entirely in this one component so a re-fetch or slider
 * tweak re-renders the whole tree in one pass — no prop drilling.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { computeRiskGraph, type Leg } from "@/lib/risk-graph";
import OptionChainTable, { type ChainRow } from "./OptionChainTable";
import PositionBuilderPanel from "./PositionBuilderPanel";
import RiskGraphChart from "./RiskGraphChart";
import HeadlineStats from "./HeadlineStats";

export interface ChainExpiry {
  expiration: string;
  dteDays: number;
  calls: ChainRow[];
  puts: ChainRow[];
}

export interface ChainResponse {
  ticker: string;
  spot: number;
  asOf: string;
  expiries: ChainExpiry[];
}

/** Position builder state. Each entry corresponds to a Leg in the
 *  risk-graph math, with the contract ticker stored separately so we
 *  can re-fetch the same contract on the saved-idea detail page. */
export interface PositionLeg extends Leg {
  contractTicker: string;
}

interface Props {
  /** Optional pre-loaded chain + position — used by the "Saved trade
   *  idea" detail page to render the same UI but in read-only-ish
   *  mode (the position is pre-filled). */
  initial?: {
    chain: ChainResponse;
    legs: PositionLeg[];
    name?: string;
  };
}

export default function RiskGraphBuilder({ initial }: Props) {
  const router = useRouter();

  const [tickerInput, setTickerInput] = useState(initial?.chain.ticker ?? "");
  const [chain, setChain] = useState<ChainResponse | null>(initial?.chain ?? null);
  const [loadingChain, setLoadingChain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedExpiry, setSelectedExpiry] = useState<string | null>(
    initial?.chain.expiries[0]?.expiration ?? null,
  );
  const [legs, setLegs] = useState<PositionLeg[]>(initial?.legs ?? []);

  const [name, setName] = useState(initial?.name ?? "");
  const [notes, setNotes] = useState("");
  const [ivShift, setIvShift] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // ---------- Chain fetch ----------
  async function loadChain(ticker: string) {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setLoadingChain(true);
    setError(null);
    try {
      const res = await fetch(`/api/options/chain/${encodeURIComponent(t)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      const c: ChainResponse = body;
      setChain(c);
      setSelectedExpiry(c.expiries[0]?.expiration ?? null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setChain(null);
    } finally {
      setLoadingChain(false);
    }
  }

  // ---------- Position editing ----------
  function addLeg(
    chainRow: ChainRow,
    expiration: string,
    type: "call" | "put",
    side: "long" | "short",
  ) {
    // Default qty = 1; entry mid as price; row's IV (fallback 30%).
    const entryPrice = chainRow.mid ?? chainRow.ask ?? chainRow.bid ?? 0;
    const entryIv = chainRow.iv ?? 0.3;
    setLegs((prev) => [
      ...prev,
      {
        contractTicker: chainRow.contractTicker,
        type,
        side,
        strike: chainRow.strike,
        expiration,
        qty: 1,
        entryPrice,
        entryIv,
      },
    ]);
  }

  function updateLeg(idx: number, patch: Partial<PositionLeg>) {
    setLegs((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeLeg(idx: number) {
    setLegs((prev) => prev.filter((_, i) => i !== idx));
  }

  function clearLegs() {
    setLegs([]);
  }

  // ---------- Risk graph compute ----------
  const result = useMemo(() => {
    if (!chain || legs.length === 0) return null;
    return computeRiskGraph(
      legs.map((l) => ({
        type: l.type,
        side: l.side,
        strike: l.strike,
        expiration: l.expiration,
        qty: l.qty,
        entryPrice: l.entryPrice,
        entryIv: l.entryIv,
      })),
      {
        spot: chain.spot,
        asOf: chain.asOf,
        ivShift,
      },
    );
  }, [chain, legs, ivShift]);

  // ---------- Save ----------
  async function save() {
    if (!chain || legs.length === 0) return;
    if (!name.trim()) {
      setSaveErr("Give the trade idea a name first.");
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch("/api/risk-graph/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          ticker: chain.ticker,
          legs,
          spot: chain.spot,
          entryDebit: result?.headline.entryDebit ?? 0,
          notes: notes.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      router.push(`/research/risk-graph/saved/${body.id}`);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const expiryRows = chain?.expiries.find((e) => e.expiration === selectedExpiry);

  return (
    <div className="space-y-4">
      {/* Ticker input */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <label className="text-xs uppercase tracking-widest text-white/55">
          Ticker
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void loadChain(tickerInput);
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            placeholder="SPY, AAPL, NVDA…"
            className="rounded border border-white/20 bg-black/20 px-3 py-1.5 text-sm font-mono uppercase tracking-wider text-white placeholder:text-white/30 focus:outline-none focus:border-amber-400"
          />
          <button
            type="submit"
            disabled={loadingChain}
            className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs uppercase tracking-widest text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
          >
            {loadingChain ? "Loading…" : "Load chain"}
          </button>
        </form>
        {chain && (
          <span className="text-sm text-white/55 font-mono">
            {chain.ticker} · ${chain.spot.toFixed(2)} · {chain.asOf}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {chain && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          {/* LEFT: chain table */}
          <div className="space-y-3 min-w-0">
            {/* Expiry tabs */}
            <div className="flex flex-wrap gap-1.5 border-b border-white/10 pb-2">
              {chain.expiries.slice(0, 16).map((e) => (
                <button
                  key={e.expiration}
                  onClick={() => setSelectedExpiry(e.expiration)}
                  className={[
                    "px-2.5 py-1 rounded border text-[11px] font-mono transition-colors",
                    e.expiration === selectedExpiry
                      ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
                      : "border-white/15 text-white/55 hover:border-white/30 hover:text-white",
                  ].join(" ")}
                >
                  {e.expiration} <span className="text-white/40">· {e.dteDays}d</span>
                </button>
              ))}
              {chain.expiries.length > 16 && (
                <span className="text-[11px] text-white/45 self-center">
                  +{chain.expiries.length - 16} more
                </span>
              )}
            </div>

            {expiryRows && (
              <OptionChainTable
                expiry={expiryRows.expiration}
                spot={chain.spot}
                calls={expiryRows.calls}
                puts={expiryRows.puts}
                onAdd={addLeg}
              />
            )}
          </div>

          {/* RIGHT: position builder + save panel */}
          <div className="space-y-4">
            <PositionBuilderPanel
              legs={legs}
              onUpdateLeg={updateLeg}
              onRemoveLeg={removeLeg}
              onClear={clearLegs}
            />

            {legs.length > 0 && (
              <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
                <div className="text-xs uppercase tracking-widest text-white/55">
                  Save trade idea
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name (e.g. SPY Jan put fly)"
                  className="w-full rounded border border-white/20 bg-black/20 px-2 py-1 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-400"
                />
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  rows={2}
                  className="w-full rounded border border-white/20 bg-black/20 px-2 py-1 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-400 resize-y"
                />
                {saveErr && (
                  <p className="text-xs text-rose-300">{saveErr}</p>
                )}
                <button
                  onClick={save}
                  disabled={saving}
                  className="w-full rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs uppercase tracking-widest text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Save trade idea"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* RISK GRAPH at bottom (full width) */}
      {result && chain && (
        <div className="space-y-3">
          <HeadlineStats headline={result.headline} />

          {/* IV shift slider */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <label className="flex items-center gap-3 text-xs">
              <span className="text-white/55 uppercase tracking-widest">
                IV shift
              </span>
              <input
                type="range"
                min={-0.2}
                max={0.2}
                step={0.01}
                value={ivShift}
                onChange={(e) => setIvShift(Number(e.target.value))}
                className="flex-1 max-w-xs"
              />
              <span className="font-mono text-amber-300 w-16">
                {(ivShift * 100 >= 0 ? "+" : "") +
                  (ivShift * 100).toFixed(0)}
                %
              </span>
              {ivShift !== 0 && (
                <button
                  onClick={() => setIvShift(0)}
                  className="text-[10px] uppercase tracking-widest text-white/45 hover:text-white"
                >
                  Reset
                </button>
              )}
            </label>
          </div>

          <RiskGraphChart curves={result.curves} spot={chain.spot} />
        </div>
      )}
    </div>
  );
}
