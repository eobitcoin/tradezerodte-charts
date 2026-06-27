import Link from "next/link";

/**
 * Second-level sub-nav under the "Sell Options" hub. Sits below
 * OptionsSubNav (where "Sell Options" is the active top tab) on both the
 * Sell Puts and Premium Ranker pages.
 *
 *   Sell Puts       — cash-secured short-put ranker (curated ~53 large caps)
 *   Premium Ranker  — full-market high-IV / premium scanner
 */
export type SellOptionsSubNavTab = "sell-puts" | "premium-ranker";

const TABS: Array<{ id: SellOptionsSubNavTab; label: string; href: string }> = [
  { id: "sell-puts", label: "Sell Puts", href: "/research/sell-puts" },
  { id: "premium-ranker", label: "Premium Ranker", href: "/research/premium-ranker" },
];

export default function SellOptionsSubNav({ active }: { active: SellOptionsSubNavTab }) {
  return (
    <nav className="flex justify-start gap-2 flex-wrap">
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.href}
            className={[
              "px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wide transition-colors",
              isActive
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30"
                : "text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5",
            ].join(" ")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
