import Link from "next/link";

/**
 * Stocks (equities) section sub-nav. Both /radar and /maxpain live under
 * Stocks. The top-level "Stocks" link in SiteHeader points at /radar by
 * convention (most-frequented sub-page), and this component renders the
 * secondary tabs on every Stocks page.
 */
export type StocksTab = "radar" | "maxpain";

export default function StocksTabs({ active }: { active: StocksTab }) {
  const cls = (tab: StocksTab) =>
    [
      "px-4 py-2 -mb-px border-b-2 text-sm font-medium transition-colors",
      tab === active
        ? "border-emerald-500 text-emerald-700 dark:text-emerald-300"
        : "border-transparent text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white hover:border-black/20 dark:hover:border-white/20",
    ].join(" ");
  return (
    <nav className="border-b border-black/10 dark:border-white/10 flex gap-2 flex-wrap">
      <Link href="/radar" className={cls("radar")}>
        Radar
      </Link>
      <Link href="/maxpain" className={cls("maxpain")}>
        Max Pain
      </Link>
    </nav>
  );
}
