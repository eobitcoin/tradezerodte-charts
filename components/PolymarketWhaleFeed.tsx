import {
  fmtProb,
  fmtUsdCompact,
  relAge,
  shortWallet,
  tradeUsdValue,
  type PolymarketTrade,
} from "@/lib/polymarket";

interface Props {
  trades: PolymarketTrade[];
  /** Window applied to fetch (e.g. "5m", "15m"). */
  windowLabel: string;
  /** Min USD threshold applied. */
  minUsd: number;
  /** Useful for "X ago" rendering — captured at page render time. */
  nowSec: number;
  /** From the fetch metadata — useful as a "we scanned X" footer. */
  totalScanned: number;
  pagesFetched: number;
  oldestTs: number | null;
  newestTs: number | null;
}

function sideClasses(side: "BUY" | "SELL"): string {
  if (side === "BUY") {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40";
  }
  return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40";
}

/** Trades at or above this dollar threshold get the amber "big money" accent. */
const BIG_MONEY_USD = 10_000;

export default function PolymarketWhaleFeed({
  trades,
  windowLabel,
  minUsd,
  nowSec,
  totalScanned,
  pagesFetched,
  oldestTs,
}: Props) {
  const totalUsd = trades.reduce((s, t) => s + tradeUsdValue(t), 0);
  const buys = trades.filter((t) => t.side === "BUY").length;
  const sells = trades.filter((t) => t.side === "SELL").length;
  const bigMoney = trades.filter((t) => tradeUsdValue(t) >= BIG_MONEY_USD).length;
  const oldestAge = oldestTs ? relAge(oldestTs, nowSec) : "—";

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap text-sm">
        <span className="font-semibold">{trades.length} whales</span>
        <span className="text-black/55 dark:text-white/55">
          ≥ {fmtUsdCompact(minUsd)} · last {windowLabel}
        </span>
        {totalUsd > 0 && (
          <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
            {fmtUsdCompact(totalUsd)} total
          </span>
        )}
        {bigMoney > 0 && (
          <span
            className="inline-block px-2 py-0.5 text-xs rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/40 font-semibold"
            title={`${bigMoney} trade${bigMoney === 1 ? "" : "s"} ≥ $${(BIG_MONEY_USD / 1000).toFixed(0)}K`}
          >
            {bigMoney} ≥ {fmtUsdCompact(BIG_MONEY_USD)}
          </span>
        )}
        {buys > 0 && (
          <span className="text-xs text-black/55 dark:text-white/55">
            {buys} buy / {sells} sell
          </span>
        )}
        <span className="text-xs text-black/40 dark:text-white/40 ml-auto">
          scanned {totalScanned.toLocaleString()} trades · {pagesFetched} {pagesFetched === 1 ? "page" : "pages"} · oldest {oldestAge} ago
        </span>
      </div>

      {trades.length === 0 ? (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          No trades ≥ {fmtUsdCompact(minUsd)} in the last {windowLabel}. Try a smaller threshold or a longer window.
        </div>
      ) : (
        <div className="overflow-x-auto border border-black/10 dark:border-white/10 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
              <tr className="text-left">
                <th className="px-3 py-2 w-14 text-right">Age</th>
                <th className="px-3 py-2">Market · Outcome</th>
                <th className="px-3 py-2 w-16">Side</th>
                <th className="px-3 py-2 w-16 text-right">Price</th>
                <th className="px-3 py-2 w-20 text-right">Size</th>
                <th className="px-3 py-2 w-20 text-right">USD</th>
                <th className="px-3 py-2 w-44">Trader</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const usd = tradeUsdValue(t);
                const isBig = usd >= BIG_MONEY_USD;
                const eventUrl = `https://polymarket.com/event/${t.eventSlug || t.slug}`;
                const profileUrl = `https://polymarket.com/profile/${t.proxyWallet}`;
                return (
                  <tr
                    key={t.transactionHash + "-" + t.asset}
                    className={[
                      "align-top transition-colors",
                      "border-t border-black/10 dark:border-white/10",
                      isBig
                        ? "bg-amber-500/[0.07] hover:bg-amber-500/[0.12] border-l-4 border-l-amber-500/70"
                        : "hover:bg-black/[0.02] dark:hover:bg-white/[0.04]",
                    ].join(" ")}
                  >
                    <td className="px-3 py-1.5 text-right font-mono text-xs text-black/55 dark:text-white/55">
                      {relAge(t.timestamp, nowSec)}
                    </td>
                    <td className="px-3 py-1.5 min-w-0">
                      <a
                        href={eventUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline block truncate max-w-[420px]"
                        title={t.title}
                      >
                        {t.title}
                      </a>
                      <div className="text-[11px] text-black/55 dark:text-white/55">
                        Outcome: <span className="font-medium">{t.outcome}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={[
                          "inline-block px-2 py-0.5 rounded-full border text-[11px] font-mono font-semibold tracking-wide",
                          sideClasses(t.side),
                        ].join(" ")}
                      >
                        {t.side}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">
                      {fmtProb(t.price)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">
                      {t.size.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </td>
                    <td
                      className={[
                        "px-3 py-1.5 text-right font-mono font-semibold",
                        isBig ? "text-amber-700 dark:text-amber-300" : "",
                      ].join(" ")}
                    >
                      {fmtUsdCompact(usd)}
                    </td>
                    <td className="px-3 py-1.5 min-w-0">
                      <a
                        href={profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline truncate block max-w-[180px]"
                        title={t.proxyWallet}
                      >
                        {t.pseudonym || shortWallet(t.proxyWallet)}
                      </a>
                      <div className="text-[10px] font-mono text-black/40 dark:text-white/40">
                        {shortWallet(t.proxyWallet)}
                      </div>
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
          <strong>Phase 1 — live whale snapshot.</strong> Polymarket processes ~1,500 trades/min;
          most are tiny ($5–$50). This view paginates the most recent ~5–15 minutes of the trade
          firehose and surfaces only sized bets. Refresh the page for newer.
        </p>
        <p>
          <strong>Coming in Phase 2:</strong> Persistent ingestion + per-wallet PnL scoring →
          ranked &quot;Top Wallets to Follow.&quot; Phase 3: daily signal scan + convergence detector.
        </p>
      </div>
    </div>
  );
}
