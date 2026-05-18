"use client";

import { useState, useTransition, type FormEvent } from "react";

/**
 * BotWick Signal Sandbox.
 *
 * Punch in a hypothetical market state for a ticker, hit Evaluate, see
 * exactly which pending bot_trades would fire and why. Pure sandbox — no
 * writes anywhere, no orders, no Matrix tape pollution. The goal is to
 * tighten the feedback loop on parser correctness before we wire a real
 * data source.
 */

type FlatRow = { depth: number; kind: "leaf" | "all" | "any"; matched: boolean; label: string };
type BranchResult = {
  branch: "entry" | "target1" | "target2" | "stop" | "time_stop";
  present: boolean;
  matched: boolean;
  flat: FlatRow[];
};
type TradeResult = {
  tradeId: string;
  ticker: string;
  strategy: string;
  grade: string | null;
  status: string;
  entryMidEstimate: number | null;
  branches: BranchResult[];
};

export default function BotWickSignalSandbox() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<TradeResult[] | null>(null);

  const [ticker, setTicker] = useState("TSLA");
  const [lastPrice, setLastPrice] = useState("437.42");
  const [sessionVwap, setSessionVwap] = useState("440.18");
  const [bar5Close, setBar5Close] = useState("437.42");
  const [bar5High, setBar5High] = useState("440.05");
  const [bar5Low, setBar5Low] = useState("437.30");
  const [vwapShort, setVwapShort] = useState(true);
  const [vwapLong, setVwapLong] = useState(false);
  const [nowEt, setNowEt] = useState("10:35");
  const [entryFill, setEntryFill] = useState("");
  const [currentMid, setCurrentMid] = useState("");

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setResults(null);
    start(async () => {
      const body = {
        ticker: ticker.toUpperCase(),
        lastPrice: Number(lastPrice),
        sessionVwap: sessionVwap === "" ? null : Number(sessionVwap),
        lastBars: {
          "5min": {
            close: Number(bar5Close),
            high: Number(bar5High),
            low: Number(bar5Low),
          },
        },
        vwapRejectionShort: vwapShort,
        vwapRejectionLong: vwapLong,
        nowEt,
        entryFill: entryFill === "" ? undefined : Number(entryFill),
        currentMid: currentMid === "" ? undefined : Number(currentMid),
      };
      const res = await fetch("/api/admin/botwick/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Evaluate failed (${res.status})`);
        return;
      }
      setResults(j.results as TradeResult[]);
    });
  }

  const fieldCls =
    "mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm";

  return (
    <fieldset className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-4">
      <legend className="px-2 text-xs uppercase tracking-widest text-black/55 dark:text-white/55">
        Signal sandbox
      </legend>
      <p className="text-sm text-black/65 dark:text-white/65">
        Hypothetical market state → which pending plans would fire? Read-only — no orders, no tape
        writes. Use this to verify the parser&apos;s ASTs before a real data source is wired.
      </p>

      <form onSubmit={submit} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-xs text-black/60 dark:text-white/60">Ticker</span>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            className={fieldCls}
          />
        </label>
        <label className="block">
          <span className="text-xs text-black/60 dark:text-white/60">Last price</span>
          <input value={lastPrice} onChange={(e) => setLastPrice(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-xs text-black/60 dark:text-white/60">Session VWAP</span>
          <input value={sessionVwap} onChange={(e) => setSessionVwap(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-xs text-black/60 dark:text-white/60">Now (ET HH:MM)</span>
          <input value={nowEt} onChange={(e) => setNowEt(e.target.value)} className={fieldCls} />
        </label>

        <label className="block">
          <span className="text-xs text-black/60 dark:text-white/60">5-min close</span>
          <input value={bar5Close} onChange={(e) => setBar5Close(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-xs text-black/60 dark:text-white/60">5-min high</span>
          <input value={bar5High} onChange={(e) => setBar5High(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-xs text-black/60 dark:text-white/60">5-min low</span>
          <input value={bar5Low} onChange={(e) => setBar5Low(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-xs text-black/60 dark:text-white/60">Entry fill (opt.)</span>
          <input value={entryFill} onChange={(e) => setEntryFill(e.target.value)} className={fieldCls} />
        </label>

        <label className="block">
          <span className="text-xs text-black/60 dark:text-white/60">Current option mid</span>
          <input value={currentMid} onChange={(e) => setCurrentMid(e.target.value)} className={fieldCls} />
        </label>

        <label className="col-span-2 flex items-center gap-2 text-sm mt-5">
          <input type="checkbox" checked={vwapShort} onChange={(e) => setVwapShort(e.target.checked)} />
          <span>VWAP rejection — short side</span>
        </label>
        <label className="col-span-1 flex items-center gap-2 text-sm mt-5">
          <input type="checkbox" checked={vwapLong} onChange={(e) => setVwapLong(e.target.checked)} />
          <span>long side</span>
        </label>

        <button
          type="submit"
          disabled={pending}
          className="col-span-2 sm:col-span-4 px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm disabled:opacity-50"
        >
          {pending ? "Evaluating…" : "Evaluate against pending trades"}
        </button>
      </form>

      {err && (
        <p className="text-sm text-rose-500" role="alert">
          {err}
        </p>
      )}

      {results && results.length === 0 && (
        <p className="text-sm text-black/55 dark:text-white/55 italic">
          No non-terminal trades found for that ticker. Run an ingest first.
        </p>
      )}

      {results && results.length > 0 && (
        <div className="space-y-4">
          {results.map((r) => (
            <article
              key={r.tradeId}
              className="rounded border border-black/10 dark:border-white/10 p-3 space-y-2"
            >
              <header className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-mono font-semibold">
                  {r.ticker} · {r.strategy} · grade {r.grade ?? "—"} · status {r.status}
                </span>
                {r.entryMidEstimate != null && (
                  <span className="text-xs text-black/55 dark:text-white/55 font-mono">
                    plan mid ≈ ${r.entryMidEstimate.toFixed(2)}
                  </span>
                )}
              </header>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {r.branches.map((b) => (
                  <BranchBlock key={b.branch} b={b} />
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function BranchBlock({ b }: { b: BranchResult }) {
  if (!b.present) {
    return (
      <div className="text-xs rounded border border-dashed border-black/15 dark:border-white/15 p-2 text-black/45 dark:text-white/45">
        <strong className="uppercase tracking-widest">{b.branch}</strong> — unparsed
      </div>
    );
  }
  const tone = b.matched
    ? "border-emerald-500/40 bg-emerald-500/5"
    : "border-black/15 dark:border-white/15";
  const dot = b.matched ? "bg-emerald-500" : "bg-zinc-500/60";
  return (
    <div className={`text-xs rounded border ${tone} p-2 font-mono`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold uppercase tracking-widest">{b.branch}</span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          {b.matched ? "WOULD FIRE" : "no match"}
        </span>
      </div>
      <ul className="space-y-0.5">
        {b.flat.map((row, i) => (
          <li
            key={i}
            style={{ paddingLeft: `${row.depth * 0.9}rem` }}
            className={row.matched ? "text-emerald-700 dark:text-emerald-300" : "text-black/55 dark:text-white/55"}
          >
            {row.matched ? "✓" : "·"} {row.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
