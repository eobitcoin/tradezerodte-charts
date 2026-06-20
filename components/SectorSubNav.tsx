import Link from "next/link";

/** Sub-nav for the Sector hub. Sits below the top-level header on
 *  /sector and /sector/rotation. Bubbles is the live aggressor-flow
 *  chart; Rotation is the weekly leadership-flip scan that used to
 *  live under /research. */
export type SectorSubNavTab = "bubbles" | "rotation";

const TABS: Array<{ id: SectorSubNavTab; label: string; href: string }> = [
  { id: "bubbles", label: "Bubbles", href: "/sector" },
  { id: "rotation", label: "Rotation", href: "/sector/rotation" },
];

export default function SectorSubNav({ active }: { active: SectorSubNavTab }) {
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
