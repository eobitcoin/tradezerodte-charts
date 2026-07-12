import Link from "next/link";
import type { ScanTab } from "@/lib/scans";

type Props = {
  active: ScanTab;
  /** 6AM BotWick Analysis (Finora-style SMC read). Optional so older
   *  callsites keep working; undefined renders as "pending". */
  hasBotwick?: boolean;
  hasPremarket: boolean;
  hasMarketOpen: boolean;
  hasAnalysis: boolean;
  hasTradeCards: boolean;
  /** Scorecard is a cross-day aggregate view — only present on the home
   *  page (/), not on /posts/[date]. Defaults false so per-date page works
   *  unchanged. */
  hasScorecard?: boolean;
  /** Where to point the tab links (so this same strip works on /
   *  and on /posts/[date]). */
  hrefFor: (tab: ScanTab) => string;
};

const TABS: {
  id: ScanTab;
  label: string;
  key: keyof Pick<
    Props,
    "hasBotwick" | "hasPremarket" | "hasMarketOpen" | "hasAnalysis" | "hasTradeCards" | "hasScorecard"
  >;
}[] = [
  { id: "botwick", label: "BotWick Analysis", key: "hasBotwick" },
  { id: "premarket", label: "Pre-market", key: "hasPremarket" },
  { id: "market_open", label: "Market-Open", key: "hasMarketOpen" },
  { id: "analysis", label: "Analysis", key: "hasAnalysis" },
  { id: "trade_cards", label: "Trade-Cards", key: "hasTradeCards" },
  { id: "scorecard", label: "Scorecard", key: "hasScorecard" },
];

/**
 * Tab strip for the home page + post detail page. Tabs that don't have a
 * corresponding scan yet are visible but disabled with a soft "pending"
 * affordance so users can see what's coming.
 */
export default function ScanTabs(props: Props) {
  const { active, hrefFor } = props;
  return (
    <nav className="border-b border-black/10 dark:border-white/10 flex gap-2 flex-wrap">
      {TABS.map((t) => {
        // Scorecard is a cross-day view — hide it entirely on per-date
        // pages where `hasScorecard` isn't passed. Other tabs always show
        // (their "pending" state communicates "data not here yet").
        if (t.id === "scorecard" && props.hasScorecard !== true) return null;
        const has = props[t.key];
        const isActive = active === t.id;
        const base =
          "px-4 py-2 -mb-px border-b-2 text-sm font-mono uppercase tracking-widest transition-colors";
        if (!has && !isActive) {
          return (
            <span
              key={t.id}
              className={`${base} border-transparent text-black/30 dark:text-white/30 cursor-not-allowed select-none inline-flex items-center gap-1.5`}
              title="Not published yet"
              aria-disabled="true"
            >
              {t.label}
              <span className="text-[9px] tracking-widest uppercase border border-black/15 dark:border-white/15 rounded px-1 py-[1px] opacity-70">
                pending
              </span>
            </span>
          );
        }
        return (
          <Link
            key={t.id}
            href={hrefFor(t.id)}
            className={`${base} ${
              isActive
                ? "border-emerald-500 text-emerald-700 dark:text-emerald-400"
                : "border-transparent text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:border-black/20 dark:hover:border-white/20"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
      {/* Calendar — cross-day navigation aid pinned after the scan tabs.
          Not part of the ScanTab union (it's a route, not a per-day scan
          surface), so always renders as an outbound link without
          "pending" or "active" treatment. */}
      <Link
        href="/calendar"
        className="px-4 py-2 -mb-px border-b-2 border-transparent text-sm font-mono uppercase tracking-widest text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:border-black/20 dark:hover:border-white/20 transition-colors"
      >
        Calendar
      </Link>
    </nav>
  );
}
