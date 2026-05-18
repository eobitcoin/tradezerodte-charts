import Link from "next/link";
import { loadScorecard, type SessionRow, type TickerRow } from "@/lib/scorecard";

function fmtPnl(x: number): string {
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(0)}%`;
}

function fmtPct(x: number | null): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${Math.round(x * 100)}%`;
}

function fmtDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default async function ScorecardView() {
  const data = await loadScorecard();
  const { sessions, overall, tickers } = data;

  if (overall.sessionCount === 0) {
    return (
      <main className="max-w-4xl lg:max-w-5xl mx-auto px-4 py-12 font-sans text-center space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Scorecard</h1>
        <p className="text-sm text-white/65 max-w-prose mx-auto">
          No settlement posts published yet. Once the 4:15 PM ET settlement
          routine writes its first session, your per-day P&amp;L, win rate, and
          per-ticker breakdown will populate here.
        </p>
        <div className="pt-2">
          <Link
            href="/learn/scorecard"
            className="text-xs text-white/55 hover:text-white hover:underline"
          >
            Help · how to read this →
          </Link>
        </div>
      </main>
    );
  }

  // Time-series chart: most-recent first, but render oldest → newest in the
  // bar chart so the cumulative line reads left-to-right.
  const chartSessions = [...sessions].reverse();
  const maxAbs = Math.max(
    1,
    ...chartSessions.map((s) => Math.abs(s.scorecard.netPnlPct)),
  );

  return (
    <main className="max-w-4xl lg:max-w-5xl mx-auto px-4 py-8 font-sans space-y-10">
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[10px] uppercase tracking-widest text-red-400">
            Scorecard · cross-session performance
          </div>
          <Link
            href="/learn/scorecard"
            className="text-xs text-white/55 hover:text-white hover:underline"
          >
            Help · how to read this →
          </Link>
        </div>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">
          {overall.sessionCount} {overall.sessionCount === 1 ? "session" : "sessions"} ·{" "}
          <span
            className={
              overall.netPnlPct > 0
                ? "text-emerald-300"
                : overall.netPnlPct < 0
                  ? "text-rose-300"
                  : "text-white/70"
            }
          >
            {fmtPnl(overall.netPnlPct)} net
          </span>
        </h1>
        <p className="text-xs text-white/55 max-w-prose">
          Every published settlement post folds into this scoreboard. Daily
          totals come from the deterministic engine; the LLM commentary on
          each card is decorative — the numbers here are computed.
        </p>
      </header>

      {/* HERO KPI STRIP */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label="Sessions" value={String(overall.sessionCount)} />
        <Kpi
          label="Net P&L"
          value={fmtPnl(overall.netPnlPct)}
          tone={overall.netPnlPct > 0 ? "good" : overall.netPnlPct < 0 ? "bad" : undefined}
        />
        <Kpi
          label="Win rate"
          value={fmtPct(overall.winRate)}
          sub={`${overall.wins} W · ${overall.losses} L`}
        />
        <Kpi
          label="Trades settled"
          value={String(overall.wins + overall.losses + overall.timeStops + overall.manualExits + overall.noFills)}
          sub={`of ${overall.totalTrades} total`}
        />
        <Kpi
          label="Best session"
          value={overall.bestSession ? fmtPnl(overall.bestSession.scorecard.netPnlPct) : "—"}
          sub={overall.bestSession ? fmtDate(overall.bestSession.tradingDay) : undefined}
          tone={overall.bestSession ? "good" : undefined}
          href={overall.bestSession ? `/posts/${overall.bestSession.tradingDay}?tab=trade_cards` : undefined}
        />
      </section>

      {/* SESSION P&L TIME SERIES */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold tracking-tight">Session P&amp;L</h2>
          <span className="text-xs text-white/45 font-mono">
            last {chartSessions.length} {chartSessions.length === 1 ? "session" : "sessions"}
          </span>
        </div>
        <SessionChart sessions={chartSessions} maxAbs={maxAbs} />
      </section>

      {/* PER-TICKER LEADERBOARD */}
      {tickers.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold tracking-tight">Tickers</h2>
            <span className="text-xs text-white/45 font-mono">
              {tickers.length} traded · sorted by net P&amp;L
            </span>
          </div>
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.02] border-b border-white/10 text-[10px] uppercase tracking-widest text-white/45">
                <tr>
                  <th className="text-left px-3 py-2 font-normal">Ticker</th>
                  <th className="text-right px-3 py-2 font-normal">Sessions</th>
                  <th className="text-right px-3 py-2 font-normal">W</th>
                  <th className="text-right px-3 py-2 font-normal">L</th>
                  <th className="text-right px-3 py-2 font-normal hidden sm:table-cell">
                    No-fill
                  </th>
                  <th className="text-right px-3 py-2 font-normal hidden sm:table-cell">
                    Time-stop
                  </th>
                  <th className="text-right px-3 py-2 font-normal">Win rate</th>
                  <th className="text-right px-3 py-2 font-normal">Net P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {tickers.map((t) => (
                  <TickerLeaderboardRow key={t.ticker} row={t} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* RECENT SESSIONS */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold tracking-tight">Recent sessions</h2>
        <ul className="space-y-2">
          {sessions.slice(0, 20).map((s) => (
            <RecentSessionRow key={s.tradingDay} session={s} />
          ))}
        </ul>
      </section>
    </main>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad";
  href?: string;
}) {
  const body = (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 space-y-0.5 h-full">
      <div className="text-[10px] uppercase tracking-widest text-white/45">{label}</div>
      <div
        className={`text-xl font-mono font-bold tracking-tight ${
          tone === "good"
            ? "text-emerald-300"
            : tone === "bad"
              ? "text-rose-300"
              : "text-white/85"
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-white/45 font-mono">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:border-red-500/40 transition-colors">
      {body}
    </Link>
  ) : (
    body
  );
}

function SessionChart({
  sessions,
  maxAbs,
}: {
  sessions: SessionRow[];
  maxAbs: number;
}) {
  const barWidth = `min(${Math.floor(100 / Math.max(sessions.length, 1))}%, 60px)`;
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <div
        className="flex items-end gap-1 sm:gap-2 h-40 border-b border-white/10 relative"
        aria-label="Session P&L bar chart"
      >
        {/* Zero baseline */}
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/15 pointer-events-none" />
        {sessions.map((s) => {
          const v = s.scorecard.netPnlPct;
          const heightPct = Math.min(100, (Math.abs(v) / maxAbs) * 50); // 50% = half of the 160px chart
          const isPositive = v >= 0;
          return (
            <Link
              key={s.tradingDay}
              href={`/posts/${s.tradingDay}?tab=trade_cards`}
              title={`${s.tradingDay} · ${fmtPnl(v)} · ${s.scorecard.wins}W ${s.scorecard.losses}L`}
              className="relative flex flex-col items-center justify-center h-full group flex-1"
              style={{ maxWidth: barWidth }}
            >
              <div className="absolute inset-x-0 top-1/2 flex flex-col items-center pointer-events-none">
                {isPositive ? (
                  <div
                    className="w-full bg-emerald-500/55 group-hover:bg-emerald-400/80 transition-colors rounded-t-sm origin-bottom"
                    style={{ height: `${heightPct}%`, transform: "translateY(-100%)" }}
                  />
                ) : (
                  <div
                    className="w-full bg-rose-500/55 group-hover:bg-rose-400/80 transition-colors rounded-b-sm"
                    style={{ height: `${heightPct}%` }}
                  />
                )}
              </div>
            </Link>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-white/45 font-mono mt-2">
        <span>{fmtDate(sessions[0].tradingDay)}</span>
        {sessions.length > 1 && (
          <span>{fmtDate(sessions[sessions.length - 1].tradingDay)}</span>
        )}
      </div>
    </div>
  );
}

function TickerLeaderboardRow({ row }: { row: TickerRow }) {
  const tone =
    row.netPnlPct > 0
      ? "text-emerald-300"
      : row.netPnlPct < 0
        ? "text-rose-300"
        : "text-white/70";
  return (
    <tr className="border-b border-white/5 last:border-b-0 hover:bg-white/[0.02]">
      <td className="px-3 py-2 font-bold tracking-tight">{row.ticker}</td>
      <td className="px-3 py-2 text-right font-mono text-white/70">{row.sessions}</td>
      <td className="px-3 py-2 text-right font-mono text-emerald-300">{row.wins}</td>
      <td className="px-3 py-2 text-right font-mono text-rose-300">{row.losses}</td>
      <td className="px-3 py-2 text-right font-mono text-white/55 hidden sm:table-cell">
        {row.noFills || "—"}
      </td>
      <td className="px-3 py-2 text-right font-mono text-white/55 hidden sm:table-cell">
        {row.timeStops || "—"}
      </td>
      <td className="px-3 py-2 text-right font-mono text-white/85">{fmtPct(row.winRate)}</td>
      <td className={`px-3 py-2 text-right font-mono font-bold ${tone}`}>
        {fmtPnl(row.netPnlPct)}
      </td>
    </tr>
  );
}

function RecentSessionRow({ session }: { session: SessionRow }) {
  const sc = session.scorecard;
  const tone =
    sc.netPnlPct > 0 ? "text-emerald-300" : sc.netPnlPct < 0 ? "text-rose-300" : "text-white/70";
  return (
    <li>
      <Link
        href={`/posts/${session.tradingDay}?tab=trade_cards`}
        className="flex flex-wrap items-baseline justify-between gap-3 rounded border border-white/10 bg-white/[0.02] hover:border-red-500/40 hover:bg-white/[0.03] px-4 py-3 transition-all"
      >
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-white/55 text-xs">{session.tradingDay}</span>
          <span className="text-sm text-white/85">{fmtDate(session.tradingDay)}</span>
        </div>
        <div className="flex items-baseline gap-3 text-xs font-mono">
          <span className="text-emerald-300">{sc.wins} W</span>
          <span className="text-rose-300">{sc.losses} L</span>
          {sc.timeStops > 0 && <span className="text-amber-300">{sc.timeStops} TS</span>}
          {sc.noFills > 0 && <span className="text-white/45">{sc.noFills} NF</span>}
          <span className={`text-base font-bold ${tone}`}>{fmtPnl(sc.netPnlPct)}</span>
        </div>
      </Link>
    </li>
  );
}
