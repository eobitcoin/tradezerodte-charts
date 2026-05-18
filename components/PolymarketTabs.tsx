import Link from "next/link";

export type PolymarketTab = "live" | "wallets" | "signals" | "help";

export default function PolymarketTabs({ active }: { active: PolymarketTab }) {
  const cls = (tab: PolymarketTab) =>
    [
      "px-4 py-2 -mb-px border-b-2 text-sm font-medium transition-colors",
      tab === active
        ? "border-emerald-500 text-emerald-700 dark:text-emerald-300"
        : "border-transparent text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white hover:border-black/20 dark:hover:border-white/20",
    ].join(" ");
  return (
    <nav className="border-b border-black/10 dark:border-white/10 flex gap-2 flex-wrap">
      <Link href="/polymarket" className={cls("live")}>
        Live Whales
      </Link>
      <Link href="/polymarket/wallets" className={cls("wallets")}>
        Top Wallets
      </Link>
      <Link href="/polymarket/signals" className={cls("signals")}>
        Signals
      </Link>
      <Link href="/polymarket/help" className={cls("help")}>
        Help
      </Link>
    </nav>
  );
}
