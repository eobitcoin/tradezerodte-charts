import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { researchPosts } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import ResearchView from "@/components/ResearchView";
import ResearchSidebar, { type ResearchSidebarItem } from "@/components/ResearchSidebar";
import ResearchTabs from "@/components/ResearchTabs";
import StocksNavTabs from "@/components/StocksNavTabs";

export const dynamic = "force-dynamic";

export default async function ResearchTodayPage() {
  // Equity stream only — metals rows live under /research/metals.
  const [latest] = await db
    .select()
    .from(researchPosts)
    .where(eq(researchPosts.assetClass, "equity"))
    .orderBy(desc(researchPosts.scanDay), researchPosts.ticker)
    .limit(1);

  // Sidebar: up to 60 most recent equity (ticker, scan_day) entries.
  const recentRows = await db
    .select({
      ticker: researchPosts.ticker,
      scanDay: researchPosts.scanDay,
      headline: researchPosts.headline,
      imageCount: sql<number>`jsonb_array_length(${researchPosts.images})`,
    })
    .from(researchPosts)
    .where(eq(researchPosts.assetClass, "equity"))
    .orderBy(desc(researchPosts.scanDay), researchPosts.ticker)
    .limit(60);

  const sidebarItems: ResearchSidebarItem[] = recentRows.map((r) => ({
    ticker: r.ticker,
    scanDay: r.scanDay,
    headline: r.headline,
    imageCount: Number(r.imageCount),
  }));

  if (!latest) {
    return (
      <>
        <SiteHeader />
        <main className="max-w-5xl mx-auto px-4 py-6 space-y-4">
          <StocksNavTabs active="research" />
          <ResearchTabs active="weekly" />
          <div className="text-center space-y-3 max-w-md mx-auto pt-12">
            <h1 className="text-xl font-semibold">No research posts yet</h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              The Wicked Research routine publishes per-ticker writeups daily.
              Once it runs for the first time, the latest will appear here.
            </p>
            <Link href="/today" className="inline-block underline text-sm">
              Back to today&apos;s 0DTE research →
            </Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 lg:gap-10">
        <main className="min-w-0 space-y-4">
          <StocksNavTabs active="research" />
          <ResearchTabs active="weekly" />
          <ResearchView post={latest} />
        </main>
        <ResearchSidebar
          items={sidebarItems}
          currentScanDay={latest.scanDay}
          currentTicker={latest.ticker}
        />
      </div>
    </>
  );
}
