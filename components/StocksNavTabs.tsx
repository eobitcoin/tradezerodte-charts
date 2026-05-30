import Link from "next/link";

/** First-level Stocks navigation. Sits above the existing ResearchTabs
 *  strip on Research-family pages, and stands alone on Metals/Quantum/Radar.
 *
 *  The order matters — "research" is the canonical landing for the Stocks
 *  link in SiteHeader, so it MUST stay first. Radar is last because it's
 *  the deepest / most niche surface in this group.
 */
export type StocksNavTab =
  | "research"
  | "metals"
  | "quantum"
  | "radar"
  | "maxpain";

const TABS: Array<{ id: StocksNavTab; label: string; href: string }> = [
  { id: "research", label: "Research", href: "/research" },
  { id: "metals", label: "Metals", href: "/research/metals" },
  { id: "quantum", label: "Quantum", href: "/research/quantum" },
  { id: "radar", label: "Radar", href: "/radar" },
  { id: "maxpain", label: "Max Pain", href: "/maxpain" },
];

export default function StocksNavTabs({ active }: { active: StocksNavTab }) {
  return (
    <nav className="border-b border-black/10 dark:border-white/10 flex gap-2 flex-wrap">
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.href}
            className={[
              "px-4 py-2 -mb-px border-b-2 text-sm font-semibold uppercase tracking-wide transition-colors",
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
