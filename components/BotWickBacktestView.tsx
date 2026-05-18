"use client";

/**
 * BotWick — BACKTEST tab.
 *
 * Admin-only. Run an ALMA × VWAP replay over a date range, see per-signal
 * outcomes + aggregate hit-rate, save the run for later reference.
 *
 * Outcome model is intentionally simple — "did the underlying touch the
 * OTM strike before close?" is a fair *directional* read on signal quality
 * for 0DTE without needing a Black-Scholes premium estimate. Real $ P&L
 * comes in Phase 2 (premium model + sizing).
 */

import Link from "next/link";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import type { BotConfig } from "@/lib/db/schema";

type Props = { config: BotConfig };

type PolicySummary = {
  params: {
    target1Pct: number;
    target2Pct: number | null;
    stopLossPct: number;
    timeStopMin: number;
    leverageMultiplier: number;
  };
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  expectedPnlPctPerTrade: number;
  target1Rate: number;
  target2Rate: number;
  stopLossRate: number;
  timeStopRate: number;
  endOfDayRate: number;
  sharpe: number | null;
};

type Summary = {
  totalSignals: number;
  longSignals: number;
  shortSignals: number;
  hitRate: number;
  longHitRate: number;
  shortHitRate: number;
  avgFavorablePct: number;
  avgAdversePct: number;
  avgTimeToTouchMin: number | null;
  byTicker: Array<{
    ticker: string;
    n: number;
    hits: number;
    hitRate: number;
    avgFavorablePct: number;
    avgAdversePct: number;
  }>;
  policy: PolicySummary | null;
};

type Signal = {
  ticker: string;
  day: string;
  side: "long" | "short";
  signalEt: string;
  almaAtCross: number;
  vwapAtCross: number;
  slopePctAtCross: number;
  underlyingAtSignal: number;
  otmStrike: number;
  touched: boolean;
  maxFavorablePct: number;
  maxAdversePct: number;
  timeToTouchMin: number | null;
  policy: {
    exitReason: "target1" | "target2" | "stop_loss" | "time_stop" | "end_of_day";
    exitMinutes: number;
    optionPnlPct: number;
    hitTarget2: boolean;
  } | null;
};

type Run = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "complete" | "failed";
  config: { fromDay: string; toDay: string; tickers: string[]; slopePct: number };
  signals: Signal[];
  summary: Summary & { perTickerErrors?: Array<{ ticker: string; day: string; reason: string }> };
};

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Most recent fully-closed trading day (weekend-aware).
 * Today is intentionally excluded — current-day bars are partial until 16:00 ET
 * and lead to noisy / misleading results.
 */
function previousTradingDayIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

export default function BotWickBacktestView({ config }: Props) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const maxToDay = previousTradingDayIso();
  const [fromDay, setFromDay] = useState(daysAgoIso(14));
  const [toDay, setToDay] = useState(maxToDay);
  const [tickersText, setTickersText] = useState(
    (config.almaWatchlist ?? ["SPY", "QQQ"]).join(", "),
  );
  const [slopePct, setSlopePct] = useState(String(config.almaSteepSlopePct));
  const [target1Pct, setTarget1Pct] = useState(String(config.defaultTarget1Pct ?? 50));
  const [stopLossPct, setStopLossPct] = useState(String(config.defaultStopLossPct ?? 50));
  const [timeStopMin, setTimeStopMin] = useState(String(config.defaultTimeStopMin ?? 60));
  const [leverageMultiplier, setLeverageMultiplier] = useState("50");
  type InstrumentMode = "options" | "stock_long" | "stock_short" | "stock_both";
  const [instrument, setInstrument] = useState<InstrumentMode>("options");
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRun, setActiveRun] = useState<Run | null>(null);

  // Load history on mount.
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/botwick/backtest");
      if (!res.ok) return;
      const j = await res.json();
      setRuns(j.runs as Run[]);
    })();
  }, []);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const tickers = tickersText
        .split(/[,\s]+/)
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean);
      const res = await fetch("/api/admin/botwick/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromDay,
          toDay,
          tickers,
          slopePct: Number(slopePct),
          target1Pct: Number(target1Pct),
          stopLossPct: Number(stopLossPct),
          timeStopMin: Number(timeStopMin),
          leverageMultiplier: Number(leverageMultiplier),
          instrument,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "backtest failed");
        return;
      }
      // Refresh run list + load the new one in detail.
      const list = await fetch("/api/admin/botwick/backtest").then((r) => r.json());
      setRuns(list.runs as Run[]);
      const detail = await fetch(`/api/admin/botwick/backtest?id=${j.runId}`).then((r) => r.json());
      setActiveRun(detail.run as Run);
    });
  }

  async function loadRun(id: string) {
    const detail = await fetch(`/api/admin/botwick/backtest?id=${id}`).then((r) => r.json());
    setActiveRun(detail.run as Run);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Backtest — ALMA × VWAP</h1>
          <p className="text-sm text-black/60 dark:text-white/60 mt-1">
            Replay the ALMA × VWAP signal over historical 5-min bars to see how often it would have
            fired and whether the underlying touched the chosen OTM strike before market close. Use
            the hit rate to calibrate slope threshold and watchlist before committing real capital.
          </p>
        </div>
        <Link
          href="/botwick/backtest/help"
          className="shrink-0 text-xs text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:underline"
        >
          Help · how to read this →
        </Link>
      </header>

      <form onSubmit={submit} className="rounded-lg border border-black/10 dark:border-white/10 p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        <label className="block">
          <span className="text-sm font-medium">From</span>
          <input
            type="date"
            value={fromDay}
            max={maxToDay}
            onChange={(e) => setFromDay(e.target.value)}
            className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">To</span>
          <input
            type="date"
            value={toDay}
            max={maxToDay}
            onChange={(e) => setToDay(e.target.value)}
            className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
          />
          <span className="block text-[10px] text-black/55 dark:text-white/55 mt-0.5">
            today excluded — bars are still printing
          </span>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium">Tickers</span>
          <input
            type="text"
            value={tickersText}
            onChange={(e) => setTickersText(e.target.value)}
            placeholder="SPY, QQQ, AAPL"
            className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm uppercase"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Slope threshold (% / bar)</span>
          <input
            type="number"
            step={0.01}
            min={0}
            max={5}
            value={slopePct}
            onChange={(e) => setSlopePct(e.target.value)}
            className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
          />
        </label>
        <fieldset className="sm:col-span-4 grid grid-cols-2 sm:grid-cols-4 gap-3 border border-black/10 dark:border-white/10 rounded p-3 mt-1">
          <legend className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55 px-1">
            Exit policy (applied to estimate option P&L)
          </legend>
          <label className="block">
            <span className="text-sm font-medium">Target 1 (%)</span>
            <input
              type="number" step={1} min={1} max={1000}
              value={target1Pct}
              onChange={(e) => setTarget1Pct(e.target.value)}
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Stop loss (%)</span>
            <input
              type="number" step={1} min={1} max={100}
              value={stopLossPct}
              onChange={(e) => setStopLossPct(e.target.value)}
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Time stop (min)</span>
            <input
              type="number" step={5} min={5} max={390}
              value={timeStopMin}
              onChange={(e) => setTimeStopMin(e.target.value)}
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Leverage × (option/underlying)</span>
            <input
              type="number" step={5} min={1} max={500}
              value={leverageMultiplier}
              onChange={(e) => setLeverageMultiplier(e.target.value)}
              disabled={instrument !== "options"}
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm disabled:opacity-40"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Instrument</span>
            <select
              value={instrument}
              onChange={(e) => setInstrument(e.target.value as InstrumentMode)}
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 text-sm"
            >
              <option value="options">Options (×leverage)</option>
              <option value="stock_long">Stock — long only (linear, ×1)</option>
              <option value="stock_short">Stock — short only (linear, ×1)</option>
              <option value="stock_both">Stock — long + short (linear, ×1)</option>
            </select>
          </label>
          <p className="sm:col-span-4 text-[11px] text-black/55 dark:text-white/55 -mt-1">
            Leverage × is the assumed option-% move per 1% underlying move. 0DTE nearest-OTM
            typically lands 40–80; default 50. Higher = larger swings (both wins and losses).
            Stops resolve before targets within the same bar (conservative).
          </p>
        </fieldset>
        <div className="sm:col-span-4 flex items-end gap-3">
          <button
            type="submit"
            disabled={pending}
            className="px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm disabled:opacity-40"
          >
            {pending ? "Running…" : "Run backtest"}
          </button>
          {err && <span className="text-sm text-rose-500">{err}</span>}
          {pending && (
            <span className="text-xs text-black/55 dark:text-white/55">
              May take ~30s–2min depending on date range × tickers.
            </span>
          )}
        </div>
      </form>

      {activeRun && (
        <article className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.03] p-4 space-y-4">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">
              Run {activeRun.id.slice(0, 8)} · {activeRun.config.fromDay} → {activeRun.config.toDay}
              {" · "}slope ≥ {activeRun.config.slopePct}%
            </h2>
            <span className="text-xs text-black/55 dark:text-white/55 font-mono">
              {activeRun.status}
            </span>
          </header>

          <SummaryGrid s={activeRun.summary} />

          {activeRun.summary.policy && (
            <PolicyGrid p={activeRun.summary.policy} />
          )}

          {activeRun.summary.byTicker && activeRun.summary.byTicker.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-widest text-black/55 dark:text-white/55 mb-2">
                Per-ticker
              </h3>
              <table className="w-full text-xs font-mono">
                <thead className="text-black/55 dark:text-white/55 uppercase tracking-widest text-[10px]">
                  <tr>
                    <th className="text-left py-1">Ticker</th>
                    <th className="text-right py-1">N</th>
                    <th className="text-right py-1">Hits</th>
                    <th className="text-right py-1">Hit %</th>
                    <th className="text-right py-1">Avg fav %</th>
                    <th className="text-right py-1">Avg adv %</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRun.summary.byTicker.map((t) => (
                    <tr key={t.ticker} className="border-t border-black/10 dark:border-white/10">
                      <td className="py-1">{t.ticker}</td>
                      <td className="text-right py-1">{t.n}</td>
                      <td className="text-right py-1">{t.hits}</td>
                      <td className="text-right py-1">{(t.hitRate * 100).toFixed(1)}%</td>
                      <td className="text-right py-1">{t.avgFavorablePct.toFixed(2)}</td>
                      <td className="text-right py-1">{t.avgAdversePct.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeRun.signals.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs uppercase tracking-widest text-black/55 dark:text-white/55">
                Signals ({activeRun.signals.length})
              </summary>
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-xs font-mono">
                  <thead className="text-black/55 dark:text-white/55 uppercase tracking-widest text-[10px]">
                    <tr>
                      <th className="text-left py-1">Day</th>
                      <th className="text-left py-1">ET</th>
                      <th className="text-left py-1">Ticker</th>
                      <th className="text-left py-1">Side</th>
                      <th className="text-right py-1">Underlying</th>
                      <th className="text-right py-1">OTM</th>
                      <th className="text-right py-1">Slope %</th>
                      <th className="text-right py-1">Touch</th>
                      <th className="text-right py-1">T→touch</th>
                      <th className="text-right py-1">Fav %</th>
                      <th className="text-right py-1">Adv %</th>
                      <th className="text-right py-1">Exit</th>
                      <th className="text-right py-1">@min</th>
                      <th className="text-right py-1">Opt P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRun.signals.slice(0, 200).map((s, i) => {
                      const pnl = s.policy?.optionPnlPct;
                      const pnlClass =
                        pnl == null
                          ? ""
                          : pnl > 0
                            ? "text-emerald-600 dark:text-emerald-300"
                            : pnl < 0
                              ? "text-rose-500"
                              : "";
                      return (
                      <tr
                        key={i}
                        className={`border-t border-black/10 dark:border-white/10`}
                      >
                        <td className="py-1">{s.day}</td>
                        <td className="py-1">{s.signalEt}</td>
                        <td className="py-1">{s.ticker}</td>
                        <td className="py-1">{s.side}</td>
                        <td className="text-right py-1">{s.underlyingAtSignal.toFixed(2)}</td>
                        <td className="text-right py-1">{s.otmStrike}</td>
                        <td className="text-right py-1">{s.slopePctAtCross.toFixed(3)}</td>
                        <td className="text-right py-1">{s.touched ? "yes" : "no"}</td>
                        <td className="text-right py-1">{s.timeToTouchMin ?? "—"}</td>
                        <td className="text-right py-1">{s.maxFavorablePct.toFixed(2)}</td>
                        <td className="text-right py-1">{s.maxAdversePct.toFixed(2)}</td>
                        <td className="text-right py-1">{s.policy?.exitReason ?? "—"}</td>
                        <td className="text-right py-1">{s.policy?.exitMinutes ?? "—"}</td>
                        <td className={`text-right py-1 font-semibold ${pnlClass}`}>
                          {pnl == null ? "—" : `${pnl > 0 ? "+" : ""}${pnl.toFixed(1)}%`}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {activeRun.signals.length > 200 && (
                  <p className="text-[11px] text-black/55 dark:text-white/55 mt-1">
                    Showing first 200 of {activeRun.signals.length}.
                  </p>
                )}
              </div>
            </details>
          )}

          {activeRun.summary.perTickerErrors && activeRun.summary.perTickerErrors.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs uppercase tracking-widest text-rose-500">
                Errors ({activeRun.summary.perTickerErrors.length})
              </summary>
              <ul className="mt-2 list-disc pl-5 text-xs text-rose-500">
                {activeRun.summary.perTickerErrors.map((e, i) => (
                  <li key={i}>
                    {e.ticker} {e.day} — {e.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </article>
      )}

      {runs.length > 0 && (
        <section className="rounded-lg border border-black/10 dark:border-white/10 p-4">
          <h2 className="text-xs uppercase tracking-widest text-black/55 dark:text-white/55 mb-2">
            Recent runs
          </h2>
          <ul className="divide-y divide-black/10 dark:divide-white/10">
            {runs.map((r) => (
              <li key={r.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div className="font-mono text-xs">
                  <span className="text-black/55 dark:text-white/55">{r.id.slice(0, 8)}</span>
                  {" · "}
                  {r.config.fromDay} → {r.config.toDay}
                  {" · "}
                  <span className="text-black/55 dark:text-white/55">
                    {r.config.tickers.join(",")}
                  </span>
                  {" · "}slope ≥ {r.config.slopePct}%
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded ${
                      r.status === "complete"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : r.status === "running"
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                    }`}
                  >
                    {r.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => loadRun(r.id)}
                    className="text-xs underline text-black/70 dark:text-white/70"
                  >
                    view
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SummaryGrid({ s }: { s: Summary }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <Cell label="Signals" value={String(s.totalSignals)} sub={`${s.longSignals}L / ${s.shortSignals}S`} />
      <Cell
        label="Hit rate"
        value={`${(s.hitRate * 100).toFixed(1)}%`}
        sub={`L ${(s.longHitRate * 100).toFixed(0)}% · S ${(s.shortHitRate * 100).toFixed(0)}%`}
        tone={s.hitRate >= 0.5 ? "good" : s.hitRate >= 0.35 ? "ok" : "bad"}
      />
      <Cell
        label="Avg favorable"
        value={`${s.avgFavorablePct.toFixed(2)}%`}
        sub="of underlying"
        tone="good"
      />
      <Cell
        label="Avg adverse"
        value={`${s.avgAdversePct.toFixed(2)}%`}
        sub="of underlying"
        tone="bad"
      />
      <Cell
        label="Time to touch"
        value={s.avgTimeToTouchMin == null ? "—" : `${s.avgTimeToTouchMin}m`}
        sub="avg, hits only"
      />
    </div>
  );
}

function PolicyGrid({ p }: { p: PolicySummary }) {
  const exp = p.expectedPnlPctPerTrade;
  const expTone = exp > 0 ? "good" : exp < 0 ? "bad" : "neutral";
  return (
    <div className="space-y-2">
      <h3 className="text-xs uppercase tracking-widest text-black/55 dark:text-white/55">
        Estimated option P&L · target +{p.params.target1Pct}% / stop −{p.params.stopLossPct}% / time {p.params.timeStopMin}m · leverage ×{p.params.leverageMultiplier}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <Cell
          label="Win rate"
          value={`${(p.winRate * 100).toFixed(1)}%`}
          tone={p.winRate >= 0.5 ? "good" : p.winRate >= 0.35 ? "ok" : "bad"}
        />
        <Cell
          label="Expected /trade"
          value={`${exp > 0 ? "+" : ""}${exp.toFixed(1)}%`}
          sub="option P&L"
          tone={expTone}
        />
        <Cell label="Avg win" value={`+${p.avgWinPct.toFixed(1)}%`} tone="good" />
        <Cell label="Avg loss" value={`${p.avgLossPct.toFixed(1)}%`} tone="bad" />
        <Cell
          label="Target 1 hit"
          value={`${(p.target1Rate * 100).toFixed(1)}%`}
          sub={`T2 ever ${(p.target2Rate * 100).toFixed(0)}%`}
          tone="good"
        />
        <Cell
          label="Stop / time / EOD"
          value={`${(p.stopLossRate * 100).toFixed(0)}/${(p.timeStopRate * 100).toFixed(0)}/${(p.endOfDayRate * 100).toFixed(0)}%`}
          sub="exit mix"
        />
      </div>
      {p.sharpe != null && (
        <p className="text-[11px] text-black/55 dark:text-white/55">
          Sharpe-ish (mean / σ): <span className="font-mono">{p.sharpe.toFixed(2)}</span>
          {" "}— values &gt; 0.5 are decent for an unfiltered 0DTE strategy.
        </p>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "ok" | "neutral";
}) {
  const valColor =
    tone === "good"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "bad"
        ? "text-rose-500"
        : tone === "ok"
          ? "text-amber-700 dark:text-amber-300"
          : "";
  return (
    <div className="rounded border border-black/10 dark:border-white/10 p-2">
      <div className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
        {label}
      </div>
      <div className={`text-base font-mono font-semibold mt-0.5 ${valColor}`}>{value}</div>
      {sub && <div className="text-[10px] text-black/55 dark:text-white/55 mt-0.5">{sub}</div>}
    </div>
  );
}
