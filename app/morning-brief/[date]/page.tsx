import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";
import BriefDayView from "@/components/BriefDayView";
import {
  loadBriefingByDay,
  listPublicBriefingDays,
} from "@/lib/briefings-public";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";

interface PageProps {
  params: Promise<{ date: string }>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fmtDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date } = await params;
  if (!DATE_RE.test(date)) return {};
  const brief = await loadBriefingByDay(date);
  if (!brief) return {};
  const desc =
    brief.script.length > 180
      ? brief.script.slice(0, 180).trim() + "…"
      : brief.script;
  return {
    title: `Brief — ${fmtDate(date)} | Olivia Trades`,
    description: desc,
    alternates: { canonical: `${APP_URL}/morning-brief/${date}` },
    openGraph: {
      type: "article",
      url: `${APP_URL}/morning-brief/${date}`,
      title: `Brief — ${fmtDate(date)} | Olivia Trades`,
      description: desc,
      videos: [
        {
          url: brief.videoUrl,
          type: "video/mp4",
        },
      ],
    },
  };
}

export const dynamic = "force-dynamic";

export default async function MorningBriefDayPage({ params }: PageProps) {
  const { date } = await params;
  if (!DATE_RE.test(date)) notFound();
  const brief = await loadBriefingByDay(date);
  if (!brief) notFound();

  const allDays = await listPublicBriefingDays(60);
  const otherDays = allDays.filter((d) => d !== date);

  const videoLd = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: `Brief — ${fmtDate(date)}`,
    description: brief.script,
    uploadDate: (brief.postedAt ?? new Date()).toISOString(),
    contentUrl: brief.videoUrl,
    thumbnailUrl: brief.thumbnailUrl ?? undefined,
    publisher: {
      "@type": "Organization",
      name: "0DTE Market Research",
      url: APP_URL,
    },
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(videoLd) }}
      />
      <PublicHeader />
      <BriefDayView brief={brief} otherDays={otherDays} showBreadcrumb />
      <PublicFooter />
    </div>
  );
}
