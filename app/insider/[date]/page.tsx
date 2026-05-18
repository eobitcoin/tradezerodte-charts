import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { insiderPosts } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import ResearchTabs from "@/components/ResearchTabs";
import InsiderView from "@/components/InsiderView";
import InsiderSidebar, { type InsiderSidebarItem } from "@/components/InsiderSidebar";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function InsiderDetailPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!DATE_RE.test(date)) notFound();

  const [post] = await db
    .select()
    .from(insiderPosts)
    .where(eq(insiderPosts.scanDay, date))
    .limit(1);
  if (!post) notFound();

  const recentRows = await db
    .select({
      scanDay: insiderPosts.scanDay,
      title: insiderPosts.title,
      buyCount: sql<number>`jsonb_array_length(${insiderPosts.buys})`,
    })
    .from(insiderPosts)
    .orderBy(desc(insiderPosts.scanDay))
    .limit(30);

  const sidebarItems: InsiderSidebarItem[] = recentRows.map((r) => ({
    scanDay: r.scanDay,
    title: r.title,
    buyCount: Number(r.buyCount),
  }));

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-6 lg:gap-10">
        <main className="min-w-0 space-y-4">
          <ResearchTabs active="insider" />
          <Link href="/insider" className="text-sm underline inline-block">
            ← Back to latest insider scan
          </Link>
          <InsiderView post={post} />
        </main>
        <InsiderSidebar items={sidebarItems} currentScanDay={date} />
      </div>
    </>
  );
}
