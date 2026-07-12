"use client";

/**
 * BotWick Analysis tab — Finora-style SMC report per ticker.
 *
 * Ticker chips across the top (bias-colored). Selecting a chip renders that
 * ticker's full report: General Evaluation, indicator scorecard, Critical
 * Levels, Trade Ideas, short/long example scenarios, expectation, and the
 * defined-risk options idea deep-linked into Risk Graph. All numbers were
 * computed at scan time (6AM ET) by the verified Finora engine.
 */
import { useState } from "react";
import type { BotwickScanData, BotwickTickerReport } from "@/lib/db/schema";
import { legsToUrlParams } from "@/lib/earnings-trade-builder";

interface Props {
  scanDay: string;
  data: BotwickScanData;
}

const BIAS_CHIP: Record<string, string> = {
  bullish: "text-emerald-700 dark:text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  bearish: "text-red-700 dark:text-red-300 border-red-500/40 bg-red-500/10",
  neutral: "text-black/60 dark:text-white/60 border-black/20 dark:border-white/20 bg-black/5 dark:bg-white/5",
};

const fmt = (x: number) => x.toFixed(2);

function fmtBarTime(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function BotwickAnalysisView({ scanDay, data }: Props) {
  const okReports = data.reports.filter((r) => r.ok);
  const [selected, setSelected] = useState<string>(okReports[0]?.symbol ?? "");
  const report = data.reports.find((r) => r.symbol === selected) ?? okReports[0];

  return (
    <main className="max-w-4xl lg:max-w-5xl mx-auto px-4 py-6 space-y-5">
      <header className="space-y-1">
        <div className="text-[10px] font-mono uppercase tracking-widest text-black/50 dark:text-white/50">
          BotWick Analysis · Smart-Money read · {scanDay} · published 6:00 AM ET
        </div>
        <p className="text-xs text-black/55 dark:text-white/55">
          Daily multi-timeframe technical read (daily trend + levels, 1h entries) on the BotWick
          universe. Every number is computed from live Polygon data at scan time.
        </p>
      </header>

      {/* Ticker chips */}
      <div className="flex flex-wrap gap-1.5">
        {data.reports.map((r) => (
          <button
            key={r.symbol}
            type="button"
            onClick={() => setSelected(r.symbol)}
            disabled={!r.ok}
            title={r.ok ? `${r.bias} · $${fmt(r.price)}` : r.error}
            className={[
              "px-2.5 py-1 rounded border text-xs font-mono font-bold transition-all",
              r.ok ? BIAS_CHIP[r.bias] : "opacity-35 cursor-not-allowed border-black/15 dark:border-white/15",
              r.symbol === report?.symbol ? "ring-2 ring-amber-400/60" : "",
            ].join(" ")}
          >
            {r.symbol}
          </button>
        ))}
      </div>

      {report && report.ok ? <Report r={report} /> : (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          No successful reports in this scan.
        </div>
      )}

      <footer className="text-[11px] text-black/45 dark:text-white/45 leading-relaxed">
        📝 This is not investment advice, only an educational report. Always wait for confirmation
        and use proper risk management!
      </footer>
    </main>
  );
}

function Section({ title, bullets }: { title: string; bullets: string[] }) {
  if (bullets.length === 0) return null;
  return (
    <section className="space-y-1.5">
      <h2 className="text-sm font-bold">{title}</h2>
      <ul className="space-y-1 text-sm text-black/75 dark:text-white/75 leading-relaxed">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-black/30 dark:text-white/30 shrink-0">–</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Report({ r }: { r: BotwickTickerReport }) {
  const indKeys = ["MACD", "Vortex", "PSAR", "DMI", "Stochastic", "Momentum", "RSI", "MFI", "Fisher"];
  const oi = r.optionsIdea;
  const riskGraphHref = oi
    ? `/research/risk-graph?${legsToUrlParams({
        ticker: r.symbol,
        strategy: oi.strategy,
        expiry: oi.expiration,
        legs: [
          { side: "buy", type: oi.direction === "long" ? "call" : "put", strike: oi.longStrike },
          { side: "sell", type: oi.direction === "long" ? "call" : "put", strike: oi.shortStrike },
        ],
      })}`
    : null;

  return (
    <article className="space-y-5">
      {/* Header row */}
      <div className="flex items-baseline justify-between flex-wrap gap-2 border-b border-black/10 dark:border-white/10 pb-3">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-mono font-bold">{r.symbol}</span>
          <span className="text-xl tabular-nums">${fmt(r.price)}</span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${BIAS_CHIP[r.bias]}`}
          >
            {r.bias}
          </span>
        </div>
        <div className="text-[10px] font-mono text-black/45 dark:text-white/45">
          📡 bars through {fmtBarTime(r.asOf.lastLtfBar)} ET
          {r.asOf.lastTradePrice != null && ` · last trade ${fmt(r.asOf.lastTradePrice)}`}
        </div>
      </div>

      {r.warnings.length > 0 && (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs">
          {r.warnings.join(" · ")}
        </div>
      )}

      <Section title="🔍 General Evaluation" bullets={r.sections.general} />

      {/* Indicator scorecard */}
      <section className="space-y-1.5">
        <h2 className="text-sm font-bold">📉 Technical Indicators</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs">
          {indKeys.map((k) => {
            const read = r.indicators[k];
            if (!read) return null;
            const bull = read.verdict === "bullish";
            return (
              <div
                key={k}
                className="flex items-center justify-between rounded border border-black/10 dark:border-white/10 px-2 py-1.5"
                title={read.detail}
              >
                <span className="font-semibold">{k}</span>
                <span className={bull ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}>
                  {bull ? "Bullish 🟢" : "Bearish 🔴"}
                </span>
              </div>
            );
          })}
          <div
            className="flex items-center justify-between rounded border border-black/10 dark:border-white/10 px-2 py-1.5"
            title={r.indicators.ADX.detail}
          >
            <span className="font-semibold">ADX</span>
            <span className="text-black/70 dark:text-white/70">
              {r.indicators.ADX.value} · {r.indicators.ADX.verdict}
            </span>
          </div>
        </div>
      </section>

      <Section title="📈 Critical Levels" bullets={r.sections.levels} />
      <Section title="💡 Trade Ideas" bullets={r.sections.ideas} />
      <Section title="✅ Example Scenario for Short Entry" bullets={r.sections.shortScenario} />
      <Section title="✅ Example Scenario for Long Entry" bullets={r.sections.longScenario} />
      <Section title="🌌 My Expectation (BotWick)" bullets={r.sections.expectation} />

      {oi && (
        <section className="space-y-1.5">
          <h2 className="text-sm font-bold">🎯 Options Idea</h2>
          <div className="rounded border border-black/10 dark:border-white/10 p-3 text-sm space-y-1">
            <div className="font-mono">
              {oi.direction === "long" ? "Call debit spread" : "Put debit spread"} ·{" "}
              {oi.longStrike}/{oi.shortStrike} {oi.direction === "long" ? "C" : "P"} ·{" "}
              {oi.expiration} ({oi.dteDays}d)
            </div>
            <p className="text-xs text-black/60 dark:text-white/60">{oi.note}</p>
            {riskGraphHref && (
              <a
                href={riskGraphHref}
                className="inline-block text-xs text-amber-600 dark:text-amber-300 hover:underline"
              >
                Open in Risk Graph →
              </a>
            )}
          </div>
        </section>
      )}
    </article>
  );
}
