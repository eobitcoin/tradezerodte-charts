import Link from "next/link";

/**
 * Sub-navigation strip that appears on every Options-family page
 * (Options Edge, Unusual Activity, GEX). Top nav links to "Options"
 * which lands on /research/options-edge; this strip lets the user
 * pivot between sibling surfaces without going back to the top nav.
 *
 * The top-level menu chip is intentionally short ("Options") while
 * the sub-tabs keep the descriptive product names ("Options Edge",
 * "Unusual Activity") that read like a content shelf.
 */
export type OptionsSubNavTab = "edge" | "unusual" | "gex" | "leaps";

const TABS: Array<{ id: OptionsSubNavTab; label: string; href: string }> = [
  { id: "edge", label: "Options Edge", href: "/research/options-edge" },
  { id: "unusual", label: "Unusual Activity", href: "/research/unusual-activity" },
  { id: "gex", label: "GEX", href: "/research/gex" },
  { id: "leaps", label: "LEAPs", href: "/research/leaps" },
];

export default function OptionsSubNav({ active }: { active: OptionsSubNavTab }) {
  return (
    <nav className="border-b border-black/10 dark:border-white/10 flex justify-start gap-2 flex-wrap">
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.href}
            className={[
              "px-4 py-2 -mb-px border-b-2 text-sm font-semibold uppercase tracking-wide transition-colors",
              isActive
                ? "border-amber-500 text-amber-700 dark:text-amber-300"
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
