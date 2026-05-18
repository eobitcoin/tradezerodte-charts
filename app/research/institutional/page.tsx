/**
 * /research/institutional
 *
 * Renders the most recent INSTITUTIONAL FLOW scan: 5 stocks where smart
 * money is accumulating quietly. Default loads the latest scan_day;
 * ?day=YYYY-MM-DD loads a specific past scan from the history index.
 */
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { institutionalPosts, type InstitutionalPost } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import ResearchTabs from "@/components/ResearchTabs";
import InstitutionalView from "@/components/InstitutionalView";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ day?: string }>;
}

export default async function InstitutionalPage({ searchParams }: PageProps) {
  const { day } = await searchParams;
  const looksLikeDay = day && /^\d{4}-\d{2}-\d{2}$/.test(day);

  // Latest or specific-day post.
  const [post] = await db
    .select()
    .from(institutionalPosts)
    .where(looksLikeDay ? eq(institutionalPosts.scanDay, day!) : undefined)
    .orderBy(desc(institutionalPosts.scanDay))
    .limit(1);

  // History list — all scan_days, newest first, for the sidebar / picker.
  const history = await db
    .select({
      scanDay: institutionalPosts.scanDay,
      stocks: institutionalPosts.stocks,
    })
    .from(institutionalPosts)
    .orderBy(desc(institutionalPosts.scanDay))
    .limit(12);

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-6 lg:gap-10">
        <main className="min-w-0 space-y-4">
          <ResearchTabs active="institutional" />
          {post ? (
            <InstitutionalView post={post as InstitutionalPost} />
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
      <h1 className="text-xl font-semibold">No institutional scans yet</h1>
      <p className="text-sm text-black/60 dark:text-white/60 max-w-prose mx-auto">
        The weekly Institutional Flow routine publishes one scan per week,
        surfacing 5 stocks where smart money has been accumulating quietly
        across the latest 13F filings from Berkshire, Bridgewater, Renaissance,
        Citadel, and Two Sigma. Once the first scan runs, results appear here.
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
          const count = Array.isArray(h.stocks) ? h.stocks.length : 0;
          const isActive = h.scanDay === currentDay;
          return (
            <li key={h.scanDay}>
              <Link
                href={`/research/institutional?day=${h.scanDay}`}
                className={[
                  "flex items-center justify-between gap-2 rounded px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03] text-black/70 dark:text-white/70",
                ].join(" ")}
              >
                <span className="font-mono">{h.scanDay}</span>
                <span className="text-[10px] text-black/50 dark:text-white/50">
                  {count} {count === 1 ? "stock" : "stocks"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
