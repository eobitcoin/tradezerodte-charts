import Link from "next/link";
import { fmtUsdCompact, relAge, shortWallet } from "@/lib/polymarket";

export interface LeaderboardRow {
  address: string;
  pseudonym: string | null;
  displayName: string | null;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  capitalDeployedUsd: number | null;
  roi: number | null;
  positionCount: number;
  compositeScore: number | null;
  scoredAt: Date | null;
  totalVolumeUsd: number;
  whaleTradesSeen: number;
  lastSeen: Date;
}

function fmtSignedUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : n > 0 ? "+" : "";
  return sign + fmtUsdCompact(abs);
}

function fmtRoi(roi: number | null): string {
  if (roi == null || !Number.isFinite(roi)) return "—";
  const pct = roi * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function pnlClasses(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "text-black/40 dark:text-white/40";
  if (n > 0) return "text-emerald-600 dark:text-emerald-400";
  if (n < 0) return "text-rose-600 dark:text-rose-400";
  return "text-black/55 dark:text-white/55";
}

export default function PolymarketWalletLeaderboard({
  rows,
  nowSec,
  totalWallets,
  scoredCount,
}: {
  rows: LeaderboardRow[];
  nowSec: number;
  totalWallets: number;
  scoredCount: number;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap text-sm">
        <span className="font-semibold">Top {rows.length} wallets</span>
        <span className="text-xs text-black/55 dark:text-white/55">
          ranked by composite score · {scoredCount.toLocaleString()} of {totalWallets.toLocaleString()} known wallets scored
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm space-y-1">
          <p>No wallet scores yet.</p>
          <p className="text-xs text-black/55 dark:text-white/55">
            The ingest+score endpoint needs to run a few times to populate this view. Each run discovers
            new wallets from the trade firehose and scores up to 20 stale wallets via /positions.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-black/10 dark:border-white/10 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
              <tr className="text-left">
                <th className="px-3 py-2 w-10 text-right">#</th>
                <th className="px-3 py-2">Trader</th>
                <th className="px-3 py-2 w-20 text-right">Score</th>
                <th className="px-3 py-2 w-24 text-right">Realized</th>
                <th className="px-3 py-2 w-24 text-right">Unrealized</th>
                <th className="px-3 py-2 w-20 text-right">ROI</th>
                <th className="px-3 py-2 w-20 text-right">Capital</th>
                <th className="px-3 py-2 w-12 text-right">Pos</th>
                <th className="px-3 py-2 w-20 text-right">Volume</th>
                <th className="px-3 py-2 w-16 text-right">Scored</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const detailUrl = `/polymarket/wallets/${r.address}`;
                return (
                  <tr
                    key={r.address}
                    className="border-t border-black/10 dark:border-white/10 align-top hover:bg-black/[0.02] dark:hover:bg-white/[0.04] transition-colors"
                  >
                    <td className="px-3 py-1.5 text-right text-xs text-black/50 dark:text-white/50">
                      {i + 1}
                    </td>
                    <td className="px-3 py-1.5 min-w-0">
                      <Link
                        href={detailUrl}
                        className="hover:underline truncate block max-w-[220px] font-medium"
                        title={r.address}
                      >
                        {r.pseudonym || r.displayName || shortWallet(r.address)}
                      </Link>
                      <div className="text-[10px] font-mono text-black/40 dark:text-white/40">
                        {shortWallet(r.address)}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold">
                      {r.compositeScore != null ? r.compositeScore.toFixed(2) : "—"}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right font-mono font-semibold ${pnlClasses(r.realizedPnl)}`}
                    >
                      {fmtSignedUsd(r.realizedPnl)}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-mono ${pnlClasses(r.unrealizedPnl)}`}>
                      {fmtSignedUsd(r.unrealizedPnl)}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-mono ${pnlClasses(r.roi)}`}>
                      {fmtRoi(r.roi)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs text-black/65 dark:text-white/65">
                      {r.capitalDeployedUsd != null ? fmtUsdCompact(r.capitalDeployedUsd) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">
                      {r.positionCount}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs text-black/55 dark:text-white/55">
                      {fmtUsdCompact(r.totalVolumeUsd)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs text-black/40 dark:text-white/40">
                      {r.scoredAt
                        ? relAge(Math.floor(r.scoredAt.getTime() / 1000), nowSec) + " ago"
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-black/55 dark:text-white/55 leading-relaxed max-w-3xl space-y-1">
        <p>
          <strong>Composite score</strong> = 60% log-scaled realized PnL + 40% capped ROI, weighted
          by sample size (full weight at 20+ positions). Wallets with fewer than 3 positions get no
          score. Higher = better track record on resolved + open positions.
        </p>
        <p>
          <strong>Caveat:</strong> Unrealized PnL on open positions is mark-to-market against current
          Polymarket midpoints — biased toward whales whose trades moved markets. Realized PnL on
          resolved markets is the cleaner signal. ROI is gross of trading fees.
        </p>
        <p>
          Click any row → trader&apos;s public Polymarket profile (positions, activity, history).
        </p>
      </div>
    </div>
  );
}
