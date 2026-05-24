import type {
  BriefingErrorEvent,
  BriefingStatus,
  PlatformPublishStatus,
} from "@/lib/db/schema";
import BriefingPlatformPanel from "@/components/BriefingPlatformPanel";

interface BriefingCardProps {
  tradingDay: string;
  status: BriefingStatus;
  script: string | null;
  settingPrompt: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  higgsfieldJobId: string | null;
  youtubeVideoId: string | null;
  errorLog: BriefingErrorEvent[];
  yt: {
    status: PlatformPublishStatus | null;
    title: string | null;
    caption: string | null;
    postedAt: string | null;
    error: string | null;
  };
  tt: {
    status: PlatformPublishStatus | null;
    caption: string | null;
    publishId: string | null;
    postedAt: string | null;
    error: string | null;
  };
  /** Server-computed default copy for empty fields. */
  defaults: {
    ytTitle: string;
    ytCaption: string;
    ttCaption: string;
  };
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

function fmtDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function AdminBriefingCard(props: BriefingCardProps) {
  const {
    tradingDay,
    status,
    script,
    settingPrompt,
    videoUrl,
    thumbnailUrl,
    higgsfieldJobId,
    youtubeVideoId,
    errorLog,
    yt,
    tt,
    defaults,
  } = props;

  const wc = wordCount(script);
  const wcOk = wc >= 30 && wc <= 45;
  const videoReady = !!videoUrl;

  return (
    <li className="rounded-lg border border-black/10 dark:border-white/10 bg-white/[0.02] p-4 space-y-4">
      {/* HEADER */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="font-mono text-xs text-black/55 dark:text-white/55">
            {tradingDay}
          </span>
          <span className="text-sm font-semibold tracking-tight">
            {fmtDate(tradingDay)}
          </span>
          <span
            className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${statusTone(status)}`}
          >
            {status}
          </span>
          {script && (
            <span
              className={`text-[10px] font-mono ${wcOk ? "text-emerald-300" : "text-amber-300"}`}
            >
              {wc} words
            </span>
          )}
        </div>
        <a
          href={`/morning-brief/${tradingDay}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-sky-300 hover:underline"
        >
          Public page →
        </a>
      </div>

      {/* MAIN GRID: video preview + per-platform panels */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* VIDEO PREVIEW */}
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
          {(higgsfieldJobId || youtubeVideoId) && (
            <div className="text-[10px] font-mono text-black/45 dark:text-white/45 space-y-0.5 break-all">
              {higgsfieldJobId && <div>job: {higgsfieldJobId}</div>}
              {youtubeVideoId && (
                <div>
                  yt:{" "}
                  <a
                    href={`https://www.youtube.com/watch?v=${youtubeVideoId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-300 hover:underline"
                  >
                    {youtubeVideoId}
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* PLATFORM PANELS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BriefingPlatformPanel
            platform="yt"
            rowKey={tradingDay}
            apiBasePath="/api/admin/briefings"
            videoReady={videoReady}
            label="YouTube"
            currentStatus={yt.status}
            currentTitle={yt.title}
            currentCaption={yt.caption}
            postedAt={yt.postedAt}
            error={yt.error}
            defaultTitle={defaults.ytTitle}
            defaultCaption={defaults.ytCaption}
            postedHref={
              youtubeVideoId ? `https://www.youtube.com/watch?v=${youtubeVideoId}` : null
            }
          />
          <BriefingPlatformPanel
            platform="tt"
            rowKey={tradingDay}
            apiBasePath="/api/admin/briefings"
            videoReady={videoReady}
            label="TikTok"
            currentStatus={tt.status}
            currentTitle={null}
            currentCaption={tt.caption}
            postedAt={tt.postedAt}
            error={tt.error}
            defaultTitle={null}
            defaultCaption={defaults.ttCaption}
            postedHref={
              tt.publishId ? `https://www.tiktok.com/upload?lang=en` : null
            }
          />
        </div>
      </div>

      {/* SCRIPT + SETTING (collapsed) */}
      {(script || settingPrompt) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white">
            Script + scene prompt
          </summary>
          <div className="mt-2 space-y-2">
            {script && (
              <p className="text-sm italic text-black/85 dark:text-white/85 leading-relaxed">
                &ldquo;{script}&rdquo;
              </p>
            )}
            {settingPrompt && (
              <p className="text-xs font-mono text-black/55 dark:text-white/55">
                {settingPrompt}
              </p>
            )}
          </div>
        </details>
      )}

      {/* ERROR LOG */}
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

      {/* META FOOTNOTE */}
      <div className="text-[10px] text-black/40 dark:text-white/40 flex gap-3 flex-wrap">
        {yt.postedAt && <span>YT posted {fmtRelative(yt.postedAt)}</span>}
        {tt.postedAt && <span>TT posted {fmtRelative(tt.postedAt)}</span>}
      </div>
    </li>
  );
}
