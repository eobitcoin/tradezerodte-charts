import Link from "next/link";

export type CryptoTab = "radar" | "research" | "weekly" | "maxpain" | "polymarket";

export default function CryptoTabs({ active }: { active: CryptoTab }) {
  const cls = (tab: CryptoTab) =>
    [
      "px-4 py-2 -mb-px border-b-2 text-sm font-medium transition-colors",
      tab === active
        ? "border-emerald-500 text-emerald-700 dark:text-emerald-300"
        : "border-transparent text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white hover:border-black/20 dark:hover:border-white/20",
    ].join(" ");
  return (
    <nav className="border-b border-black/10 dark:border-white/10 flex gap-2 flex-wrap">
      <Link href="/crypto" className={cls("radar")}>
        Crypto Radar
      </Link>
      <Link href="/crypto/research" className={cls("research")}>
        Daily Research
      </Link>
      <Link href="/crypto/weekly" className={cls("weekly")}>
        Weekly Research
      </Link>
      <Link href="/crypto/maxpain" className={cls("maxpain")}>
        Max Pain
      </Link>
      <Link href="/polymarket" className={cls("polymarket")}>
        Polymarket
      </Link>
    </nav>
  );
}
