import type {
  BriefingErrorEvent,
  BriefingStatus,
} from "@/lib/db/schema";

interface CardProps {
  weekAnchor: string;
  status: BriefingStatus;
  script: string | null;
  settingPrompt: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  higgsfieldJobId: string | null;
  errorLog: BriefingErrorEvent[];
}

function statusTone(status: BriefingStatus): string {
  switch (status) {
    case "scripted":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "generating":
      return "border-sky-500/30 bg-sky-500/10 text-sky-300";
    case "pending_upload":
      return "border-violet-500/30 bg-violet-500/10 text-violet-300";
    case "uploading":
      return "border-sky-500/30 bg-sky-500/10 text-sky-300";
    case "posted":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "failed":
      return "border-rose-500/30 bg-rose-500/10 text-rose-300";
    default:
      return "border-white/15 bg-white/[0.04] text-white/65";
  }
}

function wordCount(s: string | null): number {
  if (!s) return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function fmtWeekRange(sundayAnchor: string): string {
  // weekAnchor is a Sunday — the "trading week" is Mon→Fri after it.
  const start = new Date(`${sundayAnchor}T12:00:00Z`);
  const mon = new Date(start);
  mon.setUTCDate(start.getUTCDate() + 1);
  const fri = new Date(start);
  fri.setUTCDate(start.getUTCDate() + 5);
  const sameMonth = mon.getUTCMonth() === fri.getUTCMonth();
  const monLabel = mon.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const friLabel = fri.toLocaleDateString(undefined, {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `Week of ${monLabel} — ${friLabel}`;
}

/**
 * Read-only preview card for a Weekly Earnings Brief row.
 *
 * Intentionally NOT a client component yet — Phase 4a surfaces the video so
 * the user can verify each Sunday render before we wire up YouTube + TikTok
 * publish controls (Phase 4b). The MCP backend already accepts approve /
 * publish actions; the corresponding admin API routes + per-platform UI come
 * next pass.
 */
export default function AdminWeeklyEarningsCard(props: CardProps) {
  const {
    weekAnchor,
    status,
    script,
    settingPrompt,
    videoUrl,
    thumbnailUrl,
    higgsfieldJobId,
    errorLog,
  } = props;

  const wc = wordCount(script);
  // Weekly word budget per publish_weekly_earnings_script: target 80–130, hard
  // bounds 60–180. Green when within target, amber when within hard bounds.
  const wcInTarget = wc >= 80 && wc <= 130;
  const wcOk = wc >= 60 && wc <= 180;

  return (
    <li className="rounded-lg border border-black/10 dark:border-white/10 bg-white/[0.02] p-4 space-y-4">
      {/* HEADER */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="font-mono text-xs text-black/55 dark:text-white/55">
            {weekAnchor}
          </span>
          <span className="text-sm font-semibold tracking-tight">
            {fmtWeekRange(weekAnchor)}
          </span>
          <span
            className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${statusTone(status)}`}
          >
            {status}
          </span>
          <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border border-violet-500/40 bg-violet-500/10 text-violet-300">
            Earnings
          </span>
          {script && (
            <span
              className={`text-[10px] font-mono ${
                wcInTarget
                  ? "text-emerald-300"
                  : wcOk
                    ? "text-amber-300"
                    : "text-rose-300"
              }`}
            >
              {wc} words
            </span>
          )}
        </div>
        <a
          href={`/morning-brief?kind=earnings&week=${weekAnchor}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-sky-300 hover:underline"
        >
          Public page →
        </a>
      </div>

      {/* VIDEO + META */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        <div className="space-y-2">
          {videoUrl ? (
            <div className="rounded-md overflow-hidden border border-black/10 dark:border-white/10 bg-black">
              <video
                controls
                playsInline
                preload="metadata"
                poster={thumbnailUrl ?? undefined}
                src={videoUrl}
                className="w-full aspect-[9/16] object-cover"
              />
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-white/15 bg-white/[0.02] p-4 aspect-[9/16] flex items-center justify-center text-center text-xs text-white/45">
              {status === "generating"
                ? "Video rendering…"
                : status === "scripted"
                  ? "Script ready, video pending"
                  : "No video"}
            </div>
          )}
          {higgsfieldJobId && (
            <div className="text-[10px] font-mono text-black/45 dark:text-white/45 break-all">
              job: {higgsfieldJobId}
            </div>
          )}
        </div>

        <div className="space-y-3">
          {/* Phase-4a status notice: publish controls land next pass. */}
          <div className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-white/55 leading-relaxed">
            Weekly publish-to-YouTube and publish-to-TikTok controls are in the
            next pass. For now, preview the video and review the script —
            once the format is dialed in, approval + publish drop in here in
            the same shape as the daily card.
          </div>

          {script && (
            <details className="text-xs" open>
              <summary className="cursor-pointer text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white">
                Script
              </summary>
              <p className="mt-2 text-sm italic text-black/85 dark:text-white/85 leading-relaxed">
                &ldquo;{script}&rdquo;
              </p>
            </details>
          )}

          {settingPrompt && (
            <details className="text-xs">
              <summary className="cursor-pointer text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white">
                Scene prompt
              </summary>
              <p className="mt-2 text-xs font-mono text-black/55 dark:text-white/55">
                {settingPrompt}
              </p>
            </details>
          )}

          {errorLog.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-rose-400 hover:text-rose-300">
                {errorLog.length} error{errorLog.length === 1 ? "" : "s"} · show
              </summary>
              <ul className="mt-2 space-y-1 font-mono text-rose-300/80">
                {errorLog.map((e, i) => (
                  <li key={i}>
                    [{e.at}] {e.step}: {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </li>
  );
}
