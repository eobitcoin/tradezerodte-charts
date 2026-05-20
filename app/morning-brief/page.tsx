import type { Metadata } from "next";
import Link from "next/link";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";
import BriefDayView from "@/components/BriefDayView";
import {
  loadLatestBriefing,
  loadBriefingByDay,
  listPublicBriefingDays,
} from "@/lib/briefings-public";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title:
    "Brief with Olivia Trades — Daily 20-Second 0DTE Setup Recap",
  description:
    "Every morning before the bell, Olivia reads the tape and gives you the top three 0DTE setups in 20 seconds — strikes, levels, and the reason. No fluff, just the calls.",
  alternates: { canonical: `${APP_URL}/morning-brief` },
  openGraph: {
    type: "website",
    url: `${APP_URL}/morning-brief`,
    title: "Brief with Olivia Trades — Daily 0DTE Setups in 20s",
    description:
      "Top three 0DTE setups every morning, in 20 seconds. Levels, strikes, conviction. Daily.",
  },
};

export default async function MorningBriefIndexPage() {
  // The "index" route is just the full-day view of the latest published
  // briefing. No separate hub/grid page — users land directly on watch.
  const latest = await loadLatestBriefing();

  if (!latest) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
        <PublicHeader />
        <main className="flex-1 max-w-3xl mx-auto px-6 py-16 font-sans w-full">
          <header className="space-y-3 mb-8">
            <div className="text-[10px] uppercase tracking-widest text-red-400">
              Brief · daily · 20 seconds
            </div>
            <h1 className="text-3xl lg:text-4xl font-bold tracking-tight">
              Olivia Trades.
            </h1>
            <div className="space-y-2 text-sm text-white/75 leading-relaxed">
              <p>
                Every morning before the bell, Olivia reads the tape and gives
                you the top three 0DTE setups in twenty seconds. Then
                she&apos;s gone &mdash; coffee in hand, on to the next thing.
              </p>
              <p className="text-white/85 italic font-semibold">
                Trade the Edge. Respect the Risk.
              </p>
            </div>
          </header>
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-8 text-center">
            <p className="text-sm text-white/75">
              Today&apos;s brief hasn&apos;t published yet. Olivia drops the
              new video around <strong>9:00 AM ET</strong> every weekday, 15
              minutes after the premarket scan lands. Come back then.
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

  // Load the full per-day view (with top-3 calls) for the latest date.
  const [withCalls, allDays] = await Promise.all([
    loadBriefingByDay(latest.tradingDay),
    listPublicBriefingDays(60),
  ]);
  if (!withCalls) {
    // Vanishingly rare race (briefing got deleted between the two reads).
    // Fall back to a placeholder rather than crashing the page.
    return null;
  }
  const otherDays = allDays.filter((d) => d !== latest.tradingDay);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <PublicHeader />
      <BriefDayView brief={withCalls} otherDays={otherDays} showBreadcrumb={false} />
      <PublicFooter />
    </div>
  );
}
