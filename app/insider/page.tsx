import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { insiderPosts } from "@/lib/db/schema";
import { nyTradingDay } from "@/lib/trading-day";
import SiteHeader from "@/components/SiteHeader";
import ResearchTabs from "@/components/ResearchTabs";
import StocksNavTabs from "@/components/StocksNavTabs";
import InsiderView from "@/components/InsiderView";
import InsiderSidebar, { type InsiderSidebarItem } from "@/components/InsiderSidebar";

export const dynamic = "force-dynamic";

export default async function InsiderTodayPage() {
  const today = nyTradingDay();
  const [latest] = await db
    .select()
    .from(insiderPosts)
    .orderBy(desc(insiderPosts.scanDay))
    .limit(1);

  // Sidebar: up to 30 prior scans (excluding the latest one shown in main panel)
  const recentRows = await db
    .select({
      scanDay: insiderPosts.scanDay,
      title: insiderPosts.title,
      buyCount: sql<number>`jsonb_array_length(${insiderPosts.buys})`,
    })
    .from(insiderPosts)
    .orderBy(desc(insiderPosts.scanDay))
    .limit(30);

  // Include the current scan in the sidebar (highlighted as active) so the timeline
  // is visible even when only one scan exists.
  const sidebarItems: InsiderSidebarItem[] = recentRows.map((r) => ({
    scanDay: r.scanDay,
    title: r.title,
    buyCount: Number(r.buyCount),
  }));

  if (!latest) {
    return (
      <>
        <SiteHeader />
        <main className="max-w-5xl mx-auto px-4 py-6 space-y-4">
          <StocksNavTabs active="research" />
          <ResearchTabs active="insider" />
          <div className="text-center space-y-3 max-w-md mx-auto pt-12">
            <h1 className="text-xl font-semibold">No insider scans yet</h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              The SEC Form 4 Insider Scanner runs every weekday morning. Once it publishes,
              the most recent results will appear here.
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
      {latest.scanDay !== today && (
        <div className="max-w-7xl mx-auto px-4 pt-6">
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            Awaiting today&apos;s SEC Form 4 Insider Scan ({today}). Showing the most recent scan below.
          </div>
        </div>
      )}
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-6 lg:gap-10">
        <main className="min-w-0 space-y-4">
          <StocksNavTabs active="research" />
          <ResearchTabs active="insider" />
          <InsiderView post={latest} />
        </main>
        <InsiderSidebar items={sidebarItems} currentScanDay={latest.scanDay} />
      </div>
    </>
  );
}
