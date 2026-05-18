import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cryptoWeeklyResearchPosts } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import CryptoTabs from "@/components/CryptoTabs";
import ResearchView from "@/components/ResearchView";
import CryptoWeeklySidebar, {
  type CryptoWeeklySidebarItem,
} from "@/components/CryptoWeeklySidebar";

export const dynamic = "force-dynamic";

const TICKER_ORDER = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

export default async function CryptoWeeklyLatestPage() {
  // Find the latest scan_day that has any post.
  const [latestRow] = await db
    .select({ scanDay: cryptoWeeklyResearchPosts.scanDay })
    .from(cryptoWeeklyResearchPosts)
    .orderBy(desc(cryptoWeeklyResearchPosts.scanDay))
    .limit(1);

  const latestDay = latestRow?.scanDay ?? null;

  // Pull all posts for the latest scan_day (3 tickers).
  const posts = latestDay
    ? await db
        .select()
        .from(cryptoWeeklyResearchPosts)
        .where(eq(cryptoWeeklyResearchPosts.scanDay, latestDay))
    : [];

  // Sort BTC → ETH → SOL.
  const sortedPosts = [...posts].sort(
    (a, b) => TICKER_ORDER.indexOf(a.ticker) - TICKER_ORDER.indexOf(b.ticker),
  );

  // Sidebar: distinct scan_days with their per-ticker counts.
  const sidebarRows = await db
    .select({
      scanDay: cryptoWeeklyResearchPosts.scanDay,
      tickerCount: sql<number>`COUNT(*)`,
    })
    .from(cryptoWeeklyResearchPosts)
    .groupBy(cryptoWeeklyResearchPosts.scanDay)
    .orderBy(desc(cryptoWeeklyResearchPosts.scanDay))
    .limit(20);

  const sidebarItems: CryptoWeeklySidebarItem[] = sidebarRows.map((r) => ({
    scanDay: r.scanDay,
    tickerCount: Number(r.tickerCount),
  }));

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Crypto</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Weekly long-form research for BTC, ETH, SOL — published Sunday evenings
            with annotated weekly + daily charts.
          </p>
        </header>
        <CryptoTabs active="weekly" />

        {!latestDay || sortedPosts.length === 0 ? (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm space-y-2">
            <p>No weekly research posts yet.</p>
            <p className="text-xs text-black/55 dark:text-white/55">
              The Crypto Weekly Research routine runs Sunday at 9 PM ET. Once it
              publishes, posts will appear here grouped by week.
            </p>
            <p>
              <Link href="/crypto" className="underline">← Back to Crypto Radar</Link>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-6 lg:gap-10">
            <main className="min-w-0 space-y-12">
              <div className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50">
                Week of {latestDay} · {sortedPosts.length} of 3 tickers published
              </div>
              {sortedPosts.map((post) => (
                <div key={post.id} className="border-t border-black/10 dark:border-white/10 pt-8 first:border-t-0 first:pt-0">
                  <ResearchView post={post} />
                </div>
              ))}
            </main>
            <CryptoWeeklySidebar items={sidebarItems} currentScanDay={latestDay} />
          </div>
        )}
      </div>
    </>
  );
}
