import Link from "next/link";
import type { GexSnapshot } from "@/lib/db/schema";

/**
 * Universe overview table on /research/gex.
 *
 * One row per ticker showing the latest snapshot's headline numbers:
 * spot, total GEX (with regime color), zero-gamma strike + distance
 * from spot, last update. Click-through links to the detail page.
 */

interface Props {
  rows: GexSnapshot[];
}

function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtBigDollars(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "+";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function fmtRelTime(ts: Date): string {
  const ageMs = Date.now() - ts.getTime();
  const min = Math.floor(ageMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function regimeTone(totalGex: number): {
  label: string;
  className: string;
} {
  if (totalGex > 0) {
    return {
      label: "Long γ",
      className: "border-emerald-500/40 text-emerald-300 bg-emerald-500/[0.08]",
    };
  }
  return {
    label: "Short γ",
    className: "border-rose-500/40 text-rose-300 bg-rose-500/[0.08]",
  };
}

export default function GexUniverseTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-white/55 italic">
        No GEX snapshots yet. The 5-minute cron populates this table
        during regular trading hours (Mon–Fri, 9:30 AM – 4:00 PM ET).
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-widest text-white/55 bg-white/[0.02]">
          <tr>
            <th className="px-3 py-2 text-left">Ticker</th>
            <th className="px-3 py-2 text-right">Spot</th>
            <th className="px-3 py-2 text-right">Regime</th>
            <th className="px-3 py-2 text-right">Total γ</th>
            <th className="px-3 py-2 text-right">Zero-γ strike</th>
            <th className="px-3 py-2 text-right">Distance</th>
            <th className="px-3 py-2 text-right">Last update</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const totalGex = Number(r.totalGex);
            const tone = regimeTone(totalGex);
            const spot = Number(r.spot);
            const zg = r.zeroGammaStrike ? Number(r.zeroGammaStrike) : null;
            const zgPct = r.zeroGammaPct ? Number(r.zeroGammaPct) : null;
            return (
              <tr
                key={r.id}
                className="border-t border-white/5 hover:bg-white/[0.03] transition-colors"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/research/gex/${r.ticker}`}
                    className="font-mono font-bold hover:underline"
                  >
                    {r.ticker}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right font-mono">{fmtUsd(spot)}</td>
                <td className="px-3 py-2 text-right">
                  <span
                    className={`inline-block text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${tone.className}`}
                  >
                    {tone.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {fmtBigDollars(totalGex)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {zg != null ? fmtUsd(zg) : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-white/70">
                  {fmtPct(zgPct)}
                </td>
                <td className="px-3 py-2 text-right text-white/55 text-xs">
                  {fmtRelTime(r.ts)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
