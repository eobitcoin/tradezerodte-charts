import { fmtProb, fmtUsdCompact, relAge, shortWallet } from "@/lib/polymarket";

export interface ConvergenceWalletRef {
  address: string;
  pseudonym: string | null;
  compositeScore: number | null;
  usdValue: number;
  price: number;
}

export interface ConvergenceSignal {
  conditionId: string;
  title: string | null;
  slug: string | null;
  eventSlug: string | null;
  category: string | null;
  outcome: string | null;
  outcomeIndex: number | null;
  side: "BUY" | "SELL";
  walletCount: number;
  totalUsd: number;
  avgPrice: number;
  firstEntryTs: Date;
  lastEntryTs: Date;
  wallets: ConvergenceWalletRef[];
  /** Current CLOB midpoint for this market+outcome, if available. */
  currentPrice: number | null;
}

function sideClasses(side: "BUY" | "SELL"): string {
  return side === "BUY"
    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40"
    : "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40";
}

function deltaClasses(delta: number): string {
  if (!Number.isFinite(delta)) return "text-black/40 dark:text-white/40";
  if (delta > 0.005) return "text-emerald-600 dark:text-emerald-400";
  if (delta < -0.005) return "text-rose-600 dark:text-rose-400";
  return "text-black/55 dark:text-white/55";
}

function fmtPriceDelta(entry: number, current: number | null): { now: string; delta: string; cls: string } {
  if (current == null || !Number.isFinite(current)) {
    return { now: "—", delta: "", cls: "text-black/40 dark:text-white/40" };
  }
  const delta = current - entry;
  const sign = delta >= 0 ? "+" : "";
  // For BUY signals, delta > 0 = price moved in their favor. For SELL it's
  // the inverse, but we always color positive=green here since we filter to
  // BUY-side convergence.
  return {
    now: `${(current * 100).toFixed(1)}¢`,
    delta: `${sign}${(delta * 100).toFixed(1)}¢`,
    cls: deltaClasses(delta),
  };
}

export default function PolymarketConvergenceTable({
  signals,
  nowSec,
  windowLabel,
}: {
  signals: ConvergenceSignal[];
  nowSec: number;
  windowLabel: string;
}) {
  if (signals.length === 0) {
    return (
      <div className="rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
        No convergence signals in the last {windowLabel}. Wait for more top-wallet activity, or
        loosen the threshold.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-black/10 dark:border-white/10 rounded-lg">
      <table className="w-full text-sm">
        <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
          <tr className="text-left">
            <th className="px-3 py-2">Market · Outcome</th>
            <th className="px-3 py-2 w-16">Side</th>
            <th className="px-3 py-2 w-14 text-right">Wallets</th>
            <th className="px-3 py-2 w-24 text-right">Total USD</th>
            <th className="px-3 py-2 w-16 text-right">Avg Px</th>
            <th className="px-3 py-2 w-20 text-right">Now</th>
            <th className="px-3 py-2 w-16 text-right">First</th>
            <th className="px-3 py-2 min-w-[220px]">Top wallets</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((s) => {
            const eventUrl = `https://polymarket.com/event/${s.eventSlug || s.slug || ""}`;
            const sortedWallets = [...s.wallets].sort((a, b) => b.usdValue - a.usdValue);
            const firstEntrySec = Math.floor(s.firstEntryTs.getTime() / 1000);
            return (
              <tr
                key={`${s.conditionId}-${s.outcomeIndex}-${s.side}`}
                className="border-t border-black/10 dark:border-white/10 align-top hover:bg-black/[0.02] dark:hover:bg-white/[0.04] transition-colors"
              >
                <td className="px-3 py-2 min-w-0">
                  <a
                    href={eventUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline block truncate max-w-[420px] font-medium"
                    title={s.title ?? ""}
                  >
                    {s.title || s.conditionId.slice(0, 12)}
                  </a>
                  <div className="text-[11px] text-black/55 dark:text-white/55">
                    Outcome: <span className="font-medium">{s.outcome ?? "—"}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={[
                      "inline-block px-2 py-0.5 rounded-full border text-[11px] font-mono font-semibold tracking-wide",
                      sideClasses(s.side),
                    ].join(" ")}
                  >
                    {s.side}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {s.walletCount}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold text-amber-700 dark:text-amber-300">
                  {fmtUsdCompact(s.totalUsd)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {fmtProb(s.avgPrice)}
                </td>
                {(() => {
                  const pd = fmtPriceDelta(s.avgPrice, s.currentPrice);
                  return (
                    <td className={`px-3 py-2 text-right font-mono text-xs ${pd.cls}`}>
                      <div className="font-semibold">{pd.now}</div>
                      {pd.delta && <div className="text-[10px]">{pd.delta}</div>}
                    </td>
                  );
                })()}
                <td className="px-3 py-2 text-right font-mono text-xs text-black/55 dark:text-white/55">
                  {relAge(firstEntrySec, nowSec)}
                </td>
                <td className="px-3 py-2 min-w-0">
                  <div className="flex flex-wrap gap-1">
                    {sortedWallets.slice(0, 4).map((w) => {
                      const profileUrl = `https://polymarket.com/profile/${w.address}`;
                      const label =
                        w.pseudonym ||
                        shortWallet(w.address);
                      return (
                        <a
                          key={w.address}
                          href={profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[11px] hover:bg-black/10 dark:hover:bg-white/15"
                          title={`${w.address}\nscore=${w.compositeScore?.toFixed(2) ?? "—"}\n@ ${(w.price * 100).toFixed(1)}¢ for ${fmtUsdCompact(w.usdValue)}`}
                        >
                          <span className="font-medium truncate max-w-[100px]">{label}</span>
                          {w.compositeScore != null && (
                            <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                              {w.compositeScore.toFixed(1)}
                            </span>
                          )}
                        </a>
                      );
                    })}
                    {sortedWallets.length > 4 && (
                      <span className="text-[11px] text-black/40 dark:text-white/40 self-center">
                        +{sortedWallets.length - 4} more
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
