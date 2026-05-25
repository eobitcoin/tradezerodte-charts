import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AdaptiveHeader from "@/components/AdaptiveHeader";
import PublicFooter from "@/components/PublicFooter";
import MorningBriefTabBar from "@/components/MorningBriefTabBar";
import { loadLatestWeeklyEarnings } from "@/lib/briefings-public";

/**
 * /morning-brief/earnings — landing page for the latest published Sunday
 * Weekly Earnings Brief. Redirects (308) to the canonical per-week URL
 * once a brief exists, so each week becomes its own indexable page in
 * Google. When nothing is published yet, renders an empty-state.
 *
 * Why redirect rather than render here: a single "latest" URL accumulates
 * link equity to whatever week happens to be current, which fragments
 * across weeks. Per-week canonicals are stable, individually rankable for
 * queries like "MRVL earnings preview May 25", and don't ever 404.
 */

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Weekly Earnings Brief — Olivia Trades",
  description:
    "Every Sunday morning, Olivia walks the coming week's most important earnings prints and flags the names where the options market is pricing something unusual.",
  alternates: { canonical: `${APP_URL}/morning-brief/earnings` },
  openGraph: {
    type: "website",
    url: `${APP_URL}/morning-brief/earnings`,
    title: "Weekly Earnings Brief — Olivia Trades",
    description:
      "Sunday weekly earnings brief in under a minute. Levels, IV setups, names to watch.",
  },
};

export default async function MorningBriefEarningsLandingPage() {
  const latest = await loadLatestWeeklyEarnings();

  // Redirect to the canonical per-week URL so Google indexes the dated
  // page (which stays valid forever) rather than the rolling latest URL.
  // 308 = permanent + preserves method; safe because the destination is
  // deterministic from the latest-published row.
  if (latest) {
    redirect(`/morning-brief/earnings/${latest.weekAnchor}`);
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <AdaptiveHeader />
      <main className="flex-1 max-w-3xl mx-auto px-6 py-16 font-sans w-full">
        <MorningBriefTabBar active="earnings" />
        <header className="space-y-3 mb-8">
          <div className="text-[10px] uppercase tracking-widest text-red-400">
            Earnings Brief · weekly · Sunday morning
          </div>
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight">
            Olivia Trades.
          </h1>
          <p className="text-sm text-white/75 leading-relaxed">
            Every Sunday morning, Olivia walks the coming week&apos;s most
            important earnings prints and flags the names where the options
            market is pricing something unusual.
          </p>
        </header>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-8 text-center">
          <p className="text-sm text-white/75">
            This week&apos;s earnings brief hasn&apos;t published yet. Olivia
            drops the new video around <strong>9:00 AM ET on Sundays</strong>.
            Come back then.
          </p>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}

