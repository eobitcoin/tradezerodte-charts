import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { maxPainPosts, type MaxPainTicker } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import StocksNavTabs from "@/components/StocksNavTabs";
import MaxPainView from "@/components/MaxPainView";
import { pickActiveTicker } from "@/lib/max-pain";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function MaxPainDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ ticker?: string }>;
}) {
  const { date } = await params;
  const sp = await searchParams;
  if (!DATE_RE.test(date)) notFound();

  const [post] = await db
    .select()
    .from(maxPainPosts)
    .where(eq(maxPainPosts.scanDay, date))
    .limit(1);
  if (!post) notFound();

  const tickers = (post.tickers ?? []) as MaxPainTicker[];
  const active = pickActiveTicker(tickers, sp.ticker);

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 pt-4">
        <StocksNavTabs active="maxpain" />
      </div>
      <div className="max-w-7xl mx-auto px-4 pt-4 flex items-center justify-between gap-3">
        <Link href="/maxpain" className="text-sm underline">
          ← Back to latest max-pain scan
        </Link>
        <Link
          href="/maxpain/help"
          className="text-xs text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:underline"
        >
          Help · how to read this →
        </Link>
      </div>
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50 mb-2 font-mono">
          Scan day · {post.scanDay}
        </div>
        <h1 className="text-xl font-semibold mb-4">{post.title}</h1>
        {active ? (
          <MaxPainView post={post} active={active} scanDate={date} />
        ) : (
          <div className="text-sm text-black/60 dark:text-white/60">
            This scan has no tickers — the routine likely failed all fetches that day.
          </div>
        )}
      </div>
    </>
  );
}
