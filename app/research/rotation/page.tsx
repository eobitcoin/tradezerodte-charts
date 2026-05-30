/**
 * /research/rotation — Sector Rotation Detector
 *
 * Renders the most recent weekly sector-rotation scan. The scan compares
 * each S&P 500 sector's last-30-day relative strength against the same
 * period one year ago and surfaces the sectors where the sign flipped.
 * For each rotating sector, ranks the top 5 highest-volume ETFs by net
 * money flow over the last 10 trading days.
 */
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sectorRotationPosts, type SectorRotationPost } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import ResearchTabs from "@/components/ResearchTabs";
import StocksNavTabs from "@/components/StocksNavTabs";
import RotationView from "@/components/RotationView";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ day?: string }>;
}

export default async function SectorRotationPage({ searchParams }: PageProps) {
  const { day } = await searchParams;
  const looksLikeDay = day && /^\d{4}-\d{2}-\d{2}$/.test(day);

  const [post] = await db
    .select()
    .from(sectorRotationPosts)
    .where(looksLikeDay ? eq(sectorRotationPosts.scanDay, day!) : undefined)
    .orderBy(desc(sectorRotationPosts.scanDay))
    .limit(1);

  const history = await db
    .select({
      scanDay: sectorRotationPosts.scanDay,
      sectors: sectorRotationPosts.sectors,
    })
    .from(sectorRotationPosts)
    .orderBy(desc(sectorRotationPosts.scanDay))
    .limit(12);

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-6 lg:gap-10">
        <main className="min-w-0 space-y-4">
          <StocksNavTabs active="research" />
          <ResearchTabs active="rotation" />
          {post ? (
            <RotationView post={post as SectorRotationPost} />
          ) : (
            <EmptyState />
          )}
        </main>
        <HistorySidebar history={history} currentDay={post?.scanDay ?? null} />
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 p-8 text-center space-y-3">
      <h1 className="text-xl font-semibold">No sector rotation scans yet</h1>
      <p className="text-sm text-black/60 dark:text-white/60 max-w-prose mx-auto">
        The Sector Rotation Detector runs weekly. It compares each S&amp;P 500 sector&apos;s
        last-30-day relative strength against the same period one year ago and surfaces the
        sectors where the sign just flipped — institutional capital is quietly moving before
        the rotation hits headlines. Once the first scan runs, results appear here.
      </p>
      <Link href="/research" className="inline-block underline text-sm">
        ← Back to Weekly Research
      </Link>
    </div>
  );
}

function HistorySidebar({
  history,
  currentDay,
}: {
  history: Array<{ scanDay: string; sectors: unknown }>;
  currentDay: string | null;
}) {
  if (history.length === 0) return null;
  return (
    <aside className="space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
        Past scans
      </div>
      <ul className="space-y-1">
        {history.map((h) => {
          const arr = Array.isArray(h.sectors) ? (h.sectors as Array<{ isRotating?: boolean }>) : [];
          const total = arr.length;
          const rotating = arr.filter((s) => s.isRotating).length;
          const isActive = h.scanDay === currentDay;
          return (
            <li key={h.scanDay}>
              <Link
                href={`/research/rotation?day=${h.scanDay}`}
                className={[
                  "flex items-center justify-between gap-2 rounded px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03] text-black/70 dark:text-white/70",
                ].join(" ")}
              >
                <span className="font-mono">{h.scanDay}</span>
                <span className="text-[10px] text-black/50 dark:text-white/50">
                  {total} sectors · {rotating} rotating
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
