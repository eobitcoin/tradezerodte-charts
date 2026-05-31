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

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  computeRiskGraph,
  computeIvSensitivity,
  computeQuoteScenarios,
  baselineIv,
  type Leg,
} from "@/lib/risk-graph";
import OptionChainTable, { type ChainRow } from "./OptionChainTable";
import PositionBuilderPanel from "./PositionBuilderPanel";
import RiskGraphChart from "./RiskGraphChart";
import IvSensitivityChart from "./IvSensitivityChart";
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
 *  can re-fetch the same contract on the saved-idea detail page.
 *  bid/ask captured at add time so the position panel can flag
 *  legs whose mid is unreliable (wide weekend quotes etc.). */
export interface PositionLeg extends Leg {
  contractTicker: string;
  entryBid?: number | null;
  entryAsk?: number | null;
}

/** Short "May 30" / "Jun 1" style for expiry display in suggestions. */
function shortExpiry(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

/**
 * Heuristic name for a multi-leg position. Recognises common
 * structures (vertical, butterfly, condor, straddle, strangle, iron
 * condor) and falls back to "N-leg" for unusual shapes. The name
 * always starts with the ticker so a list of saved trades reads as
 * a typical trade journal.
 */
export function suggestTradeName(legs: PositionLeg[], ticker: string): string {
  if (legs.length === 0 || !ticker) return "";

  const sameExpiry = legs.every((l) => l.expiration === legs[0].expiration);
  const sameType = legs.every((l) => l.type === legs[0].type);
  const sorted = [...legs].sort((a, b) => a.strike - b.strike);
  const calls = sorted.filter((l) => l.type === "call");
  const puts = sorted.filter((l) => l.type === "put");
  const exp0 = shortExpiry(legs[0].expiration);

  if (legs.length === 1) {
    const l = legs[0];
    return `${ticker} ${formatStrike(l.strike)}${l.type === "call" ? "C" : "P"} ${exp0}`;
  }

  if (sameExpiry && sameType) {
    const strikes = sorted.map((l) => formatStrike(l.strike)).join("/");
    const typeName = legs[0].type === "call" ? "Call" : "Put";
    const structure =
      legs.length === 2 ? "vertical"
      : legs.length === 3 ? "butterfly"
      : legs.length === 4 ? "condor"
      : `${legs.length}-leg`;
    return `${ticker} ${strikes} ${typeName} ${structure} ${exp0}`;
  }

  // Mixed types
  if (sameExpiry && calls.length === 1 && puts.length === 1) {
    if (calls[0].strike === puts[0].strike) {
      return `${ticker} ${formatStrike(calls[0].strike)} Straddle ${exp0}`;
    }
    return `${ticker} ${formatStrike(puts[0].strike)}P/${formatStrike(calls[0].strike)}C Strangle ${exp0}`;
  }
  if (sameExpiry && calls.length === 2 && puts.length === 2) {
    const cs = calls.map((l) => formatStrike(l.strike));
    const ps = puts.map((l) => formatStrike(l.strike));
    return `${ticker} ${ps[0]}/${ps[1]}/${cs[0]}/${cs[1]} Iron condor ${exp0}`;
  }

  if (!sameExpiry) {
    const expiries = [...new Set(legs.map((l) => l.expiration))].sort();
    return `${ticker} ${legs.length}-leg ${shortExpiry(expiries[0])}–${shortExpiry(expiries[expiries.length - 1])}`;
  }
  return `${ticker} ${legs.length}-leg ${exp0}`;
}

function formatStrike(s: number): string {
  return s >= 100 ? s.toFixed(0) : s.toFixed(2);
}

/**
 * Auto-generated note body: today's date, spot, per-leg breakdown
 * (with entry price + IV), net entry economics, max P/L, and
 * breakevens. The user can edit / delete freely; this is just a
 * default so saved trades aren't blank.
 */
export function suggestTradeNotes(
  legs: PositionLeg[],
  ticker: string,
  spot: number,
  headline: { entryDebit: number; maxProfit: number; maxRisk: number; breakevens: number[] } | null,
): string {
  if (legs.length === 0 || !ticker) return "";
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const lines: string[] = [`${ticker} @ $${spot.toFixed(2)} on ${today}`, ""];
  for (const leg of legs) {
    const action = leg.side === "long" ? "Buy" : "Sell";
    lines.push(
      `${action} ${leg.qty} ${formatStrike(leg.strike)}${leg.type === "call" ? "C" : "P"} ${shortExpiry(leg.expiration)} @ $${leg.entryPrice.toFixed(2)} (IV ${(leg.entryIv * 100).toFixed(0)}%)`,
    );
  }
  if (headline) {
    lines.push("");
    if (headline.entryDebit > 0) {
      lines.push(`Net debit: $${headline.entryDebit.toFixed(0)}`);
    } else if (headline.entryDebit < 0) {
      lines.push(`Net credit: $${Math.abs(headline.entryDebit).toFixed(0)}`);
    }
    lines.push(`Max profit: +$${headline.maxProfit.toFixed(0)}`);
    lines.push(`Max risk: −$${Math.abs(headline.maxRisk).toFixed(0)}`);
    if (headline.breakevens.length > 0) {
      lines.push(
        `Breakevens: ${headline.breakevens.map((b) => `$${b.toFixed(b >= 100 ? 0 : 2)}`).join(" / ")}`,
      );
    }
  }
  return lines.join("\n");
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
  /** When true, render the Risk Graph + headline + IV slider ABOVE
   *  the chain table. Used on saved-idea detail pages so the chart
   *  is the hero element rather than buried below the builder. */
  resultsFirst?: boolean;
}

export default function RiskGraphBuilder({ initial, resultsFirst }: Props) {
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
  /** X-axis zoom for the price chart, as fractional half-width of spot.
   *  0.30 = ±30% (default, captures most breakevens). 0.05 = tight,
   *  1.00 = wide (useful for far-OTM tails). */
  const [priceRangePct, setPriceRangePct] = useState(0.30);
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
        entryBid: chainRow.bid,
        entryAsk: chainRow.ask,
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
    const cleanLegs: Leg[] = legs.map((l) => ({
      type: l.type,
      side: l.side,
      strike: l.strike,
      expiration: l.expiration,
      qty: l.qty,
      entryPrice: l.entryPrice,
      entryIv: l.entryIv,
    }));
    return computeRiskGraph(cleanLegs, {
      spot: chain.spot,
      asOf: chain.asOf,
      ivShift,
      priceRangePct,
    });
  }, [chain, legs, ivShift, priceRangePct]);

  // ---------- Quote-type scenarios (Natural / Mid / Optimistic) ----------
  const scenarios = useMemo(() => {
    if (!result || legs.length === 0) return [];
    return computeQuoteScenarios(
      legs,
      result.headline.maxProfit,
      result.headline.maxRisk,
    );
  }, [result, legs]);

  const totalContracts = useMemo(
    () => legs.reduce((s, l) => s + Math.abs(l.qty), 0),
    [legs],
  );

  // ---------- Auto-suggested name + notes ----------
  const suggestedName = useMemo(
    () => (chain ? suggestTradeName(legs, chain.ticker) : ""),
    [chain, legs],
  );
  const suggestedNotes = useMemo(
    () =>
      chain ? suggestTradeNotes(legs, chain.ticker, chain.spot, result?.headline ?? null) : "",
    [chain, legs, result],
  );

  // Pre-fill name + notes once when the user adds their first leg in
  // a fresh build (not when re-loading a saved trade — `initial` skips).
  // After that the user owns the fields. If they clear them, the
  // placeholder always shows the latest suggestion so they can see it.
  const prefilledRef = useRef(Boolean(initial?.name));
  useEffect(() => {
    if (legs.length === 0) {
      prefilledRef.current = false; // reset for next session
      return;
    }
    if (!prefilledRef.current && name === "" && notes === "") {
      setName(suggestedName);
      setNotes(suggestedNotes);
      prefilledRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs.length]);

  // ---------- IV sensitivity compute ----------
  const ivResult = useMemo(() => {
    if (!chain || legs.length === 0) return null;
    const cleanLegs: Leg[] = legs.map((l) => ({
      type: l.type,
      side: l.side,
      strike: l.strike,
      expiration: l.expiration,
      qty: l.qty,
      entryPrice: l.entryPrice,
      entryIv: l.entryIv,
    }));
    return {
      curves: computeIvSensitivity(cleanLegs, {
        spot: chain.spot,
        asOf: chain.asOf,
      }),
      baselineIv: baselineIv(cleanLegs),
    };
  }, [chain, legs]);

  // ---------- Save ----------
  async function save() {
    if (!chain || legs.length === 0) return;
    // Fall back to the suggestion if user left the name blank.
    const finalName = name.trim() || suggestedName;
    const finalNotes = notes.trim() || suggestedNotes;
    if (!finalName) {
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
          name: finalName,
          ticker: chain.ticker,
          legs,
          spot: chain.spot,
          entryDebit: result?.headline.entryDebit ?? 0,
          notes: finalNotes,
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

  // Risk graph section — extracted so we can place it ABOVE or BELOW
  // the chain/builder depending on `resultsFirst`. Saved-trade detail
  // views use resultsFirst so the chart is the immediate hero.
  const riskGraphSection =
    result && chain ? (
      <div id="risk-graph" className="space-y-3 scroll-mt-20">
        <HeadlineStats
          headline={result.headline}
          scenarios={scenarios}
          totalContracts={totalContracts}
        />

        {/* Chart controls — IV shift + price-range zoom side by side. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* IV shift slider */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <label className="flex items-center gap-3 text-xs flex-wrap">
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
                className="flex-1 min-w-[120px]"
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

          {/* Price-range zoom slider — controls X-axis half-width on
              the price chart. ±5% to ±100% of spot. Useful when
              breakevens are far OTM on volatile names (TSLA at ±5%
              might miss them; ±60% catches the full picture). */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <label className="flex items-center gap-3 text-xs flex-wrap">
              <span className="text-white/55 uppercase tracking-widest">
                Price zoom
              </span>
              <input
                type="range"
                min={0.05}
                max={1.0}
                step={0.01}
                value={priceRangePct}
                onChange={(e) => setPriceRangePct(Number(e.target.value))}
                className="flex-1 min-w-[120px]"
              />
              <span className="font-mono text-amber-300 w-16">
                ±{(priceRangePct * 100).toFixed(0)}%
              </span>
              {/* Quick presets */}
              <div className="flex gap-1">
                {[0.10, 0.30, 0.60].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPriceRangePct(p)}
                    className={[
                      "text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border transition-colors",
                      Math.abs(priceRangePct - p) < 0.005
                        ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
                        : "border-white/15 text-white/55 hover:border-white/30 hover:text-white",
                    ].join(" ")}
                  >
                    ±{(p * 100).toFixed(0)}
                  </button>
                ))}
              </div>
            </label>
            {chain && (
              <p className="text-[10px] text-white/45 mt-1.5 font-mono">
                Range: ${(chain.spot * (1 - priceRangePct)).toFixed(2)} —
                ${(chain.spot * (1 + priceRangePct)).toFixed(2)}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3">
          <RiskGraphChart curves={result.curves} spot={chain.spot} />
          {ivResult && ivResult.curves.length > 0 && (
            <IvSensitivityChart
              curves={ivResult.curves}
              baselineIv={ivResult.baselineIv}
            />
          )}
        </div>
      </div>
    ) : null;

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

      {/* Chart first when invoked from a saved-trade detail view. */}
      {resultsFirst && riskGraphSection}

      {chain && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          {/* LEFT: chain table */}
          <div className="space-y-3 min-w-0">
            {/* Expiry tabs — full chain, no cap. Polygon returns every
                listed expiry from front-month weeklies through LEAPs;
                we show them all so users can find any contract they
                want to trade. flex-wrap naturally pushes overflow to
                additional rows. */}
            <div className="flex flex-wrap gap-1.5 border-b border-white/10 pb-2">
              {chain.expiries.map((e) => {
                // Highlight LEAP-range expiries (≥ 365d) with a faint
                // amber tint so they stand out from the busy weeklies.
                const isLeap = e.dteDays >= 365;
                return (
                  <button
                    key={e.expiration}
                    onClick={() => setSelectedExpiry(e.expiration)}
                    className={[
                      "px-2.5 py-1 rounded border text-[11px] font-mono transition-colors",
                      e.expiration === selectedExpiry
                        ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
                        : isLeap
                          ? "border-amber-500/25 text-amber-300/75 hover:border-amber-500/50 hover:text-amber-200"
                          : "border-white/15 text-white/55 hover:border-white/30 hover:text-white",
                    ].join(" ")}
                    title={isLeap ? "LEAP (>1 year)" : undefined}
                  >
                    {e.expiration} <span className="text-white/40">· {e.dteDays}d</span>
                  </button>
                );
              })}
            </div>

            {expiryRows && (
              <OptionChainTable
                expiry={expiryRows.expiration}
                spot={chain.spot}
                calls={expiryRows.calls}
                puts={expiryRows.puts}
                legs={legs}
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
                <div className="space-y-1">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={suggestedName || "Name (e.g. SPY Jan put fly)"}
                    className="w-full rounded border border-white/20 bg-black/20 px-2 py-1 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-400"
                  />
                  {/* "Use suggested" button — only shows when we have a
                      suggestion that DIFFERS from the current value, so
                      it's useful when user has edited and wants to revert. */}
                  {suggestedName && name !== suggestedName && (
                    <button
                      type="button"
                      onClick={() => {
                        setName(suggestedName);
                        if (!notes.trim()) setNotes(suggestedNotes);
                      }}
                      className="text-[10px] uppercase tracking-widest text-amber-300/80 hover:text-amber-200"
                    >
                      ↻ Use suggested
                    </button>
                  )}
                </div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={
                    suggestedNotes
                      ? suggestedNotes.split("\n").slice(0, 3).join("\n") +
                        (suggestedNotes.split("\n").length > 3 ? "\n…" : "")
                      : "Notes (optional)"
                  }
                  rows={4}
                  className="w-full rounded border border-white/20 bg-black/20 px-2 py-1 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-400 resize-y font-mono"
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

      {/* When NOT in results-first mode, the risk graph renders at
          the BOTTOM (canonical builder flow: chain → builder → chart). */}
      {!resultsFirst && riskGraphSection}
    </div>
  );
}
