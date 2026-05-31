import Link from "next/link";
import type { LeapPick } from "@/lib/db/schema";

/**
 * Performance tracker for the LEAPs scanner.
 *
 * Lists every historical pick with: ticker, contract, scan_day,
 * entry premium, current premium, P&L %, days held, days to expiry.
 * Sorted by P&L descending so the winners surface first.
 *
 * The "Current" column is fed by leap_pick_marks (daily snapshot).
 * Picks without a mark yet show "—" until the next mark cron tick.
 */

export interface LeapPickWithMark extends LeapPick {
  latestMark: {
    premiumMid: number | null;
    underlyingPrice: number | null;
    markTs: Date;
  } | null;
}

interface Props {
  picks: LeapPickWithMark[];
}

function fmtUsd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}
function fmtStrike(v: number): string {
  return `$${v.toFixed(v >= 100 ? 0 : 2)}`;
}
function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}
function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((to - from) / 86_400_000));
}
function fmtRelTime(ts: Date): string {
  const ageMs = Date.now() - ts.getTime();
  const h = Math.floor(ageMs / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface PerformanceRow {
  pick: LeapPickWithMark;
  entryMid: number | null;
  currentMid: number | null;
  pnlPct: number | null;
  daysHeld: number;
  daysToExpiry: number;
}

function computeRow(pick: LeapPickWithMark, todayIso: string): PerformanceRow {
  const entryMid = pick.premiumMid ? Number(pick.premiumMid) : null;
  const currentMid = pick.latestMark?.premiumMid ?? null;
  const pnlPct =
    entryMid != null && currentMid != null && entryMid > 0
      ? ((currentMid - entryMid) / entryMid) * 100
      : null;
  return {
    pick,
    entryMid,
    currentMid,
    pnlPct,
    daysHeld: daysBetween(pick.scanDay, todayIso),
    daysToExpiry: daysBetween(todayIso, pick.expirationDate),
  };
}

function pnlTone(pnl: number | null): string {
  if (pnl == null) return "text-white/55";
  if (pnl >= 50) return "text-emerald-300 font-bold";
  if (pnl >= 10) return "text-emerald-400";
  if (pnl >= -10) return "text-white/85";
  if (pnl >= -50) return "text-rose-400";
  return "text-rose-300 font-bold";
}

export default function LeapPerformanceTable({ picks }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = picks
    .map((p) => computeRow(p, today))
    .sort((a, b) => {
      // Sort by P&L desc, nulls last
      if (a.pnlPct == null && b.pnlPct == null) return 0;
      if (a.pnlPct == null) return 1;
      if (b.pnlPct == null) return -1;
      return b.pnlPct - a.pnlPct;
    });

  if (rows.length === 0) {
    return (
      <p className="text-sm text-white/55 italic">
        No tracked picks yet. The performance table populates as
        scans publish picks and the daily mark cron tracks them.
      </p>
    );
  }

  // Headline stats
  const withPnl = rows.filter((r) => r.pnlPct != null);
  const winners = withPnl.filter((r) => (r.pnlPct ?? 0) > 0).length;
  const losers = withPnl.filter((r) => (r.pnlPct ?? 0) < 0).length;
  const meanPnl =
    withPnl.length > 0
      ? withPnl.reduce((s, r) => s + (r.pnlPct ?? 0), 0) / withPnl.length
      : null;

  return (
    <div className="space-y-3">
      {/* Headline summary */}
      {meanPnl != null && (
        <div className="flex flex-wrap gap-3 text-xs">
          <Stat label="Picks tracked" value={`${rows.length}`} />
          <Stat label="With marks" value={`${withPnl.length}`} />
          <Stat
            label="Winners / Losers"
            value={`${winners} / ${losers}`}
            valueClass={
              winners > losers ? "text-emerald-300" : losers > winners ? "text-rose-300" : ""
            }
          />
          <Stat
            label="Avg P&L"
            value={fmtPct(meanPnl)}
            valueClass={pnlTone(meanPnl)}
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-white/55 bg-white/[0.02]">
            <tr>
              <th className="px-3 py-2 text-left">Pick</th>
              <th className="px-3 py-2 text-right">Scan day</th>
              <th className="px-3 py-2 text-right">Entry</th>
              <th className="px-3 py-2 text-right">Current</th>
              <th className="px-3 py-2 text-right">P&amp;L</th>
              <th className="px-3 py-2 text-right">Held</th>
              <th className="px-3 py-2 text-right">DTE</th>
              <th className="px-3 py-2 text-right">Last mark</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.pick.id}
                className="border-t border-white/5 hover:bg-white/[0.03] transition-colors"
              >
                <td className="px-3 py-2">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <Link
                      href={`/tickers/${r.pick.ticker}`}
                      className="font-mono font-bold hover:underline"
                    >
                      {r.pick.ticker}
                    </Link>
                    <span className="font-mono text-xs text-white/75">
                      {fmtStrike(Number(r.pick.strike))}C{" "}
                      <span className="text-white/45">
                        · {fmtDate(r.pick.expirationDate)}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-white/75">
                  {r.pick.scanDay}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {fmtUsd(r.entryMid)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {fmtUsd(r.currentMid)}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono ${pnlTone(r.pnlPct)}`}
                >
                  {fmtPct(r.pnlPct)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-white/75">
                  {r.daysHeld}d
                </td>
                <td className="px-3 py-2 text-right font-mono text-white/75">
                  {r.daysToExpiry}d
                </td>
                <td className="px-3 py-2 text-right text-xs text-white/55">
                  {r.pick.latestMark ? fmtRelTime(r.pick.latestMark.markTs) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="text-[9px] uppercase tracking-widest text-white/45">
        {label}
      </div>
      <div className={`font-mono mt-0.5 ${valueClass ?? "text-white/85"}`}>
        {value}
      </div>
    </div>
  );
}
