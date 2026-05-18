import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { researchPosts } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import ResearchView from "@/components/ResearchView";
import ResearchSidebar, { type ResearchSidebarItem } from "@/components/ResearchSidebar";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_RE = /^[A-Z][A-Z0-9.\-^]{0,15}$/;

export default async function ResearchDetailPage({
  params,
}: {
  params: Promise<{ date: string; ticker: string }>;
}) {
  const { date, ticker: rawTicker } = await params;
  if (!DATE_RE.test(date)) notFound();
  const ticker = rawTicker.toUpperCase();
  if (!TICKER_RE.test(ticker)) notFound();

  const [post] = await db
    .select()
    .from(researchPosts)
    .where(and(eq(researchPosts.scanDay, date), eq(researchPosts.ticker, ticker)))
    .limit(1);
  if (!post) notFound();

  const recentRows = await db
    .select({
      ticker: researchPosts.ticker,
      scanDay: researchPosts.scanDay,
      headline: researchPosts.headline,
      imageCount: sql<number>`jsonb_array_length(${researchPosts.images})`,
    })
    .from(researchPosts)
    .orderBy(desc(researchPosts.scanDay), researchPosts.ticker)
    .limit(60);

  const sidebarItems: ResearchSidebarItem[] = recentRows.map((r) => ({
    ticker: r.ticker,
    scanDay: r.scanDay,
    headline: r.headline,
    imageCount: Number(r.imageCount),
  }));

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 pt-4">
        <Link href="/research" className="text-sm underline">
          ← Back to latest research
        </Link>
      </div>
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 lg:gap-10">
        <main className="min-w-0">
          <ResearchView post={post} />
        </main>
        <ResearchSidebar
          items={sidebarItems}
          currentScanDay={date}
          currentTicker={ticker}
        />
      </div>
    </>
  );
}
