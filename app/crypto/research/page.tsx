import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cryptoPosts } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import CryptoTabs from "@/components/CryptoTabs";
import CryptoResearchView from "@/components/CryptoResearchView";
import CryptoResearchSidebar, {
  type CryptoResearchSidebarItem,
} from "@/components/CryptoResearchSidebar";

export const dynamic = "force-dynamic";

export default async function CryptoResearchLatestPage() {
  const [latest] = await db
    .select()
    .from(cryptoPosts)
    .orderBy(desc(cryptoPosts.scanDay))
    .limit(1);

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
          <p className="text-sm text-black/60 dark:text-white/60">
            Live radar + daily research for crypto USDT pairs.
          </p>
        </header>
        <CryptoTabs active="research" />

        {!latest ? (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm space-y-2">
            <p>
              No crypto research posts yet. The Daily Research routine writes here when it runs.
            </p>
            <p className="text-xs text-black/55 dark:text-white/55">
              Configure a daily routine that calls the{" "}
              <code className="px-1 py-0.5 rounded bg-black/5 dark:bg-white/10">publish_crypto_research</code>{" "}
              MCP tool. See the routine prompt template in the repo at{" "}
              <code className="px-1 py-0.5 rounded bg-black/5 dark:bg-white/10">examples/crypto-research-routine-mcp.md</code>.
            </p>
            <p>
              <Link href="/crypto" className="underline">← Back to Crypto Radar</Link>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-6 lg:gap-10">
            <main className="min-w-0">
              <CryptoResearchView post={latest} />
            </main>
            <CryptoResearchSidebar items={sidebarItems} currentScanDay={latest.scanDay} />
          </div>
        )}
      </div>
    </>
  );
}
