/**
 * /research/squeeze — Squeeze Watch
 *
 * Renders the most recent weekly squeeze_scans row. ?day=YYYY-MM-DD loads
 * a specific past scan. Mirrors the Earnings / Rotation page structure
 * (main + history sidebar).
 */
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { squeezeScans, type SqueezeScan } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import StocksNavTabs from "@/components/StocksNavTabs";
import ResearchTabs from "@/components/ResearchTabs";
import SqueezeView from "@/components/SqueezeView";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ day?: string }>;
}

export default async function SqueezePage({ searchParams }: PageProps) {
  const { day } = await searchParams;
  const looksLikeDay = day && /^\d{4}-\d{2}-\d{2}$/.test(day);

  const [scan] = await db
    .select()
    .from(squeezeScans)
    .where(looksLikeDay ? eq(squeezeScans.scanDay, day!) : undefined)
    .orderBy(desc(squeezeScans.scanDay))
    .limit(1);

  const history = await db
    .select({
      scanDay: squeezeScans.scanDay,
      rankedSize: squeezeScans.rankedSize,
    })
    .from(squeezeScans)
    .orderBy(desc(squeezeScans.scanDay))
    .limit(12);

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-6 lg:gap-10">
        <main className="min-w-0 space-y-4">
          <StocksNavTabs active="research" />
          <ResearchTabs active="squeeze" />
          {scan ? (
            <SqueezeView scan={scan as SqueezeScan} />
          ) : (
            <EmptyState />
          )}
        </main>
        <HistorySidebar history={history} currentDay={scan?.scanDay ?? null} />
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 p-8 text-center space-y-3">
      <h1 className="text-xl font-semibold">No squeeze scans yet</h1>
      <p className="text-sm text-black/60 dark:text-white/60 max-w-prose mx-auto">
        Squeeze Watch runs weekly on Sunday afternoon. It walks a curated ~150-name
        universe of high-SI candidates, pulls FINRA short interest + Polygon ticker
        overview, and ranks the top 25 by a composite score (SI% of shares outstanding,
        days-to-cover, 5-day momentum, IV rank). Once the first scan runs, results
        appear here.
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
  history: Array<{ scanDay: string; rankedSize: number }>;
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
          const isActive = h.scanDay === currentDay;
          return (
            <li key={h.scanDay}>
              <Link
                href={`/research/squeeze?day=${h.scanDay}`}
                className={[
                  "flex items-center justify-between gap-2 rounded px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03] text-black/70 dark:text-white/70",
                ].join(" ")}
              >
                <span className="font-mono">{h.scanDay}</span>
                <span className="text-[10px] text-black/50 dark:text-white/50">
                  {h.rankedSize} candidates
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
