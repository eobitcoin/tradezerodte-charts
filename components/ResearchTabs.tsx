import Link from "next/link";

/** Second-row Research sub-nav. Sits below StocksNavTabs on the equity
 *  research family pages. The "metals" / "quantum" asset-class pages and
 *  the dedicated Options Edge surface live one level up (StocksNavTabs)
 *  and DON'T render this strip — those are different streams that don't
 *  share the weekly/economic/institutional/etc. axis. */
export type ResearchTab =
  | "weekly"
  | "economic"
  | "institutional"
  | "earnings"
  | "squeeze"
  | "insider";

const TABS: Array<{ id: ResearchTab; label: string; href: string }> = [
  { id: "weekly", label: "Weekly Research", href: "/research" },
  { id: "economic", label: "Economic Calendar", href: "/calendar/economic" },
  { id: "institutional", label: "Institutional", href: "/research/institutional" },
  { id: "earnings", label: "Earnings", href: "/research/earnings" },
  { id: "squeeze", label: "Squeeze", href: "/research/squeeze" },
  { id: "insider", label: "Insider", href: "/insider" },
];

export default function ResearchTabs({ active }: { active: ResearchTab }) {
  return (
    <nav className="border-b border-black/10 dark:border-white/10 flex gap-2 flex-wrap">
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.href}
            className={[
              "px-4 py-2 -mb-px border-b-2 text-sm font-medium transition-colors",
              isActive
                ? "border-emerald-500 text-emerald-700 dark:text-emerald-300"
                : "border-transparent text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white hover:border-black/20 dark:hover:border-white/20",
            ].join(" ")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
