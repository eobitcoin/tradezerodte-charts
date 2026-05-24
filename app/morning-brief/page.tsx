import type { Metadata } from "next";
import Link from "next/link";
import AdaptiveHeader from "@/components/AdaptiveHeader";
import PublicFooter from "@/components/PublicFooter";
import BriefDayView from "@/components/BriefDayView";
import EarningsBriefDayView from "@/components/EarningsBriefDayView";
import {
  loadLatestBriefing,
  loadBriefingByDay,
  listPublicBriefingDays,
  loadLatestWeeklyEarnings,
  loadWeeklyEarningsByAnchor,
  listPublicWeeklyEarningsAnchors,
} from "@/lib/briefings-public";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Brief with Olivia Trades — Daily 0DTE Setups + Weekly Earnings Brief",
  description:
    "Every morning before the bell, Olivia reads the tape and gives you the top three 0DTE setups in 20 seconds. Every Sunday morning, she walks the coming week's earnings prints and IV setups.",
  alternates: { canonical: `${APP_URL}/morning-brief` },
  openGraph: {
    type: "website",
    url: `${APP_URL}/morning-brief`,
    title: "Brief with Olivia Trades — Daily 0DTE + Weekly Earnings",
    description:
      "Daily 0DTE setups in 20 seconds. Sunday weekly earnings brief in under a minute. Levels, strikes, conviction.",
  },
};

type Kind = "daily" | "earnings";

interface PageProps {
  searchParams: Promise<{ kind?: string; week?: string }>;
}

/**
 * Shared tab bar at the top of the brief page. Lets visitors toggle between
 * the daily 0DTE recap and the Sunday weekly earnings brief without leaving
 * /morning-brief. Renders inside the BriefDayView / EarningsBriefDayView so
 * both kinds get the same chrome.
 */
function TabBar({ active }: { active: Kind }) {
  const base =
    "inline-flex items-center px-4 py-2 rounded-md text-[11px] font-bold uppercase tracking-[0.22em] transition-colors";
  const activeCls = "bg-red-600 text-white";
  const inactiveCls =
    "border border-white/15 text-white/65 hover:text-white hover:border-white/30 hover:bg-white/[0.04]";
  return (
    <nav className="mb-8 flex flex-wrap items-center gap-2">
      <Link
        href="/morning-brief"
        className={`${base} ${active === "daily" ? activeCls : inactiveCls}`}
      >
        Daily Brief
      </Link>
      <Link
        href="/morning-brief?kind=earnings"
        className={`${base} ${active === "earnings" ? activeCls : inactiveCls}`}
      >
        Earnings Brief
      </Link>
    </nav>
  );
}

export default async function MorningBriefIndexPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const kind: Kind = params.kind === "earnings" ? "earnings" : "daily";

  if (kind === "earnings") {
    return <EarningsTab requestedWeek={params.week} />;
  }
  return <DailyTab />;
}

// ---------------------------------------------------------------------------

async function DailyTab() {
  const latest = await loadLatestBriefing();
  if (!latest) return <EmptyState kind="daily" />;

  const [withCalls, allDays] = await Promise.all([
    loadBriefingByDay(latest.tradingDay),
    listPublicBriefingDays(60),
  ]);
  if (!withCalls) return null;
  const otherDays = allDays.filter((d) => d !== latest.tradingDay);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <AdaptiveHeader />
      {/* Tab bar above the existing BriefDayView body. BriefDayView itself
          doesn't render the tabs (it's shared with /morning-brief/[date]
          archive routes where tabs aren't appropriate), so we slot them in
          here as a sibling. */}
      <div className="max-w-5xl mx-auto px-6 pt-10 lg:pt-14 w-full">
        <TabBar active="daily" />
      </div>
      <BriefDayView brief={withCalls} otherDays={otherDays} showBreadcrumb={false} />
      <PublicFooter />
    </div>
  );
}

async function EarningsTab({ requestedWeek }: { requestedWeek?: string }) {
  // If a specific week was requested via ?week=YYYY-MM-DD, load that;
  // otherwise the most recent published weekly brief.
  const brief = requestedWeek
    ? await loadWeeklyEarningsByAnchor(requestedWeek)
    : await loadLatestWeeklyEarnings();
  if (!brief) return <EmptyState kind="earnings" />;

  const allWeeks = await listPublicWeeklyEarningsAnchors(26);
  const otherWeeks = allWeeks.filter((w) => w !== brief.weekAnchor);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <AdaptiveHeader />
      <EarningsBriefDayView
        brief={brief}
        otherWeeks={otherWeeks}
        tabBar={<TabBar active="earnings" />}
      />
      <PublicFooter />
    </div>
  );
}

function EmptyState({ kind }: { kind: Kind }) {
  const isDaily = kind === "daily";
  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <AdaptiveHeader />
      <main className="flex-1 max-w-3xl mx-auto px-6 py-16 font-sans w-full">
        <TabBar active={kind} />
        <header className="space-y-3 mb-8">
          <div className="text-[10px] uppercase tracking-widest text-red-400">
            {isDaily
              ? "Brief · daily · 20 seconds"
              : "Earnings Brief · weekly · Sunday morning"}
          </div>
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight">
            Olivia Trades.
          </h1>
          <div className="space-y-2 text-sm text-white/75 leading-relaxed">
            <p>
              {isDaily ? (
                <>
                  Every morning before the bell, Olivia reads the tape and
                  gives you the top three 0DTE setups in twenty seconds. Then
                  she&apos;s gone &mdash; coffee in hand, on to the next thing.
                </>
              ) : (
                <>
                  Every Sunday morning, Olivia walks the coming week&apos;s
                  most important earnings prints and flags the names where the
                  options market is pricing something unusual.
                </>
              )}
            </p>
            <p className="text-white/85 italic font-semibold">
              Trade the Edge. Respect the Risk.
            </p>
          </div>
        </header>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-8 text-center">
          <p className="text-sm text-white/75">
            {isDaily ? (
              <>
                Today&apos;s brief hasn&apos;t published yet. Olivia drops the
                new video around <strong>9:00 AM ET</strong> every weekday, 15
                minutes after the premarket scan lands. Come back then.
              </>
            ) : (
              <>
                This week&apos;s earnings brief hasn&apos;t published yet.
                Olivia drops the new video around{" "}
                <strong>9:00 AM ET on Sundays</strong>. Come back then.
              </>
            )}
          </p>
          <div className="mt-4">
            <Link
              href="/welcome#waitlist"
              className="inline-block px-5 py-3 rounded-md bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold uppercase tracking-[0.22em] transition-colors"
            >
              Request an Invitation
            </Link>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
