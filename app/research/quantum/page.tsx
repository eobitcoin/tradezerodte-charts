import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { researchPosts } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import ResearchView from "@/components/ResearchView";
import ResearchSidebar, { type ResearchSidebarItem } from "@/components/ResearchSidebar";
import ResearchTabs from "@/components/ResearchTabs";

/**
 * Member-only landing for the weekly quantum research stream.
 *
 * Mirror of /research/metals but filters research_posts to
 * asset_class='quantum'. Same Wicked Stocks layout — the difference is
 * that each post's body_md also includes Fundamentals + Valuation
 * sections sourced from SEC EDGAR via fetch_sec_fundamentals.
 *
 * Watchlist: IONQ, RGTI, QBTS, QUBT, INFQ, FORM. The first five are
 * pure-play QC; FORM is the picks-and-shovels (cryogenic test gear).
 */

export const dynamic = "force-dynamic";

export default async function QuantumResearchTodayPage() {
  const [latest] = await db
    .select()
    .from(researchPosts)
    .where(eq(researchPosts.assetClass, "quantum"))
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
    .where(eq(researchPosts.assetClass, "quantum"))
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
          <ResearchTabs active="quantum" />
          <div className="text-center space-y-3 max-w-md mx-auto pt-12">
            <h1 className="text-xl font-semibold">No quantum research yet</h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              The quantum research routine publishes every Sunday — IONQ,
              RGTI, QBTS, QUBT, INFQ, FORM. Each post combines Wicked
              Stocks technical analysis with fundamentals + valuation
              sourced from SEC EDGAR.
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
          <ResearchTabs active="quantum" />
          <ResearchView post={latest} />
        </main>
        <ResearchSidebar
          items={sidebarItems}
          currentScanDay={latest.scanDay}
          currentTicker={latest.ticker}
          hrefFor={(item) => `/research/quantum/${item.scanDay}/${item.ticker}`}
        />
      </div>
    </>
  );
}
