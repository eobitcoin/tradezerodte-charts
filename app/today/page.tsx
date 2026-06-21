import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import PostView from "@/components/PostView";
import ScanTabs from "@/components/ScanTabs";
import AnalysisView from "@/components/AnalysisView";
import TradeCardsView from "@/components/TradeCardsView";
import ScorecardView from "@/components/ScorecardView";
import { nyTradingDay } from "@/lib/trading-day";
import { defaultTabFor, getLatestDayScans, type ScanTab } from "@/lib/scans";

export const dynamic = "force-dynamic";

type Search = { tab?: string };

function resolveTab(raw: string | undefined): ScanTab | null {
  if (
    raw === "premarket" ||
    raw === "market_open" ||
    raw === "analysis" ||
    raw === "trade_cards" ||
    raw === "scorecard"
  ) {
    return raw;
  }
  return null;
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const today = nyTradingDay();
  const scans = await getLatestDayScans();
  const { tab: tabParam } = await searchParams;

  if (!scans) {
    const wantsScorecard = resolveTab(tabParam) === "scorecard";
    return (
      <>
        <SiteHeader />
        <div className="max-w-4xl lg:max-w-5xl mx-auto px-4 pt-6">
          <ScanTabs
            active={wantsScorecard ? "scorecard" : "premarket"}
            hasPremarket={false}
            hasMarketOpen={false}
            hasAnalysis={false}
            hasTradeCards={false}
            hasScorecard
            hrefFor={(t) => `/?tab=${t}`}
          />
        </div>
        {wantsScorecard ? (
          <ScorecardView />
        ) : (
          <main className="flex-1 flex items-center justify-center p-6">
            <div className="text-center space-y-3 max-w-md">
              <h1 className="text-xl font-semibold">No research posted yet</h1>
              <p className="text-sm text-black/60 dark:text-white/60">
                The daily 0DTE Trading Research routine will publish here every morning around 8AM ET.
              </p>
              <Link href="/calendar" className="inline-block underline text-sm">
                Open the calendar →
              </Link>
            </div>
          </main>
        )}
      </>
    );
  }

  const explicit = resolveTab(tabParam);
  const active: ScanTab = explicit ?? defaultTabFor(scans);

  return (
    <>
      <SiteHeader />
      <div className="max-w-4xl lg:max-w-5xl mx-auto px-4 pt-6">
        {scans.tradingDay !== today && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm mb-4">
            Awaiting today&apos;s 0DTE Trading Research (PRE-MARKET ~8:30 AM ET,
            MARKET-OPEN ~9:45 AM, Comparative Analysis at 10:15 AM, and
            SETTLEMENT ~5:15 PM ET · {today}). Showing the most recent
            day&apos;s scans below.
          </div>
        )}
        <ScanTabs
          active={active}
          hasPremarket={!!scans.premarket}
          hasMarketOpen={!!scans.marketOpen}
          hasAnalysis={!!scans.analysis || !!(scans.premarket && scans.marketOpen)}
          hasTradeCards={!!scans.premarket}
          hasScorecard
          hrefFor={(t) => `/?tab=${t}`}
        />
      </div>

      {active === "scorecard" && <ScorecardView />}

      {active === "trade_cards" && (
        <TradeCardsView
          tradingDay={scans.tradingDay}
          premarket={scans.premarket}
          marketOpen={scans.marketOpen}
          analysis={scans.analysis}
          settlement={scans.settlement}
        />
      )}

      {active === "premarket" && scans.premarket && <PostView post={scans.premarket} />}
      {active === "premarket" && !scans.premarket && (
        <PendingNotice
          tradingDay={scans.tradingDay}
          message={`Awaiting the premarket scan for ${scans.tradingDay} (~8:30 ET).`}
        />
      )}

      {active === "market_open" && scans.marketOpen && <PostView post={scans.marketOpen} />}
      {active === "market_open" && !scans.marketOpen && (
        <PendingNotice
          tradingDay={scans.tradingDay}
          message={`Awaiting the market-open scan (~9:45 ET).`}
        />
      )}

      {active === "analysis" && (
        <AnalysisView
          tradingDay={scans.tradingDay}
          premarket={scans.premarket}
          marketOpen={scans.marketOpen}
          analysis={scans.analysis}
        />
      )}
    </>
  );
}

function PendingNotice({ tradingDay, message }: { tradingDay: string; message: string }) {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <div className="rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
        {message}
        <div className="mt-2 text-xs text-black/55 dark:text-white/55">Trading day · {tradingDay}</div>
      </div>
    </main>
  );
}
