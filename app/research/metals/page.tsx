import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { researchPosts } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import ResearchView from "@/components/ResearchView";
import ResearchSidebar, { type ResearchSidebarItem } from "@/components/ResearchSidebar";
import StocksNavTabs from "@/components/StocksNavTabs";

/**
 * Member-only landing for the weekly metals research stream.
 *
 * Mirror of /research (equity) but filters research_posts to
 * asset_class='metals'. Same components, same layout — only the data
 * source differs. Sidebar shows recent metals-only entries so users can
 * jump between covered tickers (GLD, SLV, GDX, …) without leaving the
 * metals view.
 */

export const dynamic = "force-dynamic";

export default async function MetalsResearchTodayPage() {
  const [latest] = await db
    .select()
    .from(researchPosts)
    .where(eq(researchPosts.assetClass, "metals"))
    .orderBy(desc(researchPosts.scanDay), researchPosts.ticker)
    .limit(1);

  const recentRows = await db
    .select({
      ticker: researchPosts.ticker,
      scanDay: researchPosts.scanDay,
      headline: researchPosts.headline,
      imageCount: sql<number>`jsonb_array_length(${researchPosts.images})`,
    })
    .from(researchPosts)
    .where(eq(researchPosts.assetClass, "metals"))
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
          <StocksNavTabs active="metals" />
          <div className="text-center space-y-3 max-w-md mx-auto pt-12">
            <h1 className="text-xl font-semibold">No metals research yet</h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              The metals research routine publishes every Sunday — GLD,
              SLV, GDX, GDXJ, CPER, PPLT, NEM, FCX. The first batch will
              appear here once it runs.
            </p>
            <Link href="/research" className="inline-block underline text-sm">
              See weekly equity research →
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
          <StocksNavTabs active="metals" />
          <ResearchView post={latest} />
        </main>
        <ResearchSidebar
          items={sidebarItems}
          currentScanDay={latest.scanDay}
          currentTicker={latest.ticker}
          hrefFor={(item) => `/research/metals/${item.scanDay}/${item.ticker}`}
        />
      </div>
    </>
  );
}
