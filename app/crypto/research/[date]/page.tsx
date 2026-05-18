import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cryptoPosts } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import CryptoTabs from "@/components/CryptoTabs";
import CryptoResearchView from "@/components/CryptoResearchView";
import CryptoResearchSidebar, {
  type CryptoResearchSidebarItem,
} from "@/components/CryptoResearchSidebar";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function CryptoResearchDetailPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!DATE_RE.test(date)) notFound();

  const [post] = await db
    .select()
    .from(cryptoPosts)
    .where(eq(cryptoPosts.scanDay, date))
    .limit(1);
  if (!post) notFound();

  const recent = await db
    .select({
      scanDay: cryptoPosts.scanDay,
      title: cryptoPosts.title,
      tradesCount: sql<number>`jsonb_array_length(${cryptoPosts.trades})`,
    })
    .from(cryptoPosts)
    .orderBy(desc(cryptoPosts.scanDay))
    .limit(30);

  const sidebarItems: CryptoResearchSidebarItem[] = recent.map((r) => ({
    scanDay: r.scanDay,
    title: r.title,
    tradesCount: Number(r.tradesCount),
  }));

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Crypto</h1>
        </header>
        <CryptoTabs active="research" />
        <div>
          <Link href="/crypto/research" className="text-sm underline">
            ← Latest crypto research
          </Link>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-6 lg:gap-10">
          <main className="min-w-0">
            <CryptoResearchView post={post} />
          </main>
          <CryptoResearchSidebar items={sidebarItems} currentScanDay={date} />
        </div>
      </div>
    </>
  );
}
