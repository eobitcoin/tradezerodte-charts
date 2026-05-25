import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdaptiveHeader from "@/components/AdaptiveHeader";
import PublicFooter from "@/components/PublicFooter";
import BriefDayView from "@/components/BriefDayView";
import MorningBriefTabBar from "@/components/MorningBriefTabBar";
import {
  loadBriefingByDay,
  listPublicBriefingDays,
} from "@/lib/briefings-public";
import {
  buildSeoTitle,
  buildSeoDescription,
  buildCanonicalUrl,
  buildVideoObjectJsonLd,
} from "@/lib/daily-brief-seo";

/**
 * /morning-brief/[date] — the canonical, indexable page for a single
 * daily 0DTE brief.
 *
 * SEO parity with /morning-brief/earnings/[anchor]:
 *   - `<title>` fronts the top-3 call tickers ("SPY, TSLA, NVDA")
 *   - `<meta description>` opens with the script's first sentence and
 *     names the calls with direction ("SPY puts, TSLA calls, …")
 *   - JSON-LD VideoObject with about[Corporation per call ticker] so
 *     Google's finance + rich-result crawlers link this video to each
 *     equity in their knowledge graph.
 *   - Tab bar rendered so users landing here from the redirect at
 *     /morning-brief still see Daily/Earnings tabs.
 */

interface PageProps {
  params: Promise<{ date: string }>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date } = await params;
  if (!DATE_RE.test(date)) {
    return { title: "Daily 0DTE Brief — Olivia Trades" };
  }
  const brief = await loadBriefingByDay(date);
  if (!brief) {
    return {
      title: "Daily 0DTE Brief — Olivia Trades",
      robots: { index: false, follow: false },
    };
  }
  const title = buildSeoTitle(brief);
  const description = buildSeoDescription(brief);
  const url = buildCanonicalUrl(brief.tradingDay);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "video.other",
      url,
      title,
      description,
      videos: [{ url: brief.videoUrl, type: "video/mp4" }],
      images: brief.thumbnailUrl ? [{ url: brief.thumbnailUrl }] : undefined,
    },
    twitter: {
      card: "player",
      title,
      description,
      players: [
        { playerUrl: brief.videoUrl, streamUrl: brief.videoUrl, width: 720, height: 1280 },
      ],
    },
  };
}

export default async function MorningBriefDayPage({ params }: PageProps) {
  const { date } = await params;
  if (!DATE_RE.test(date)) notFound();
  const brief = await loadBriefingByDay(date);
  if (!brief) notFound();

  const allDays = await listPublicBriefingDays(60);
  const otherDays = allDays.filter((d) => d !== date);

  const jsonLd = buildVideoObjectJsonLd(brief);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <AdaptiveHeader />
      <BriefDayView
        brief={brief}
        otherDays={otherDays}
        showBreadcrumb
        tabBar={<MorningBriefTabBar active="daily" />}
      />
      <PublicFooter />
    </div>
  );
}
