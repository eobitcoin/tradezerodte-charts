import Link from "next/link";
import { notFound } from "next/navigation";
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_ORDER = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

export default async function CryptoWeeklyArchivePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!DATE_RE.test(date)) notFound();

  const posts = await db
    .select()
    .from(cryptoWeeklyResearchPosts)
    .where(eq(cryptoWeeklyResearchPosts.scanDay, date));
  if (posts.length === 0) notFound();

  const sortedPosts = [...posts].sort(
    (a, b) => TICKER_ORDER.indexOf(a.ticker) - TICKER_ORDER.indexOf(b.ticker),
  );

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
        </header>
        <CryptoTabs active="weekly" />
        <div>
          <Link href="/crypto/weekly" className="text-sm underline">
            ← Latest weekly research
          </Link>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-6 lg:gap-10">
          <main className="min-w-0 space-y-12">
            <div className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50">
              Week of {date} · {sortedPosts.length} of 3 tickers published
            </div>
            {sortedPosts.map((post) => (
              <div key={post.id} className="border-t border-black/10 dark:border-white/10 pt-8 first:border-t-0 first:pt-0">
                <ResearchView post={post} />
              </div>
            ))}
          </main>
          <CryptoWeeklySidebar items={sidebarItems} currentScanDay={date} />
        </div>
      </div>
    </>
  );
}
