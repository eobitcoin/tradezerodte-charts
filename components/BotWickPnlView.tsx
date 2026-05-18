"use client";

/**
 * BotWick — P&L tab.
 *
 * Admin-only. Live snapshot of the Tradier account behind the bot:
 *   - Today's day P&L (realized + unrealized)
 *   - Account equity / cash / market value
 *   - Open positions (decorated with live marks)
 *   - Today's closed positions per-trade
 *
 * Polls every 10s while the tab is open. Read-only; no mutations.
 */

import { useEffect, useState } from "react";

type Balances = {
  account_number: string;
  total_equity: number;
  total_cash: number;
  market_value: number;
  open_pl: number;
  close_pl: number;
  equity: number;
  long_market_value?: number;
  short_market_value?: number;
  account_type?: string;
};

type DecoratedPosition = {
  symbol: string;
  quantity: number;
  costBasis: number;
  avgEntry: number;
  liveMark: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  dateAcquired: string;
  kind: "option" | "equity";
};

type ClosedPosition = {
  close_date: string;
  open_date: string;
  symbol: string;
  quantity: number;
  cost: number;
  proceeds: number;
  gain_loss: number;
  gain_loss_percent: number;
  term: number;
};

type DailyBucket = {
  date: string;
  count: number;
  wins: number;
  losses: number;
  scratches: number;
  grossPnl: number;
  winningPnl: number;
  losingPnl: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
};

type PnlPayload = {
  ok: true;
  mode: "off" | "paper" | "live";
  reason?: string;
  fetchedAt?: string;
  balances: Balances | null;
  positions: DecoratedPosition[];
  selectedDay: string;
  historyDays: number;
  botOnly: boolean;
  botOccCount?: number | null;
  closedSelected: ClosedPosition[];
  dailyHistory: DailyBucket[];
  errors?: string[];
};

function fmtUsd(x: number | null | undefined, withSign = false): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const abs = Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = x < 0 ? "−" : withSign ? "+" : "";
  return `${sign}$${abs}`;
}

function fmtPct(x: number | null | undefined, places = 2): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(places)}%`;
}

function toneOf(x: number | null | undefined): "good" | "bad" | "neutral" {
  if (x == null || x === 0) return "neutral";
  return x > 0 ? "good" : "bad";
}

function toneClass(tone: "good" | "bad" | "neutral"): string {
  if (tone === "good") return "text-emerald-600 dark:text-emerald-300";
  if (tone === "bad") return "text-rose-500";
  return "";
}

const OCC_RE = /^([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

/** True if the symbol matches the OCC option format. Stocks fail this check. */
function looksLikeOcc(symbol: string): boolean {
  return OCC_RE.test(symbol);
}

/** Pretty-print an OCC symbol: "TSLA260513P00437500" → "TSLA 5/13 437.5 P".
 *  Returns the input unchanged for non-OCC symbols (e.g. plain tickers). */
function prettyOcc(occ: string): string {
  const m = OCC_RE.exec(occ);
  if (!m) return occ;
  const [, root, , mm, dd, cp, strike8] = m;
  const strike = Number(strike8) / 1000;
  return `${root} ${Number(mm)}/${Number(dd)} ${strike} ${cp}`;
}

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function BotWickPnlView() {
  const [data, setData] = useState<PnlPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Day shown in the "Closed positions" detail table. Defaults to today.
  // The dailyHistory table is always last 30 days regardless of this picker.
  const [selectedDay, setSelectedDay] = useState<string>(todayEt());
  // When true, filter closed-position tables to OCCs the bot has traded in the
  // history window. Open positions + balances stay account-wide.
  const [botOnly, setBotOnly] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const url = `/api/admin/botwick/pnl?day=${encodeURIComponent(selectedDay)}&botOnly=${botOnly}`;
        const res = await fetch(url, { cache: "no-store" });
        const j = (await res.json()) as PnlPayload | { error: string };
        if (cancelled) return;
        if (!res.ok || !("ok" in j)) {
          setErr(("error" in j ? j.error : null) ?? "failed to load P&L");
          setLoading(false);
          return;
        }
        setData(j);
        setErr(null);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setErr(String(e));
          setLoading(false);
        }
      }
    }
    load();
    // Only auto-refresh when viewing today; historical days are static.
    const t =
      selectedDay === todayEt() ? setInterval(load, 10_000) : null;
    return () => {
      cancelled = true;
      if (t) clearInterval(t);
    };
  }, [selectedDay, botOnly]);

  if (loading && !data) {
    return (
      <div className="rounded-lg border border-black/10 dark:border-white/10 p-8 text-center text-sm text-black/55 dark:text-white/55">
        Loading account snapshot from Tradier…
      </div>
    );
  }

  if (err) {
    return (
      <div className="rounded-lg border border-rose-500/40 bg-rose-500/[0.05] p-4 text-sm text-rose-600 dark:text-rose-300">
        {err}
      </div>
    );
  }

  if (!data) return null;

  if (data.mode === "off") {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.05] p-4 text-sm">
        {data.reason ?? "Bot mode is off. Switch to paper or live to see P&L."}
      </div>
    );
  }

  const b = data.balances;
  const openPlTone = toneOf(b?.open_pl);
  const closePlTone = toneOf(b?.close_pl);
  const dayPl = (b?.open_pl ?? 0) + (b?.close_pl ?? 0);
  const dayPlTone = toneOf(dayPl);

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">P&L</h1>
          <p className="text-sm text-black/60 dark:text-white/60 mt-1">
            Live Tradier account snapshot · mode{" "}
            <span className="font-mono uppercase">{data.mode}</span>
            {b?.account_number ? (
              <>
                {" · acct ••"}
                <span className="font-mono">{b.account_number.slice(-4)}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={botOnly}
              onChange={(e) => setBotOnly(e.target.checked)}
              className="cursor-pointer accent-emerald-500"
            />
            <span className="uppercase tracking-widest text-[10px] text-black/65 dark:text-white/65">
              Bot trades only
            </span>
            {botOnly && data.botOccCount != null && (
              <span className="text-[10px] text-black/45 dark:text-white/45 font-mono">
                · {data.botOccCount} OCCs
              </span>
            )}
          </label>
          <span className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45 font-mono">
            {data.fetchedAt
              ? `updated ${new Date(data.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
              : ""}
            {selectedDay === todayEt() ? " · auto-refresh 10s" : " · static (historical)"}
          </span>
        </div>
      </header>

      {/* Headline cards */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Big
          label="Day P&L"
          value={fmtUsd(dayPl, true)}
          sub={`realized ${fmtUsd(b?.close_pl, true)} · open ${fmtUsd(b?.open_pl, true)}`}
          tone={dayPlTone}
        />
        <Big
          label="Account equity"
          value={fmtUsd(b?.total_equity)}
          sub={b?.account_type ? `account · ${b.account_type}` : undefined}
        />
        <Big label="Cash" value={fmtUsd(b?.total_cash)} sub="settled + available" />
        <Big
          label="Market value"
          value={fmtUsd(b?.market_value)}
          sub={`long ${fmtUsd(b?.long_market_value)}`}
        />
      </section>

      {/* Realized vs unrealized breakout */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PnlCard
          title="Realized today"
          value={fmtUsd(b?.close_pl, true)}
          sub={`${data.closedSelected.length} closed position${data.closedSelected.length === 1 ? "" : "s"}`}
          tone={closePlTone}
        />
        <PnlCard
          title="Unrealized (open)"
          value={fmtUsd(b?.open_pl, true)}
          sub={`${data.positions.length} open position${data.positions.length === 1 ? "" : "s"}`}
          tone={openPlTone}
        />
      </section>

      {/* Open positions */}
      <section className="rounded-lg border border-black/10 dark:border-white/10">
        <header className="flex items-baseline justify-between px-4 py-3 border-b border-black/10 dark:border-white/10">
          <h2 className="text-sm font-semibold">Open positions</h2>
          <span className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
            {data.positions.length}
          </span>
        </header>
        {data.positions.length === 0 ? (
          <div className="px-4 py-6 text-sm text-black/55 dark:text-white/55 text-center">
            No open positions.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="text-black/55 dark:text-white/55 uppercase tracking-widest text-[10px]">
                <tr className="border-b border-black/10 dark:border-white/10">
                  <th className="text-left px-4 py-2">Contract</th>
                  <th className="text-right px-4 py-2">Qty</th>
                  <th className="text-right px-4 py-2">Entry</th>
                  <th className="text-right px-4 py-2">Mark</th>
                  <th className="text-right px-4 py-2">Cost</th>
                  <th className="text-right px-4 py-2">Value</th>
                  <th className="text-right px-4 py-2">Unreal P&L</th>
                  <th className="text-right px-4 py-2">%</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p) => {
                  const tone = toneOf(p.unrealizedPnl);
                  return (
                    <tr key={`${p.symbol}-${p.dateAcquired}`} className="border-b border-black/5 dark:border-white/5 last:border-b-0">
                      <td className="px-4 py-2">
                        <div>{p.kind === "option" ? prettyOcc(p.symbol) : p.symbol}</div>
                        {p.kind === "option" && (
                          <div className="text-[10px] text-black/45 dark:text-white/45">{p.symbol}</div>
                        )}
                      </td>
                      <td className="text-right px-4 py-2">{p.quantity}</td>
                      <td className="text-right px-4 py-2">{fmtUsd(p.avgEntry)}</td>
                      <td className="text-right px-4 py-2">{p.liveMark == null ? "—" : fmtUsd(p.liveMark)}</td>
                      <td className="text-right px-4 py-2">{fmtUsd(p.costBasis)}</td>
                      <td className="text-right px-4 py-2">{fmtUsd(p.marketValue)}</td>
                      <td className={`text-right px-4 py-2 font-semibold ${toneClass(tone)}`}>
                        {fmtUsd(p.unrealizedPnl, true)}
                      </td>
                      <td className={`text-right px-4 py-2 ${toneClass(tone)}`}>
                        {fmtPct(p.unrealizedPnlPct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Closed positions — day-selectable */}
      <section className="rounded-lg border border-black/10 dark:border-white/10">
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-black/10 dark:border-white/10">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Closed positions</h2>
            <span className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
              {data.closedSelected.length}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <label className="text-black/55 dark:text-white/55 uppercase tracking-widest text-[10px]">
              Day (ET)
            </label>
            <input
              type="date"
              value={selectedDay}
              max={todayEt()}
              onChange={(e) => setSelectedDay(e.target.value)}
              className="rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-xs"
            />
            {selectedDay !== todayEt() && (
              <button
                type="button"
                onClick={() => setSelectedDay(todayEt())}
                className="text-[10px] uppercase tracking-widest text-emerald-700 dark:text-emerald-400 hover:underline"
              >
                Jump to today
              </button>
            )}
          </div>
        </header>
        {data.closedSelected.length === 0 ? (
          <div className="px-4 py-6 text-sm text-black/55 dark:text-white/55 text-center">
            No {botOnly ? "bot-traded " : ""}closed positions on {selectedDay}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="text-black/55 dark:text-white/55 uppercase tracking-widest text-[10px]">
                <tr className="border-b border-black/10 dark:border-white/10">
                  <th className="text-left px-4 py-2">Position</th>
                  <th className="text-right px-4 py-2">Qty</th>
                  <th className="text-right px-4 py-2">Cost</th>
                  <th className="text-right px-4 py-2">Proceeds</th>
                  <th className="text-right px-4 py-2">P&L</th>
                  <th className="text-right px-4 py-2">%</th>
                  <th className="text-right px-4 py-2">Closed</th>
                </tr>
              </thead>
              <tbody>
                {data.closedSelected.map((c, i) => {
                  const tone = toneOf(c.gain_loss);
                  return (
                    <tr key={`${c.symbol}-${c.close_date}-${i}`} className="border-b border-black/5 dark:border-white/5 last:border-b-0">
                      <td className="px-4 py-2">
                        {looksLikeOcc(c.symbol) ? (
                          <>
                            <div>{prettyOcc(c.symbol)}</div>
                            <div className="text-[10px] text-black/45 dark:text-white/45">{c.symbol}</div>
                          </>
                        ) : (
                          <div>
                            {c.symbol}
                            <span className="ml-2 text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45">stock</span>
                          </div>
                        )}
                      </td>
                      <td className="text-right px-4 py-2">{c.quantity}</td>
                      <td className="text-right px-4 py-2">{fmtUsd(c.cost)}</td>
                      <td className="text-right px-4 py-2">{fmtUsd(c.proceeds)}</td>
                      <td className={`text-right px-4 py-2 font-semibold ${toneClass(tone)}`}>
                        {fmtUsd(c.gain_loss, true)}
                      </td>
                      <td className={`text-right px-4 py-2 ${toneClass(tone)}`}>
                        {fmtPct(c.gain_loss_percent)}
                      </td>
                      <td className="text-right px-4 py-2 text-black/55 dark:text-white/55">
                        {c.close_date ? new Date(c.close_date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {data.closedSelected.length > 1 && (
                <tfoot>
                  <tr className="border-t border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]">
                    <td className="px-4 py-2 font-semibold uppercase text-[10px] tracking-widest">Total</td>
                    <td className="text-right px-4 py-2">
                      {data.closedSelected.reduce((a, c) => a + c.quantity, 0)}
                    </td>
                    <td className="text-right px-4 py-2">
                      {fmtUsd(data.closedSelected.reduce((a, c) => a + c.cost, 0))}
                    </td>
                    <td className="text-right px-4 py-2">
                      {fmtUsd(data.closedSelected.reduce((a, c) => a + c.proceeds, 0))}
                    </td>
                    <td className={`text-right px-4 py-2 font-semibold ${toneClass(toneOf(data.closedSelected.reduce((a, c) => a + c.gain_loss, 0)))}`}>
                      {fmtUsd(data.closedSelected.reduce((a, c) => a + c.gain_loss, 0), true)}
                    </td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </section>

      {/* Daily history — last N days at a glance */}
      <DailyHistorySection
        history={data.dailyHistory}
        historyDays={data.historyDays}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
      />

      {data.errors && data.errors.length > 0 && (
        <details className="rounded-lg border border-amber-500/40 bg-amber-500/[0.05] px-4 py-3">
          <summary className="cursor-pointer text-xs uppercase tracking-widest text-amber-700 dark:text-amber-300">
            Tradier warnings ({data.errors.length})
          </summary>
          <ul className="mt-2 list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">
            {data.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Big({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "neutral";
}) {
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 p-4">
      <div className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
        {label}
      </div>
      <div className={`text-2xl font-mono font-semibold mt-1 ${toneClass(tone)}`}>{value}</div>
      {sub && <div className="text-[11px] text-black/55 dark:text-white/55 mt-1 font-mono">{sub}</div>}
    </div>
  );
}

function PnlCard({
  title,
  value,
  sub,
  tone,
}: {
  title: string;
  value: string;
  sub: string;
  tone: "good" | "bad" | "neutral";
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        tone === "good"
          ? "border-emerald-500/30 bg-emerald-500/[0.04]"
          : tone === "bad"
            ? "border-rose-500/30 bg-rose-500/[0.04]"
            : "border-black/10 dark:border-white/10"
      }`}
    >
      <div className="text-xs uppercase tracking-widest text-black/55 dark:text-white/55">
        {title}
      </div>
      <div className={`text-3xl font-mono font-semibold mt-1 ${toneClass(tone)}`}>{value}</div>
      <div className="text-xs text-black/55 dark:text-white/55 mt-1">{sub}</div>
    </div>
  );
}

function DailyHistorySection({
  history,
  historyDays,
  selectedDay,
  onSelectDay,
}: {
  history: DailyBucket[];
  historyDays: number;
  selectedDay: string;
  onSelectDay: (d: string) => void;
}) {
  // Only show days with activity in the table — but keep the totals across
  // the full window so the user understands the period.
  const activeDays = history.filter((d) => d.count > 0);
  const totalPnl = activeDays.reduce((s, d) => s + d.grossPnl, 0);
  const totalTrades = activeDays.reduce((s, d) => s + d.count, 0);
  const totalWins = activeDays.reduce((s, d) => s + d.wins, 0);
  const totalLosses = activeDays.reduce((s, d) => s + d.losses, 0);
  const overallWinRate = totalWins + totalLosses > 0 ? totalWins / (totalWins + totalLosses) : 0;
  const greenDays = activeDays.filter((d) => d.grossPnl > 0).length;
  const redDays = activeDays.filter((d) => d.grossPnl < 0).length;

  return (
    <section className="rounded-lg border border-black/10 dark:border-white/10">
      <header className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3 border-b border-black/10 dark:border-white/10">
        <div>
          <h2 className="text-sm font-semibold">Daily history</h2>
          <p className="text-[11px] text-black/55 dark:text-white/55 mt-0.5">
            Last {historyDays} days · click any row to load that day in the table above
          </p>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs font-mono">
          <span className="text-black/55 dark:text-white/55 uppercase tracking-widest text-[10px]">Period</span>
          <span className={toneClass(toneOf(totalPnl))}>
            <strong>{fmtUsd(totalPnl, true)}</strong>
          </span>
          <span className="text-black/55 dark:text-white/55">{totalTrades} trades</span>
          <span className="text-black/55 dark:text-white/55">
            {greenDays}↑ / {redDays}↓ days
          </span>
          <span className="text-black/55 dark:text-white/55">
            {(overallWinRate * 100).toFixed(0)}% win
          </span>
        </div>
      </header>
      {activeDays.length === 0 ? (
        <div className="px-4 py-6 text-sm text-black/55 dark:text-white/55 text-center">
          No closed positions in the last {historyDays} days.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="text-black/55 dark:text-white/55 uppercase tracking-widest text-[10px]">
              <tr className="border-b border-black/10 dark:border-white/10">
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-right px-4 py-2">Trades</th>
                <th className="text-right px-4 py-2">W / L</th>
                <th className="text-right px-4 py-2">Win %</th>
                <th className="text-right px-4 py-2">Avg win</th>
                <th className="text-right px-4 py-2">Avg loss</th>
                <th className="text-right px-4 py-2">Day P&L</th>
              </tr>
            </thead>
            <tbody>
              {activeDays.map((d) => {
                const tone = toneOf(d.grossPnl);
                const isSelected = d.date === selectedDay;
                return (
                  <tr
                    key={d.date}
                    onClick={() => onSelectDay(d.date)}
                    className={`border-b border-black/5 dark:border-white/5 last:border-b-0 cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04] ${isSelected ? "bg-emerald-500/[0.06]" : ""}`}
                  >
                    <td className="px-4 py-2 font-semibold">
                      {d.date}
                      {isSelected && (
                        <span className="ml-2 text-[10px] uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                          shown above
                        </span>
                      )}
                    </td>
                    <td className="text-right px-4 py-2">{d.count}</td>
                    <td className="text-right px-4 py-2">
                      <span className="text-emerald-600 dark:text-emerald-300">{d.wins}</span>
                      {" / "}
                      <span className="text-rose-500">{d.losses}</span>
                      {d.scratches > 0 && <span className="text-black/45 dark:text-white/45"> · {d.scratches}=</span>}
                    </td>
                    <td className="text-right px-4 py-2">{(d.winRate * 100).toFixed(0)}%</td>
                    <td className="text-right px-4 py-2 text-emerald-600 dark:text-emerald-300">
                      {d.wins > 0 ? fmtUsd(d.avgWin, true) : "—"}
                    </td>
                    <td className="text-right px-4 py-2 text-rose-500">
                      {d.losses > 0 ? fmtUsd(d.avgLoss, true) : "—"}
                    </td>
                    <td className={`text-right px-4 py-2 font-semibold ${toneClass(tone)}`}>
                      {fmtUsd(d.grossPnl, true)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
