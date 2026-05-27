import Link from "next/link";

export type ResearchTab =
  | "weekly"
  | "metals"
  | "quantum"
  | "economic"
  | "institutional"
  | "earnings"
  | "rotation"
  | "insider";

const TABS: Array<{ id: ResearchTab; label: string; href: string }> = [
  { id: "weekly", label: "Weekly Research", href: "/research" },
  { id: "metals", label: "Metals", href: "/research/metals" },
  { id: "quantum", label: "Quantum", href: "/research/quantum" },
  { id: "economic", label: "Economic Calendar", href: "/calendar/economic" },
  { id: "institutional", label: "Institutional", href: "/research/institutional" },
  { id: "earnings", label: "Earnings", href: "/research/earnings" },
  { id: "rotation", label: "Sector Rotation", href: "/research/rotation" },
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
