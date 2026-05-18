"use client";

/**
 * BotWick — ARCHIVE tab.
 *
 * Admin-only. Lists archive batches created by the Reset & Archive action.
 * Click a batch to expand its events + trades. Pure read; no mutations.
 */

import { useEffect, useState } from "react";

type Batch = {
  archivedAt: string;
  actionCount: number;
  tradeCount: number;
};

type ArchivedAction = {
  id: string;
  ts: string;
  kind: string;
  severity: string;
  message: string;
  data: Record<string, unknown> | null;
};

type ArchivedTrade = {
  id: string;
  sourceTicker: string;
  strategy: string;
  status: string;
  signaledAt: string;
  closedAt: string | null;
  realizedPnlUsd: string | null;
  legs: Array<Record<string, unknown>> | null;
};

type BatchDetail = {
  batch: string;
  actions: ArchivedAction[];
  trades: ArchivedTrade[];
};

function severityToneClass(s: string): string {
  switch (s) {
    case "error":
      return "text-rose-500";
    case "warn":
      return "text-amber-600 dark:text-amber-300";
    case "success":
      return "text-emerald-600 dark:text-emerald-300";
    default:
      return "text-black/70 dark:text-white/70";
  }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtPnl(p: string | null): string {
  if (p == null) return "—";
  const n = Number(p);
  if (!Number.isFinite(n)) return p;
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function pnlClass(p: string | null): string {
  if (p == null) return "";
  const n = Number(p);
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-500";
}

export default function BotWickArchiveView() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, BatchDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/botwick/archive");
        const j = await res.json();
        if (!res.ok || !j.ok) {
          setErr(j.error ?? "failed to load archive");
        } else {
          setBatches(j.batches as Batch[]);
        }
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function toggle(batchIso: string) {
    if (expanded === batchIso) {
      setExpanded(null);
      return;
    }
    setExpanded(batchIso);
    if (details[batchIso]) return;
    setLoadingDetail(batchIso);
    try {
      const res = await fetch(`/api/admin/botwick/archive?batch=${encodeURIComponent(batchIso)}`);
      const j = await res.json();
      if (res.ok && j.ok) {
        setDetails((prev) => ({ ...prev, [batchIso]: j as BatchDetail }));
      }
    } finally {
      setLoadingDetail(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-black/10 dark:border-white/10 p-8 text-center text-sm text-black/55 dark:text-white/55">
        Loading archive…
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Archive</h1>
        <p className="text-sm text-black/60 dark:text-white/60 mt-1">
          Historical bot activity and trades from prior <em>Reset &amp; Archive</em> snapshots.
          Each batch corresponds to one reset event. Live trades (open / working / closing) are
          never archived — they remain on the Activity tab.
        </p>
      </header>

      {batches.length === 0 ? (
        <div className="rounded-lg border border-black/10 dark:border-white/10 p-8 text-center text-sm text-black/55 dark:text-white/55">
          No archived batches yet. Use <span className="font-mono">CONFIG → Reset &amp; Archive</span>{" "}
          to snapshot the current bot state into a new archive batch.
        </div>
      ) : (
        <ul className="space-y-3">
          {batches.map((b) => {
            const isOpen = expanded === b.archivedAt;
            const detail = details[b.archivedAt];
            return (
              <li
                key={b.archivedAt}
                className="rounded-lg border border-black/10 dark:border-white/10 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggle(b.archivedAt)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                >
                  <div>
                    <div className="text-sm font-semibold">{fmtTime(b.archivedAt)}</div>
                    <div className="text-xs text-black/55 dark:text-white/55 font-mono mt-0.5">
                      {b.actionCount} event{b.actionCount === 1 ? "" : "s"} ·{" "}
                      {b.tradeCount} trade{b.tradeCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  <span className="text-xs text-black/45 dark:text-white/45">{isOpen ? "▾" : "▸"}</span>
                </button>

                {isOpen && (
                  <div className="border-t border-black/10 dark:border-white/10 p-4 space-y-4">
                    {loadingDetail === b.archivedAt && !detail && (
                      <p className="text-xs text-black/55 dark:text-white/55">Loading…</p>
                    )}

                    {detail && detail.trades.length > 0 && (
                      <section>
                        <h3 className="text-xs uppercase tracking-widest text-black/55 dark:text-white/55 mb-2">
                          Trades ({detail.trades.length})
                        </h3>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs font-mono">
                            <thead className="text-black/55 dark:text-white/55 uppercase tracking-widest text-[10px]">
                              <tr className="border-b border-black/10 dark:border-white/10">
                                <th className="text-left py-1.5 px-2">Signaled</th>
                                <th className="text-left py-1.5 px-2">Ticker</th>
                                <th className="text-left py-1.5 px-2">Strategy</th>
                                <th className="text-left py-1.5 px-2">Status</th>
                                <th className="text-right py-1.5 px-2">P&amp;L</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.trades.map((t) => (
                                <tr key={t.id} className="border-b border-black/5 dark:border-white/5 last:border-b-0">
                                  <td className="py-1.5 px-2">{fmtTime(t.signaledAt)}</td>
                                  <td className="py-1.5 px-2">{t.sourceTicker}</td>
                                  <td className="py-1.5 px-2 text-black/65 dark:text-white/65">{t.strategy}</td>
                                  <td className="py-1.5 px-2 text-black/65 dark:text-white/65">{t.status}</td>
                                  <td className={`py-1.5 px-2 text-right font-semibold ${pnlClass(t.realizedPnlUsd)}`}>
                                    {fmtPnl(t.realizedPnlUsd)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    )}

                    {detail && detail.actions.length > 0 && (
                      <section>
                        <h3 className="text-xs uppercase tracking-widest text-black/55 dark:text-white/55 mb-2">
                          Events ({detail.actions.length})
                        </h3>
                        <ul className="space-y-1 font-mono text-xs">
                          {detail.actions.map((a) => (
                            <li
                              key={a.id}
                              className={`py-1 border-b border-black/5 dark:border-white/5 last:border-b-0 ${severityToneClass(a.severity)}`}
                            >
                              <span className="text-black/45 dark:text-white/45">{fmtTime(a.ts)}</span>{" "}
                              <span className="text-black/45 dark:text-white/45">[{a.kind}]</span>{" "}
                              {a.message}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {detail && detail.actions.length === 0 && detail.trades.length === 0 && (
                      <p className="text-xs text-black/55 dark:text-white/55">Empty batch.</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
