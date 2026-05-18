import Link from "next/link";
import { notFound } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import PostView from "@/components/PostView";
import ScanTabs from "@/components/ScanTabs";
import AnalysisView from "@/components/AnalysisView";
import TradeCardsView from "@/components/TradeCardsView";
import { defaultTabFor, getScansForDay, type ScanTab } from "@/lib/scans";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Search = { tab?: string };

function resolveTab(raw: string | undefined): ScanTab | null {
  if (
    raw === "premarket" ||
    raw === "market_open" ||
    raw === "analysis" ||
    raw === "trade_cards"
  ) {
    return raw;
  }
  return null;
}

export default async function PostDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<Search>;
}) {
  const { date } = await params;
  if (!DATE_RE.test(date)) notFound();

  const scans = await getScansForDay(date);
  if (!scans.premarket && !scans.marketOpen && !scans.analysis) notFound();

  const { tab } = await searchParams;
  const explicit = resolveTab(tab);
  const active: ScanTab = explicit ?? defaultTabFor(scans);

  const month = date.slice(0, 7);

  return (
    <>
      <SiteHeader />
      <div className="max-w-4xl lg:max-w-5xl mx-auto px-4 pt-4">
        <Link href={`/calendar?month=${month}`} className="text-sm underline">
          ← Back to {month}
        </Link>
      </div>
      <div className="max-w-4xl lg:max-w-5xl mx-auto px-4 pt-4">
        <ScanTabs
          active={active}
          hasPremarket={!!scans.premarket}
          hasMarketOpen={!!scans.marketOpen}
          hasAnalysis={!!scans.analysis || !!(scans.premarket && scans.marketOpen)}
          hasTradeCards={!!scans.premarket}
          hrefFor={(t) => `/posts/${date}?tab=${t}`}
        />
      </div>

      {active === "trade_cards" && (
        <TradeCardsView
          tradingDay={date}
          premarket={scans.premarket}
          marketOpen={scans.marketOpen}
          analysis={scans.analysis}
          settlement={scans.settlement}
        />
      )}
      {active === "premarket" && scans.premarket && <PostView post={scans.premarket} />}
      {active === "market_open" && scans.marketOpen && <PostView post={scans.marketOpen} />}
      {active === "analysis" && (
        <AnalysisView
          tradingDay={date}
          premarket={scans.premarket}
          marketOpen={scans.marketOpen}
          analysis={scans.analysis}
        />
      )}

      {((active === "premarket" && !scans.premarket) ||
        (active === "market_open" && !scans.marketOpen)) && (
        <main className="max-w-3xl mx-auto px-4 py-10">
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            {active === "premarket"
              ? `No premarket scan was published for ${date}.`
              : `No market-open scan was published for ${date}.`}
          </div>
        </main>
      )}
    </>
  );
}
