"use client";

/**
 * Squeeze Scan (ST Squeeze Ultra) view. Top: up to 3 AI-analyzed headline
 * setups (LONG/SHORT call + suggested debit spread, deep-linked to Risk Graph).
 * Then hero counters + a ticker table with per-timeframe (Daily / Weekly)
 * squeeze state, ideal flag (long ↑ / short ↓), and momentum colour. Filter
 * chips narrow the table. Rows arrive pre-sorted ideal-first → tightest.
 */
import { useMemo, useState } from "react";
import type {
  SqueezeUltraScanData,
  SqueezeUltraRow,
  SqueezeUltraTf,
  SqueezeUltraSuggestion,
  SqueezeUltraOptionTrade,
} from "@/lib/db/schema";
import { legsToUrlParams } from "@/lib/earnings-trade-builder";

interface Props {
  scanDay: string;
  universeSize: number;
  computedSize: number;
  data: SqueezeUltraScanData;
}

function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}
function fmtVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}
function fmtIv(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}
function fmtExpiry(iso: string): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

const STATE_DOT: Record<number, string> = { 3: "bg-amber-400", 2: "bg-red-400", 1: "bg-white/40" };
const STATE_TEXT: Record<number, string> = { 3: "Tight", 2: "Mid", 1: "Wide" };
const MOM_DOT: Record<string, string> = {
  cyan: "bg-cyan-400",
  blue: "bg-blue-400",
  yellow: "bg-yellow-400",
  red: "bg-red-500",
};

type Filter = "all" | "ideal" | "daily" | "weekly";

function riskGraphUrl(symbol: string, t: SqueezeUltraOptionTrade): string {
  const type = t.strategy === "call_debit_spread" ? "call" : "put";
  return `/research/risk-graph?${legsToUrlParams({
    ticker: symbol,
    strategy: t.strategy,
    expiry: t.expiration,
    legs: [
      { side: "buy", type, strike: t.longStrike },
      { side: "sell", type, strike: t.shortStrike },
    ],
  })}`;
}

function TfCell({ tf }: { tf: SqueezeUltraTf }) {
  if (!tf.inSqueeze) return <span className="text-white/25">—</span>;
  const dot = tf.state != null ? STATE_DOT[tf.state] : "bg-white/30";
  const label = tf.state != null ? STATE_TEXT[tf.state] : "";
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} title={`Squeeze: ${label}`} />
      <span className="text-white/80">{label}</span>
      {tf.ideal && (
        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-300">
          Ideal ↑
        </span>
      )}
      {tf.idealShort && (
        <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-300">
          Ideal ↓
        </span>
      )}
      {tf.momColor && (
        <span className={`inline-block h-2 w-2 rounded-full ${MOM_DOT[tf.momColor] ?? "bg-white/30"}`} title={`Momentum: ${tf.momColor}`} />
      )}
    </div>
  );
}

export default function SqueezeUltraView({ scanDay, universeSize, computedSize, data }: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(() => {
    switch (filter) {
      case "ideal":
        return data.rows.filter((r) => r.daily.ideal || r.weekly.ideal || r.daily.idealShort || r.weekly.idealShort);
      case "daily":
        return data.rows.filter((r) => r.daily.inSqueeze);
      case "weekly":
        return data.rows.filter((r) => r.weekly.inSqueeze);
      default:
        return data.rows;
    }
  }, [data.rows, filter]);

  const c = data.counts;
  const suggestions = data.suggestions ?? [];

  return (
    <div className="space-y-6">
      {/* AI-analyzed headline setups */}
      {suggestions.length > 0 && (
        <section className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-amber-400">
            Top ideal setups · AI direction + trade
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {suggestions.map((s) => (
              <SuggestionCard key={s.symbol} s={s} />
            ))}
          </div>
        </section>
      )}

      {/* Hero counters */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Daily ideal ↑" value={c.dailyIdeal} accent="text-emerald-300" />
        <Stat label="Weekly ideal ↑" value={c.weeklyIdeal} accent="text-emerald-300" />
        <Stat label="Daily ideal ↓" value={c.dailyIdealShort ?? 0} accent="text-red-300" />
        <Stat label="Weekly ideal ↓" value={c.weeklyIdealShort ?? 0} accent="text-red-300" />
        <Stat label="Daily squeeze" value={c.dailySqueeze} accent="text-amber-300" />
        <Stat label="Weekly squeeze" value={c.weeklySqueeze} accent="text-amber-300" />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-[10px] uppercase tracking-widest text-amber-400">
            {computedSize} in-squeeze names · {universeSize} scanned
          </div>
          <div className="inline-flex rounded-md ring-1 ring-white/15 overflow-hidden text-xs">
            {(
              [
                ["all", "All"],
                ["ideal", "Ideal"],
                ["daily", "Daily"],
                ["weekly", "Weekly"],
              ] as Array<[Filter, string]>
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={`px-3 py-1 font-semibold ${filter === k ? "bg-amber-500/20 text-amber-300" : "text-white/55 hover:text-white"}`}
              >
                {lbl}
              </button>
            ))}
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
                <th className="text-left px-3 py-2">Daily</th>
                <th className="text-left px-3 py-2">Weekly</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Row key={r.symbol} r={r} idx={i + 1} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-white/40">
                    No names match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="text-[11px] text-white/40 leading-relaxed space-y-1">
        <p>
          Scan {scanDay}. Universe: every optionable US stock priced ≥ ${data.filters.minPrice} with daily volume
          &gt; {data.filters.minDayVolume.toLocaleString()}. Squeeze = Bollinger Bands inside Keltner Channels
          (ST Squeeze Ultra, length 21). State: <span className="text-amber-300">Tight</span> (1.0× KC),{" "}
          <span className="text-red-300">Mid</span> (1.5×), <span className="text-white/70">Wide</span> (2.0×).
          &quot;Ideal ↑&quot; = EMA 8&gt;13&gt;21 stacked &amp; rising with a Mid squeeze (bullish); &quot;Ideal ↓&quot;
          is the mirror (EMA stacked down &amp; falling, bearish). Momentum dot: cyan = up/accelerating, blue =
          up/fading, yellow = down/improving, red = down/accelerating.
        </p>
        <p>
          Not advice. A squeeze signals compression, not direction — the AI direction call and suggested debit
          spreads are educational, not recommendations. Confirm with your own trigger and risk plan.
        </p>
      </footer>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-lg ring-1 ring-white/10 bg-white/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-widest text-white/45">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

function Row({ r, idx }: { r: SqueezeUltraRow; idx: number }) {
  return (
    <tr className="border-t border-white/5 hover:bg-white/[0.02]">
      <td className="px-3 py-2 text-white/40 tabular-nums">{idx}</td>
      <td className="px-3 py-2 font-mono font-bold">{r.symbol}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtUsd(r.price)}</td>
      <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell text-white/55">{fmtVol(r.dayVolume)}</td>
      <td className="px-3 py-2">
        <TfCell tf={r.daily} />
      </td>
      <td className="px-3 py-2">
        <TfCell tf={r.weekly} />
      </td>
    </tr>
  );
}

function DirBadge({ dir }: { dir: "long" | "short" | "neutral" }) {
  const map = {
    long: "bg-emerald-500/15 text-emerald-300",
    short: "bg-red-500/15 text-red-300",
    neutral: "bg-white/10 text-white/55",
  } as const;
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${map[dir]}`}>
      {dir}
    </span>
  );
}

function SuggestionCard({ s }: { s: SqueezeUltraSuggestion }) {
  const t = s.optionTrade;
  const a = s.aiAnalysis;
  return (
    <article className="rounded-lg ring-1 ring-white/10 bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono font-bold text-lg">{s.symbol}</span>
          <DirBadge dir={a.direction} />
        </div>
        <span className="text-xs text-white/55">
          {fmtUsd(s.price)}
          {s.atmIv != null && ` · IV ${fmtIv(s.atmIv)}`}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-white/50">
        <span>
          Daily: {s.daily.inSqueeze ? `${STATE_TEXT[s.daily.state ?? 0] ?? "—"}${s.daily.ideal ? " ↑" : s.daily.idealShort ? " ↓" : ""}` : "—"}
        </span>
        <span>
          Weekly: {s.weekly.inSqueeze ? `${STATE_TEXT[s.weekly.state ?? 0] ?? "—"}${s.weekly.ideal ? " ↑" : s.weekly.idealShort ? " ↓" : ""}` : "—"}
        </span>
        <span className="text-white/40">conviction: {a.conviction}</span>
      </div>

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Why</div>
        <p className="text-xs text-white/75 leading-snug">{a.why}</p>
      </div>
      {a.risk && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Risk</div>
          <p className="text-xs text-white/70 leading-snug">{a.risk}</p>
        </div>
      )}

      {t ? (
        <div className="rounded-md ring-1 ring-white/[0.08] bg-white/[0.02] p-2.5 space-y-1.5 text-xs">
          <div className="flex items-baseline justify-between">
            <span className="font-semibold text-white/85">
              {t.direction === "long" ? "Call debit spread" : "Put debit spread"}
            </span>
            <span className="font-mono text-white/55">{t.dteDays}d</span>
          </div>
          <div className="font-mono text-white/70">
            {t.longStrike}/{t.shortStrike} {t.direction === "long" ? "C" : "P"} · {fmtExpiry(t.expiration)}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-white/55">
            <span>debit ${t.netDebit.toFixed(2)}</span>
            <span className="text-emerald-300">max +${t.maxProfit.toFixed(0)}</span>
            <span className="text-red-300">max −${t.maxLoss.toFixed(0)}</span>
            <span>BE ${t.breakeven.toFixed(2)}</span>
          </div>
          <a href={riskGraphUrl(s.symbol, t)} className="inline-block text-[11px] text-amber-300 hover:underline">
            Open in Risk Graph →
          </a>
        </div>
      ) : (
        <p className="text-[11px] text-white/40">No clean debit spread in the 25–50 DTE window.</p>
      )}
    </article>
  );
}
