import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefings } from "@/lib/db/schema";
import AdminBriefingCard from "@/components/AdminBriefingCard";
import { ensureDisclaimer, YT_DISCLAIMER, TT_DISCLAIMER } from "@/lib/briefings-copy";

export const dynamic = "force-dynamic";

type FilterKey = "needs_review" | "approved" | "posted" | "all";

interface PageProps {
  searchParams: Promise<{ filter?: string }>;
}

function fmtShort(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Derive a default YouTube title from the trading day. Stays under 100 chars.
 * Example: "0DTE Morning Brief — Mon, May 19"
 */
function defaultYtTitle(day: string): string {
  return `0DTE Morning Brief — ${fmtShort(day)}`;
}

/**
 * Default YouTube description: script body + tagline + site link + hashtags.
 * Falls under 5000 char cap by a huge margin.
 */
function defaultYtCaption(script: string | null): string {
  const body = script?.trim() || "Today's 0DTE setups from Olivia Trades.";
  const marketing =
    `${body}\n\n` +
    `More daily setups: https://www.tradezerodte.com/morning-brief\n\n` +
    `#0DTE #Options #DayTrading #StockMarket #Trading`;
  return ensureDisclaimer(marketing, YT_DISCLAIMER);
}

/**
 * Default TikTok caption: tighter, hashtag-heavy. Cap is 2200 chars but TikTok
 * favors short. Disclaimer is appended for legal cover.
 */
function defaultTtCaption(script: string | null): string {
  const hook = script?.trim().split(/[.!?]/)[0] || "Today's 0DTE picks.";
  const marketing = `${hook}\n\n#0DTE #Options #DayTrading #StockMarket`;
  return ensureDisclaimer(marketing, TT_DISCLAIMER);
}

export default async function AdminBriefingsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filter: FilterKey =
    params.filter === "approved"
      ? "approved"
      : params.filter === "posted"
        ? "posted"
        : params.filter === "all"
          ? "all"
          : "needs_review";

  const rows = await db
    .select()
    .from(briefings)
    .orderBy(desc(briefings.tradingDay))
    .limit(60);

  const filtered = rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "needs_review") {
      return (
        !!r.videoS3Key &&
        (r.ytStatus === "pending_review" || r.ttStatus === "pending_review")
      );
    }
    if (filter === "approved") {
      return r.ytStatus === "approved" || r.ttStatus === "approved";
    }
    if (filter === "posted") {
      return r.ytStatus === "posted" || r.ttStatus === "posted";
    }
    return true;
  });

  const counts = {
    needs_review: rows.filter(
      (r) =>
        !!r.videoS3Key &&
        (r.ytStatus === "pending_review" || r.ttStatus === "pending_review"),
    ).length,
    approved: rows.filter(
      (r) => r.ytStatus === "approved" || r.ttStatus === "approved",
    ).length,
    posted: rows.filter(
      (r) => r.ytStatus === "posted" || r.ttStatus === "posted",
    ).length,
    all: rows.length,
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Daily Briefings</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Olivia Trades 20-second briefs. Review and approve each video for
          YouTube and TikTok independently. Approved rows are picked up by the
          publish routines on their next run.
        </p>
      </header>

      {/* FILTER CHIPS */}
      <nav className="flex flex-wrap items-center gap-2 text-xs">
        <FilterChip
          href="/admin/briefings?filter=needs_review"
          active={filter === "needs_review"}
          label="Needs review"
          count={counts.needs_review}
          tone="amber"
        />
        <FilterChip
          href="/admin/briefings?filter=approved"
          active={filter === "approved"}
          label="Approved"
          count={counts.approved}
          tone="emerald"
        />
        <FilterChip
          href="/admin/briefings?filter=posted"
          active={filter === "posted"}
          label="Posted"
          count={counts.posted}
          tone="emerald"
        />
        <FilterChip
          href="/admin/briefings?filter=all"
          active={filter === "all"}
          label="All"
          count={counts.all}
          tone="white"
        />
      </nav>

      {filtered.length === 0 ? (
        <div className="rounded border border-black/10 dark:border-white/10 p-6 text-sm text-black/60 dark:text-white/60 text-center">
          {filter === "needs_review"
            ? "Nothing waiting for review. Videos appear here once Hedra finishes rendering."
            : `No briefings match filter "${filter}".`}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((b) => (
            <AdminBriefingCard
              key={b.id}
              tradingDay={b.tradingDay}
              status={b.status}
              script={b.script}
              settingPrompt={b.settingPrompt}
              videoUrl={b.videoS3Key}
              thumbnailUrl={b.thumbnailUrl}
              higgsfieldJobId={b.higgsfieldJobId}
              youtubeVideoId={b.youtubeVideoId}
              errorLog={b.errorLog}
              yt={{
                status: b.ytStatus,
                title: b.ytTitle,
                caption: b.ytCaption,
                postedAt: b.ytPostedAt?.toISOString() ?? null,
                error: b.ytError,
              }}
              tt={{
                status: b.ttStatus,
                caption: b.ttCaption,
                publishId: b.ttPublishId,
                postedAt: b.ttPostedAt?.toISOString() ?? null,
                error: b.ttError,
              }}
              defaults={{
                ytTitle: defaultYtTitle(b.tradingDay),
                ytCaption: defaultYtCaption(b.script),
                ttCaption: defaultTtCaption(b.script),
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({
  href,
  active,
  label,
  count,
  tone,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
  tone: "amber" | "emerald" | "white";
}) {
  const baseTone =
    tone === "amber"
      ? "border-amber-500/40 text-amber-300"
      : tone === "emerald"
        ? "border-emerald-500/40 text-emerald-300"
        : "border-white/15 text-white/65";
  const activeBg =
    tone === "amber"
      ? "bg-amber-500/15"
      : tone === "emerald"
        ? "bg-emerald-500/15"
        : "bg-white/[0.06]";
  return (
    <Link
      href={href}
      className={`inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded border ${baseTone} ${active ? activeBg : "hover:bg-white/[0.03]"} transition-colors`}
    >
      <span className="uppercase tracking-widest text-[10px] font-bold">
        {label}
      </span>
      <span className="font-mono text-[10px] opacity-75">{count}</span>
    </Link>
  );
}
