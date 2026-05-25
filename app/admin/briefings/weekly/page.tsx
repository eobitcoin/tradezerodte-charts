import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { weeklyEarningsBriefings } from "@/lib/db/schema";
import AdminWeeklyEarningsCard from "@/components/AdminWeeklyEarningsCard";
import { weeklyDefaults } from "@/lib/weekly-earnings-publish";
import { ensureDisclaimer, YT_DISCLAIMER, TT_DISCLAIMER } from "@/lib/briefings-copy";

export const dynamic = "force-dynamic";

/**
 * Admin list of Sunday Weekly Earnings Briefs.
 *
 * Reads `weeklyEarningsBriefings` and renders one card per row with full
 * YouTube + TikTok approval / publish controls (Phase 4b). The default
 * title/caption renderers live in `lib/weekly-earnings-publish.ts` so the
 * admin pre-fills and the publish-path fallbacks can never drift apart.
 */
export default async function AdminWeeklyEarningsBriefingsPage() {
  const rows = await db
    .select()
    .from(weeklyEarningsBriefings)
    .orderBy(desc(weeklyEarningsBriefings.weekAnchor))
    .limit(26);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-bold tracking-tight">
            Weekly Earnings Briefs
          </h1>
          <Link
            href="/admin/briefings"
            className="text-xs text-sky-300 hover:underline"
          >
            ← Daily Briefings
          </Link>
        </div>
        <p className="text-sm text-black/60 dark:text-white/60">
          Sunday-morning ~50s briefs covering the coming week&apos;s earnings
          calendar + unusual IV setups. Review and approve each video for
          YouTube and TikTok independently — approved rows are picked up by
          the publish routines on their next run. Public:{" "}
          <Link
            href="/morning-brief/earnings"
            className="underline hover:text-white"
          >
            /morning-brief/earnings
          </Link>
          .
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded border border-black/10 dark:border-white/10 p-6 text-sm text-black/60 dark:text-white/60 text-center">
          No weekly earnings briefs yet. The Sunday 9 AM ET routines populate
          this list — script writer at 13:00 UTC, video at 13:15 UTC.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((b) => (
            <AdminWeeklyEarningsCard
              key={b.id}
              weekAnchor={b.weekAnchor}
              status={b.status}
              script={b.script}
              settingPrompt={b.settingPrompt}
              videoUrl={b.videoS3Key}
              thumbnailUrl={b.thumbnailUrl}
              higgsfieldJobId={b.higgsfieldJobId}
              youtubeVideoId={b.youtubeVideoId}
              errorLog={b.errorLog}
              tickers={b.tickers ?? []}
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
                ytTitle: weeklyDefaults.ytTitle(b.weekAnchor),
                ytCaption: ensureDisclaimer(
                  weeklyDefaults.ytDescription(b.script),
                  YT_DISCLAIMER,
                ),
                ttCaption: ensureDisclaimer(
                  weeklyDefaults.ttCaption(b.script),
                  TT_DISCLAIMER,
                ),
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
