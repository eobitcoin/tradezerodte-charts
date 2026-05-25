import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AdaptiveHeader from "@/components/AdaptiveHeader";
import PublicFooter from "@/components/PublicFooter";
import MorningBriefTabBar from "@/components/MorningBriefTabBar";
import { loadLatestBriefing } from "@/lib/briefings-public";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Daily 0DTE Brief — Olivia Trades",
  description:
    "Every morning before the bell, Olivia reads the tape and gives you the top three 0DTE setups in 20 seconds — strikes, levels, and the reason. No fluff, just the calls.",
  alternates: { canonical: `${APP_URL}/morning-brief` },
  openGraph: {
    type: "website",
    url: `${APP_URL}/morning-brief`,
    title: "Daily 0DTE Brief — Olivia Trades",
    description:
      "Top three 0DTE setups every morning, in 20 seconds. Levels, strikes, conviction. Daily.",
  },
};

interface PageProps {
  searchParams: Promise<{ kind?: string; week?: string }>;
}

export default async function MorningBriefIndexPage({ searchParams }: PageProps) {
  const params = await searchParams;

  // Legacy URLs from the first release shipped earnings under ?kind=earnings.
  // Permanent-redirect to the new clean /morning-brief/earnings(/[anchor]) path
  // so external links and bookmarks continue to work and link equity moves
  // to the canonical surface.
  if (params.kind === "earnings") {
    if (params.week && /^\d{4}-\d{2}-\d{2}$/.test(params.week)) {
      redirect(`/morning-brief/earnings/${params.week}`);
    }
    redirect("/morning-brief/earnings");
  }

  // When a brief exists, 308-redirect to the per-day canonical so link
  // equity concentrates on the dated URL (which is permanent + carries
  // ticker-rich title/description for SEO). Mirrors the /morning-brief/earnings
  // landing pattern.
  const latest = await loadLatestBriefing();
  if (latest) {
    redirect(`/morning-brief/${latest.tradingDay}`);
  }

  // Empty state — no brief published yet (first run, or off-hours weekend).
  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <AdaptiveHeader />
      <main className="flex-1 max-w-3xl mx-auto px-6 py-16 font-sans w-full">
        <MorningBriefTabBar active="daily" />
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
              you the top three 0DTE setups in twenty seconds. Then she&apos;s
              gone &mdash; coffee in hand, on to the next thing.
            </p>
            <p className="text-white/85 italic font-semibold">
              Trade the Edge. Respect the Risk.
            </p>
          </div>
        </header>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-8 text-center">
          <p className="text-sm text-white/75">
            Today&apos;s brief hasn&apos;t published yet. Olivia drops the new
            video around <strong>9:00 AM ET</strong> every weekday, 15 minutes
            after the premarket scan lands. Come back then.
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
