import Link from "next/link";
import { renderMarkdown } from "@/lib/markdown";
import {
  GROUP_LABELS,
  GROUP_ORDER,
  PIN_TICKERS,
  RETAIL_TICKERS,
  fmtMoney,
  fmtNum,
  fmtPct,
  groupTickers,
  pctFromSpot,
  regimeColors,
  severityColors,
} from "@/lib/max-pain";
import type { MaxPainPost, MaxPainTicker, MaxPainAlert } from "@/lib/db/schema";

/**
 * Format the scan's run_at timestamp as "H:MM AM/PM ET · Day".
 * Used in the per-ticker header so users see exactly when each
 * snapshot was taken — Tradier's `quote.last` is a point-in-time
 * value and the spot can drift through the session.
 */
function fmtRunAtEt(runAt: Date | string): string {
  const d = runAt instanceof Date ? runAt : new Date(runAt);
  const time = d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const day = d.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  });
  return `${time} ET ${day}`;
}

function tickerHref(date: string | null, ticker: string): string {
  if (!date) return `/maxpain?ticker=${encodeURIComponent(ticker)}`;
  return `/maxpain/${date}?ticker=${encodeURIComponent(ticker)}`;
}

function tagBadge(tag: string): string {
  switch (tag) {
    case "RETAIL":
      return "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30";
    case "PIN":
      return "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30";
    case "EST":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
    case "STALE":
      return "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30";
  }
  return "bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60 border-black/10 dark:border-white/10";
}

function levelTile({
  label,
  strike,
  spot,
}: {
  label: string;
  strike?: number;
  spot?: number;
}) {
  const delta = pctFromSpot(strike, spot);
  const aboveSpot = strike != null && spot != null && strike > spot;
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 p-3 bg-black/[0.015] dark:bg-white/[0.015]">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
        {label}
      </div>
      <div className="font-mono font-semibold text-lg mt-0.5">{fmtNum(strike)}</div>
      {delta != null && (
        <div
          className={`text-xs font-mono ${
            aboveSpot ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
          }`}
        >
          {fmtPct(delta)}
        </div>
      )}
    </div>
  );
}

export default async function MaxPainView({
  post,
  active,
  scanDate,
}: {
  post: MaxPainPost;
  active: MaxPainTicker;
  scanDate: string | null; // null when on /maxpain (latest), the date string on /maxpain/[date]
}) {
  const tickers = (post.tickers ?? []) as MaxPainTicker[];
  const alerts = (post.alerts ?? []) as MaxPainAlert[];
  const grouped = groupTickers(tickers);
  const html = post.bodyMd ? await renderMarkdown(post.bodyMd, []) : "";

  const tickerAlerts = alerts.filter((a) => a.ticker.toUpperCase() === active.ticker.toUpperCase());
  const alertsByTicker = new Map<string, MaxPainAlert[]>();
  for (const a of alerts) {
    const k = a.ticker.toUpperCase();
    if (!alertsByTicker.has(k)) alertsByTicker.set(k, []);
    alertsByTicker.get(k)!.push(a);
  }

  const counts = { HIGH: 0, MED: 0, LOW: 0 };
  for (const a of alerts) counts[a.severity] += 1;

  const expirations = active.expirations ?? [];
  const sortedExpirations = [...expirations].sort((a, b) => (a.dte ?? 0) - (b.dte ?? 0)).slice(0, 10);
  const frontMonthExp = sortedExpirations[0]?.exp;

  return (
    <div className="space-y-6">
      {/* Alert Banner */}
      {alerts.length > 0 ? (
        <div className="rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-3 text-sm flex items-center gap-4 flex-wrap">
          <span className="font-semibold uppercase tracking-wide text-xs text-black/60 dark:text-white/60">
            Alerts
          </span>
          {counts.HIGH > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span className="font-mono">{counts.HIGH} HIGH</span>
            </span>
          )}
          {counts.MED > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="font-mono">{counts.MED} MED</span>
            </span>
          )}
          {counts.LOW > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-black/40 dark:bg-white/40" />
              <span className="font-mono">{counts.LOW} LOW</span>
            </span>
          )}
          {post.runAt && (
            <span className="ml-auto text-xs text-black/50 dark:text-white/50 font-mono">
              Last run: {new Date(post.runAt).toLocaleString("en-US", {
                timeZone: "America/New_York",
                dateStyle: "short",
                timeStyle: "short",
              })} ET
            </span>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-black/15 dark:border-white/15 p-3 text-sm text-black/60 dark:text-white/60">
          No new signals — last run {post.runAt
            ? new Date(post.runAt).toLocaleString("en-US", {
                timeZone: "America/New_York",
                dateStyle: "short",
                timeStyle: "short",
              }) + " ET"
            : "—"}
        </div>
      )}

      {/* Detail layout: 22% sidebar + 78% main, on desktop. Stack on mobile. */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-6">
        {/* Right-pane (left on desktop now): ticker list grouped */}
        <aside className="space-y-5">
          {GROUP_ORDER.map((g) => {
            const list = grouped[g];
            if (!list || list.length === 0) return null;
            return (
              <div key={g}>
                <h3 className="text-[10px] font-semibold uppercase tracking-wide text-black/50 dark:text-white/50 px-1 pb-1.5">
                  {GROUP_LABELS[g]}
                </h3>
                <ul className="space-y-1">
                  {list.map((t) => {
                    const isActive = t.ticker.toUpperCase() === active.ticker.toUpperCase();
                    const rc = regimeColors(t.regime);
                    const tickerAlerts = alertsByTicker.get(t.ticker.toUpperCase()) ?? [];
                    const highestSeverity = tickerAlerts.reduce<string>((acc, a) => {
                      if (a.severity === "HIGH") return "HIGH";
                      if (a.severity === "MED" && acc !== "HIGH") return "MED";
                      if (a.severity === "LOW" && !acc) return "LOW";
                      return acc;
                    }, "");
                    const isPin = PIN_TICKERS.has(t.ticker.toUpperCase());
                    const isRetail = RETAIL_TICKERS.has(t.ticker.toUpperCase());
                    return (
                      <li key={t.ticker}>
                        <Link
                          href={tickerHref(scanDate, t.ticker)}
                          className={[
                            "block rounded-md border-l-4 pl-2.5 pr-2 py-1.5 transition-colors",
                            rc.border,
                            isActive
                              ? "bg-black/[0.05] dark:bg-white/[0.06] border border-black/20 dark:border-white/20"
                              : "border border-transparent hover:bg-black/[0.025] dark:hover:bg-white/[0.03]",
                          ].join(" ")}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-mono font-semibold text-sm">{t.ticker}</span>
                              {isPin && (
                                <span className="text-[8px] font-semibold uppercase px-1 py-px rounded bg-violet-500/10 text-violet-700 dark:text-violet-300">
                                  PIN
                                </span>
                              )}
                              {highestSeverity && (
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    severityColors(highestSeverity as never).dot
                                  }`}
                                  title={`${tickerAlerts.length} alert${tickerAlerts.length === 1 ? "" : "s"}`}
                                />
                              )}
                            </div>
                            <span
                              className={`text-[9px] font-mono font-semibold px-1 py-0.5 rounded border ${rc.pill}`}
                            >
                              {rc.label}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-0.5 text-[10px] font-mono text-black/55 dark:text-white/55">
                            <span>{fmtNum(t.spot)}</span>
                            <span>
                              MP {fmtNum(t.frontMonthMaxPain)}
                              {t.frontMonthMaxPain != null && t.spot != null && (
                                <span className="ml-1 text-black/40 dark:text-white/40">
                                  ({fmtPct(pctFromSpot(t.frontMonthMaxPain, t.spot), 1)})
                                </span>
                              )}
                            </span>
                            {isRetail && (
                              <span className="text-[8px] font-semibold uppercase px-1 py-px rounded bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                                RET
                              </span>
                            )}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </aside>

        {/* Main pane: detail for active ticker */}
        <main className="min-w-0 space-y-6">
          {/* Header strip */}
          <div className="flex items-baseline justify-between gap-3 flex-wrap pb-3 border-b border-black/10 dark:border-white/10">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h2 className="text-2xl font-bold tracking-tight font-mono">{active.ticker}</h2>
              <span className="font-mono text-lg">{fmtNum(active.spot)}</span>
              {post.runAt && (
                <span
                  className="text-[11px] font-mono text-black/50 dark:text-white/50 italic"
                  title="Spot price was captured at scan time. It does not auto-refresh."
                >
                  (as of {fmtRunAtEt(post.runAt)})
                </span>
              )}
              <span
                className={`inline-block px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border ${
                  regimeColors(active.regime).pill
                }`}
              >
                {regimeColors(active.regime).label}
              </span>
              {(active.tags ?? []).map((t) => (
                <span
                  key={t}
                  className={`inline-block px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded border ${tagBadge(t)}`}
                >
                  {t}
                </span>
              ))}
            </div>
            {active.source && (
              <div className="text-[10px] font-mono text-black/50 dark:text-white/50">
                {active.source}
              </div>
            )}
          </div>

          {/* Section 1 — Key levels */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {levelTile({ label: "Max Pain", strike: active.frontMonthMaxPain, spot: active.spot })}
            {levelTile({ label: "Zero-γ Flip", strike: active.flipStrike, spot: active.spot })}
            {levelTile({ label: "Call Wall", strike: active.callWall, spot: active.spot })}
            {levelTile({ label: "Put Wall", strike: active.putWall, spot: active.spot })}
          </section>

          {/* Section 2 — Active alerts for this ticker */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
              Active alerts for {active.ticker}
            </h3>
            {tickerAlerts.length === 0 ? (
              <div className="text-sm text-black/50 dark:text-white/50 italic">No active signals.</div>
            ) : (
              <ul className="space-y-1.5">
                {tickerAlerts.map((a, i) => {
                  const sc = severityColors(a.severity);
                  return (
                    <li
                      key={a.id ?? i}
                      className="flex items-baseline gap-2 rounded border border-black/10 dark:border-white/10 px-3 py-2 text-sm"
                    >
                      <span className={`w-2 h-2 rounded-full ${sc.dot} shrink-0 translate-y-0.5`} />
                      <span className={`shrink-0 inline-block px-1.5 py-0.5 text-[9px] font-semibold rounded border ${sc.pill}`}>
                        {a.severity}
                      </span>
                      <span className="font-mono text-[10px] text-black/50 dark:text-white/50 shrink-0">
                        {a.type}
                      </span>
                      <span>{a.message}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Section 3 — Expirations table */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
              Expirations (next {sortedExpirations.length})
            </h3>
            {sortedExpirations.length === 0 ? (
              <div className="text-sm text-black/50 dark:text-white/50 italic">No expiration data.</div>
            ) : (
              <div className="overflow-x-auto border border-black/10 dark:border-white/10 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
                    <tr className="text-left">
                      <th className="px-3 py-2">Expiry</th>
                      <th className="px-3 py-2 text-right">DTE</th>
                      <th className="px-3 py-2 text-right">Max Pain</th>
                      <th className="px-3 py-2 text-right">Spot Δ%</th>
                      <th className="px-3 py-2 text-right">Call OI</th>
                      <th className="px-3 py-2 text-right">Put OI</th>
                      <th className="px-3 py-2 text-right">P/C</th>
                      <th className="px-3 py-2 text-right">Net GEX ($M)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedExpirations.map((e) => {
                      const isFront = e.exp === frontMonthExp;
                      const delta = pctFromSpot(e.maxPain, e.spot ?? active.spot);
                      const gexCls = e.netGEX == null
                        ? ""
                        : e.netGEX > 0
                          ? "text-emerald-700 dark:text-emerald-300"
                          : "text-rose-700 dark:text-rose-300";
                      return (
                        <tr
                          key={e.exp}
                          className={[
                            "border-t border-black/10 dark:border-white/10 align-top font-mono",
                            isFront ? "bg-amber-500/5" : "",
                          ].join(" ")}
                        >
                          <td className="px-3 py-2">
                            {e.exp}
                            {isFront && (
                              <span className="ml-2 text-[9px] font-semibold uppercase text-amber-700 dark:text-amber-300">
                                FRONT
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">{e.dte ?? "—"}</td>
                          <td className="px-3 py-2 text-right">{fmtNum(e.maxPain)}</td>
                          <td className="px-3 py-2 text-right">{delta != null ? fmtPct(delta, 1) : "—"}</td>
                          <td className="px-3 py-2 text-right">{e.callOI != null ? e.callOI.toLocaleString() : "—"}</td>
                          <td className="px-3 py-2 text-right">{e.putOI != null ? e.putOI.toLocaleString() : "—"}</td>
                          <td className="px-3 py-2 text-right">{e.pcRatio != null ? e.pcRatio.toFixed(2) : "—"}</td>
                          <td className={`px-3 py-2 text-right ${gexCls}`}>{fmtNum(e.netGEX)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {active.totalGEX != null && (
              <div className="text-xs text-black/60 dark:text-white/60 font-mono">
                Total Net GEX: <span className="font-semibold">{fmtMoney(active.totalGEX)}</span> per 1%
              </div>
            )}
          </section>

          {/* Notes */}
          {active.notes && (
            <section className="text-sm text-black/70 dark:text-white/70 border-l-2 border-black/15 dark:border-white/15 pl-3">
              {active.notes}
            </section>
          )}

          {/* Body markdown (if any) */}
          {html && (
            <section
              className="prose prose-neutral dark:prose-invert max-w-none border-t border-black/10 dark:border-white/10 pt-4"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
