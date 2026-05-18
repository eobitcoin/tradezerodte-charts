import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { maxPainPosts, type MaxPainTicker } from "@/lib/db/schema";
import { nyTradingDay } from "@/lib/trading-day";
import SiteHeader from "@/components/SiteHeader";
import StocksTabs from "@/components/StocksTabs";
import MaxPainView from "@/components/MaxPainView";
import { pickActiveTicker } from "@/lib/max-pain";

export const dynamic = "force-dynamic";

export default async function MaxPainTodayPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string }>;
}) {
  const params = await searchParams;
  const today = nyTradingDay();
  const [latest] = await db
    .select()
    .from(maxPainPosts)
    .orderBy(desc(maxPainPosts.scanDay))
    .limit(1);

  if (!latest) {
    return (
      <>
        <SiteHeader />
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <StocksTabs active="maxpain" />
        </div>
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-3 max-w-md">
            <h1 className="text-xl font-semibold">No max-pain scans yet</h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              The Max Pain scanner runs every weekday at 9:55 AM ET. Once it publishes, the most
              recent results will appear here.
            </p>
            <Link href="/" className="inline-block underline text-sm">
              Back to today&apos;s 0DTE research →
            </Link>
          </div>
        </main>
      </>
    );
  }

  const tickers = (latest.tickers ?? []) as MaxPainTicker[];
  const active = pickActiveTicker(tickers, params.ticker);
  if (!active) {
    return (
      <>
        <SiteHeader />
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <StocksTabs active="maxpain" />
        </div>
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-3 max-w-md">
            <h1 className="text-xl font-semibold">Scan exists but has no tickers</h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              Latest scan: {latest.scanDay}. Likely the routine encountered fetch errors for every ticker.
            </p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 pt-4">
        <StocksTabs active="maxpain" />
      </div>
      {latest.scanDay !== today && (
        <div className="max-w-7xl mx-auto px-4 pt-6">
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            Awaiting today&apos;s Max Pain scan ({today}, runs ~9:55 AM ET). Showing the most recent below.
          </div>
        </div>
      )}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50 font-mono">
            Scan day · {latest.scanDay}
          </div>
          <Link
            href="/maxpain/help"
            className="text-xs text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:underline"
          >
            Help · how to read this →
          </Link>
        </div>
        <h1 className="text-xl font-semibold mb-4">{latest.title}</h1>
        <MaxPainView post={latest} active={active} scanDate={null} />
      </div>
    </>
  );
}
