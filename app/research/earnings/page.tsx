/**
 * /research/earnings — Earnings Whiplash Map
 *
 * Renders the most recent earnings-whiplash scan: 10 stocks ranked by
 * historical post-earnings move magnitude, with 3 flagged as asymmetric
 * setups where the options-implied move is meaningfully BELOW the
 * historical realized move. Default loads the latest scan_day;
 * ?day=YYYY-MM-DD loads a specific past scan.
 */
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { earningsPosts, type EarningsPost } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import ResearchTabs from "@/components/ResearchTabs";
import EarningsView from "@/components/EarningsView";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ day?: string }>;
}

export default async function EarningsPage({ searchParams }: PageProps) {
  const { day } = await searchParams;
  const looksLikeDay = day && /^\d{4}-\d{2}-\d{2}$/.test(day);

  const [post] = await db
    .select()
    .from(earningsPosts)
    .where(looksLikeDay ? eq(earningsPosts.scanDay, day!) : undefined)
    .orderBy(desc(earningsPosts.scanDay))
    .limit(1);

  const history = await db
    .select({
      scanDay: earningsPosts.scanDay,
      stocks: earningsPosts.stocks,
    })
    .from(earningsPosts)
    .orderBy(desc(earningsPosts.scanDay))
    .limit(12);

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-6 lg:gap-10">
        <main className="min-w-0 space-y-4">
          <ResearchTabs active="earnings" />
          {post ? (
            <EarningsView post={post as EarningsPost} />
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
      <h1 className="text-xl font-semibold">No earnings scans yet</h1>
      <p className="text-sm text-black/60 dark:text-white/60 max-w-prose mx-auto">
        The Earnings Whiplash Map runs weekly. It ranks the next ~2 weeks of S&amp;P 500
        earnings by historical post-earnings move size, then flags the names where
        options-implied volatility is meaningfully BELOW the historical realized move.
        Once the first scan runs, results appear here.
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
  history: Array<{ scanDay: string; stocks: unknown }>;
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
          const arr = Array.isArray(h.stocks) ? (h.stocks as Array<{ isFlagged?: boolean }>) : [];
          const count = arr.length;
          const flagged = arr.filter((s) => s.isFlagged).length;
          const isActive = h.scanDay === currentDay;
          return (
            <li key={h.scanDay}>
              <Link
                href={`/research/earnings?day=${h.scanDay}`}
                className={[
                  "flex items-center justify-between gap-2 rounded px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03] text-black/70 dark:text-white/70",
                ].join(" ")}
              >
                <span className="font-mono">{h.scanDay}</span>
                <span className="text-[10px] text-black/50 dark:text-white/50">
                  {count} · {flagged} flagged
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
