import Link from "next/link";

export type MorningBriefTab = "daily" | "earnings";

/**
 * Shared tab bar at the top of the /morning-brief surfaces. Lets visitors
 * toggle between the daily 0DTE recap and the Sunday weekly earnings brief
 * without changing layouts. Used by:
 *   - /morning-brief                 → active="daily"
 *   - /morning-brief/earnings        → active="earnings" (latest week)
 *   - /morning-brief/earnings/[…]    → active="earnings" (specific week)
 */
export default function MorningBriefTabBar({ active }: { active: MorningBriefTab }) {
  const base =
    "inline-flex items-center px-4 py-2 rounded-md text-[11px] font-bold uppercase tracking-[0.22em] transition-colors";
  const activeCls = "bg-red-600 text-white";
  const inactiveCls =
    "border border-white/15 text-white/65 hover:text-white hover:border-white/30 hover:bg-white/[0.04]";
  return (
    <nav className="mb-8 flex flex-wrap items-center gap-2">
      <Link
        href="/morning-brief"
        className={`${base} ${active === "daily" ? activeCls : inactiveCls}`}
      >
        Daily Brief
      </Link>
      <Link
        href="/morning-brief/earnings"
        className={`${base} ${active === "earnings" ? activeCls : inactiveCls}`}
      >
        Earnings Brief
      </Link>
    </nav>
  );
}
