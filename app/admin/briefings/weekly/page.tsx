import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { weeklyEarningsBriefings } from "@/lib/db/schema";
import AdminWeeklyEarningsCard from "@/components/AdminWeeklyEarningsCard";

export const dynamic = "force-dynamic";

/**
 * Admin list of Sunday Weekly Earnings Briefs.
 *
 * Parallel to /admin/briefings (daily) but reads the separate
 * `weeklyEarningsBriefings` table. Phase 4a is preview-only — see
 * AdminWeeklyEarningsCard for the explanation. Approve / publish UI lands
 * with the corresponding /api/admin/weekly-briefings routes in Phase 4b.
 *
 * The video bucket key in `videoS3Key` is a fully-formed public URL
 * (https://www.oliviatrades.com/api/weekly-briefings/video/YYYY-MM-DD) so
 * the video element can use it directly.
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
          calendar + unusual IV setups. Published by the Olivia narrator on
          the public{" "}
          <Link
            href="/morning-brief?kind=earnings"
            className="underline hover:text-white"
          >
            /morning-brief?kind=earnings
          </Link>{" "}
          tab.
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
              errorLog={b.errorLog}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
