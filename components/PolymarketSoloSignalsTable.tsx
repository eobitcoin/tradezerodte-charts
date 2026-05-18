import {
  fmtProb,
  fmtUsdCompact,
  relAge,
  shortWallet,
} from "@/lib/polymarket";

export interface SoloSignal {
  transactionHash: string;
  asset: string;
  wallet: string;
  pseudonym: string | null;
  compositeScore: number | null;
  conditionId: string;
  title: string | null;
  slug: string | null;
  eventSlug: string | null;
  category: string | null;
  outcome: string | null;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  usdValue: number;
  timestamp: Date;
  /** Current CLOB midpoint, if available. */
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

export default function PolymarketSoloSignalsTable({
  signals,
  nowSec,
  windowLabel,
}: {
  signals: SoloSignal[];
  nowSec: number;
  windowLabel: string;
}) {
  if (signals.length === 0) {
    return (
      <div className="rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
        No fresh trades from top-scored wallets in the last {windowLabel}. Either nobody good was
        active, or your wallet roster needs more scoring history.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-black/10 dark:border-white/10 rounded-lg">
      <table className="w-full text-sm">
        <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
          <tr className="text-left">
            <th className="px-3 py-2 w-14 text-right">Age</th>
            <th className="px-3 py-2 w-44">Trader</th>
            <th className="px-3 py-2">Market · Outcome</th>
            <th className="px-3 py-2 w-16">Side</th>
            <th className="px-3 py-2 w-16 text-right">Entry</th>
            <th className="px-3 py-2 w-20 text-right">Now</th>
            <th className="px-3 py-2 w-20 text-right">Size</th>
            <th className="px-3 py-2 w-20 text-right">USD</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((s) => {
            const tsSec = Math.floor(s.timestamp.getTime() / 1000);
            const eventUrl = `https://polymarket.com/event/${s.eventSlug || s.slug || ""}`;
            const profileUrl = `https://polymarket.com/profile/${s.wallet}`;
            return (
              <tr
                key={s.transactionHash + "-" + s.asset}
                className="border-t border-black/10 dark:border-white/10 align-top hover:bg-black/[0.02] dark:hover:bg-white/[0.04] transition-colors"
              >
                <td className="px-3 py-2 text-right font-mono text-xs text-black/55 dark:text-white/55">
                  {relAge(tsSec, nowSec)}
                </td>
                <td className="px-3 py-2 min-w-0">
                  <a
                    href={profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline truncate block max-w-[180px] font-medium"
                    title={s.wallet}
                  >
                    {s.pseudonym || shortWallet(s.wallet)}
                  </a>
                  <div className="flex items-baseline gap-1.5 text-[10px] text-black/40 dark:text-white/40 font-mono">
                    {s.compositeScore != null && (
                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                        score {s.compositeScore.toFixed(2)}
                      </span>
                    )}
                    <span>{shortWallet(s.wallet)}</span>
                  </div>
                </td>
                <td className="px-3 py-2 min-w-0">
                  <a
                    href={eventUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline block truncate max-w-[420px]"
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
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {fmtProb(s.price)}
                </td>
                {(() => {
                  const cp = s.currentPrice;
                  if (cp == null || !Number.isFinite(cp)) {
                    return (
                      <td className="px-3 py-2 text-right font-mono text-xs text-black/40 dark:text-white/40">
                        —
                      </td>
                    );
                  }
                  const delta = cp - s.price;
                  const sign = delta >= 0 ? "+" : "";
                  return (
                    <td className={`px-3 py-2 text-right font-mono text-xs ${deltaClasses(delta)}`}>
                      <div className="font-semibold">{(cp * 100).toFixed(1)}¢</div>
                      <div className="text-[10px]">
                        {sign}
                        {(delta * 100).toFixed(1)}¢
                      </div>
                    </td>
                  );
                })()}
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {s.size.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {fmtUsdCompact(s.usdValue)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
