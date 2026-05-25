import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdaptiveHeader from "@/components/AdaptiveHeader";
import PublicFooter from "@/components/PublicFooter";
import EarningsBriefDayView from "@/components/EarningsBriefDayView";
import MorningBriefTabBar from "@/components/MorningBriefTabBar";
import {
  loadWeeklyEarningsByAnchor,
  listPublicWeeklyEarningsAnchors,
} from "@/lib/briefings-public";
import {
  buildSeoTitle,
  buildSeoDescription,
  buildCanonicalUrl,
  buildVideoObjectJsonLd,
} from "@/lib/earnings-brief-seo";

/**
 * /morning-brief/earnings/[anchor] — the canonical, indexable page for a
 * single Sunday Weekly Earnings Brief.
 *
 * SEO is the whole point of this route:
 *   - `<title>` + `<meta description>` are dynamic on the tickers covered
 *     so the strongest signals carry the symbol names.
 *   - JSON-LD `VideoObject` with `about: [Corporation × n]` connects the
 *     video to each ticker in Google's knowledge graph.
 *   - Per-week URL = stable canonical. The latest-week landing page
 *     redirects here so link equity concentrates on a dated, permanent
 *     surface.
 *
 * `anchor` must be a Sunday date (YYYY-MM-DD). Anything else → 404.
 */

const ANCHOR_RE = /^\d{4}-\d{2}-\d{2}$/;

interface PageProps {
  params: Promise<{ anchor: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { anchor } = await params;
  if (!ANCHOR_RE.test(anchor)) {
    return { title: "Weekly Earnings Brief — Olivia Trades" };
  }
  const brief = await loadWeeklyEarningsByAnchor(anchor);
  if (!brief) {
    return {
      title: "Weekly Earnings Brief — Olivia Trades",
      robots: { index: false, follow: false },
    };
  }
  const title = buildSeoTitle(brief);
  const description = buildSeoDescription(brief);
  const url = buildCanonicalUrl(brief.weekAnchor);
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
      players: [{ playerUrl: brief.videoUrl, streamUrl: brief.videoUrl, width: 720, height: 1280 }],
    },
  };
}

export default async function MorningBriefEarningsByWeekPage({ params }: PageProps) {
  const { anchor } = await params;
  if (!ANCHOR_RE.test(anchor)) notFound();
  const brief = await loadWeeklyEarningsByAnchor(anchor);
  if (!brief) notFound();

  const allWeeks = await listPublicWeeklyEarningsAnchors(26);
  const otherWeeks = allWeeks.filter((w) => w !== brief.weekAnchor);

  const jsonLd = buildVideoObjectJsonLd(brief);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      {/* JSON-LD: connects this page to each ticker in Google's knowledge
          graph via VideoObject.about[Corporation]. Placed in <body> with
          dangerouslySetInnerHTML — standard Next.js pattern for structured
          data on server components. */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <AdaptiveHeader />
      <EarningsBriefDayView
        brief={brief}
        otherWeeks={otherWeeks}
        tabBar={<MorningBriefTabBar active="earnings" />}
      />
      <PublicFooter />
    </div>
  );
}
