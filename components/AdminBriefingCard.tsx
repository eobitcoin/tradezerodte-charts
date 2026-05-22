"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type {
  BriefingErrorEvent,
  BriefingStatus,
  PlatformPublishStatus,
} from "@/lib/db/schema";

type PlatformKey = "yt" | "tt";

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

function platformTone(status: PlatformPublishStatus | null): string {
  switch (status) {
    case "approved":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "posting":
      return "border-sky-500/40 bg-sky-500/10 text-sky-300";
    case "posted":
      return "border-emerald-600/40 bg-emerald-600/15 text-emerald-200";
    case "failed":
      return "border-rose-500/40 bg-rose-500/10 text-rose-300";
    case "skipped":
      return "border-white/15 bg-white/[0.04] text-white/55";
    case "pending_review":
    default:
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
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

/**
 * Human label for an action in either its in-progress or past-tense form.
 * Used to drive the button busy state and the post-action success badge.
 */
function actionLabel(action: string, tense: "in_progress" | "past"): string {
  const map: Record<string, [string, string]> = {
    approve: ["Approving…", "Approved"],
    reject: ["Rejecting…", "Rejected"],
    skip: ["Skipping…", "Skipped"],
    reset: ["Resetting…", "Reset"],
    update_caption: ["Saving…", "Saved"],
    publish: ["Publishing…", "Published"],
  };
  const pair = map[action];
  if (!pair) return tense === "in_progress" ? "Working…" : "Done";
  return tense === "in_progress" ? pair[0] : pair[1];
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
          <PlatformPanel
            platform="yt"
            tradingDay={tradingDay}
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
          <PlatformPanel
            platform="tt"
            tradingDay={tradingDay}
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

// ---------------------------------------------------------------------------

interface PlatformPanelProps {
  platform: PlatformKey;
  tradingDay: string;
  videoReady: boolean;
  label: string;
  currentStatus: PlatformPublishStatus | null;
  currentTitle: string | null;
  currentCaption: string | null;
  postedAt: string | null;
  error: string | null;
  defaultTitle: string | null;
  defaultCaption: string | null;
  postedHref: string | null;
}

function PlatformPanel(props: PlatformPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [title, setTitle] = useState<string>(
    props.currentTitle ?? props.defaultTitle ?? "",
  );
  const [caption, setCaption] = useState<string>(
    props.currentCaption ?? props.defaultCaption ?? "",
  );

  // Auto-clear the success badge after 3s.
  useEffect(() => {
    if (!lastSuccess) return;
    successTimer.current = setTimeout(() => setLastSuccess(null), 3000);
    return () => {
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, [lastSuccess]);

  const isDisabled = !props.videoReady || pending;
  const isLocked =
    props.currentStatus === "posting" || props.currentStatus === "posted";

  async function call(action: string, body: Record<string, unknown> = {}): Promise<void> {
    setServerError(null);
    setActiveAction(action);
    setLastSuccess(null);
    try {
      const res = await fetch(
        `/api/admin/briefings/${props.tradingDay}/${props.platform}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...body }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setServerError(j.error || `HTTP ${res.status}`);
        return;
      }
      // Capture the success label BEFORE refresh so it survives the rerender.
      setLastSuccess(actionLabel(action, "past"));
      router.refresh();
    } finally {
      setActiveAction(null);
    }
  }

  function onApprove() {
    startTransition(() => {
      const body: Record<string, unknown> = { caption };
      if (props.platform === "yt" && title) body.title = title;
      void call("approve", body);
    });
  }
  function onReject() {
    const reason = prompt("Reason for rejection (optional):") ?? "";
    startTransition(() => {
      void call("reject", { reason });
    });
  }
  function onSkip() {
    if (!confirm(`Skip ${props.label} for ${props.tradingDay}? It will never post.`))
      return;
    startTransition(() => {
      void call("skip");
    });
  }
  function onReset() {
    startTransition(() => {
      void call("reset");
    });
  }
  function onSaveCaption() {
    startTransition(() => {
      const body: Record<string, unknown> = { caption };
      if (props.platform === "yt" && title) body.title = title;
      void call("update_caption", body);
    });
  }
  // "Publish Now" — hits a separate endpoint that uploads immediately, with
  // requireApproved=false (the click is the authorization). Save any caption
  // edits first so the upload uses the latest copy.
  function onPublishNow() {
    const verb =
      props.platform === "yt"
        ? "Publish to YouTube now (public)"
        : "Push to TikTok drafts now";
    if (!confirm(`${verb} for ${props.tradingDay}?\n\nThis uploads the video immediately.`))
      return;
    startTransition(() => {
      void (async () => {
        setServerError(null);
        setActiveAction("publish");
        setLastSuccess(null);
        try {
          // Persist caption/title edits before the upload reads them.
          const body: Record<string, unknown> = { caption };
          if (props.platform === "yt" && title) body.title = title;
          await fetch(`/api/admin/briefings/${props.tradingDay}/${props.platform}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "update_caption", ...body }),
          }).catch(() => undefined);

          const res = await fetch(
            `/api/admin/briefings/${props.tradingDay}/${props.platform}/publish`,
            { method: "POST" },
          );
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            setServerError(j.error || `HTTP ${res.status}`);
            return;
          }
          setLastSuccess("Published");
          router.refresh();
        } finally {
          setActiveAction(null);
        }
      })();
    });
  }

  const busyLabel = (defaultLabel: string, forAction: string): string =>
    pending && activeAction === forAction
      ? actionLabel(forAction, "in_progress")
      : defaultLabel;

  return (
    <div className="rounded-md border border-black/10 dark:border-white/10 bg-white/[0.015] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs font-semibold tracking-tight">{props.label}</span>
          <span
            className={`text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border ${platformTone(props.currentStatus)}`}
          >
            {props.currentStatus ?? "not_ready"}
          </span>
          {lastSuccess && (
            <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 animate-pulse">
              ✓ {lastSuccess}
            </span>
          )}
        </div>
        {props.postedHref && props.currentStatus === "posted" && (
          <a
            href={props.postedHref}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-emerald-300 hover:underline"
          >
            view →
          </a>
        )}
      </div>

      {props.platform === "yt" && (
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45">
            Title
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isDisabled || isLocked}
            maxLength={100}
            className="w-full mt-0.5 px-2 py-1 text-xs rounded border border-black/10 dark:border-white/10 bg-black/20 text-white placeholder:text-white/30 disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder={props.defaultTitle ?? ""}
          />
          <span className="text-[9px] text-black/40 dark:text-white/40 font-mono">
            {title.length}/100
          </span>
        </label>
      )}

      <label className="block">
        <span className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45">
          {props.platform === "yt" ? "Description" : "Caption"}
        </span>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          disabled={isDisabled || isLocked}
          rows={4}
          maxLength={props.platform === "yt" ? 5000 : 2200}
          className="w-full mt-0.5 px-2 py-1 text-xs rounded border border-black/10 dark:border-white/10 bg-black/20 text-white placeholder:text-white/30 disabled:opacity-50 disabled:cursor-not-allowed font-mono leading-relaxed"
          placeholder={props.defaultCaption ?? ""}
        />
        <span className="text-[9px] text-black/40 dark:text-white/40 font-mono">
          {caption.length}/{props.platform === "yt" ? 5000 : 2200}
        </span>
      </label>

      {props.error && (
        <div className="text-[10px] text-rose-300 font-mono break-words">
          {props.error}
        </div>
      )}
      {serverError && (
        <div className="text-[10px] text-rose-300 font-mono">{serverError}</div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {!isLocked && (
          <>
            <button
              type="button"
              onClick={onApprove}
              disabled={isDisabled}
              className="px-2.5 py-1 text-[10px] uppercase tracking-widest font-bold rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busyLabel("Approve", "approve")}
            </button>
            <button
              type="button"
              onClick={onSaveCaption}
              disabled={isDisabled}
              className="px-2.5 py-1 text-[10px] uppercase tracking-widest font-bold rounded border border-white/15 hover:border-white/30 hover:bg-white/[0.04] text-white/75 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busyLabel("Save", "update_caption")}
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={isDisabled}
              className="px-2.5 py-1 text-[10px] uppercase tracking-widest font-bold rounded border border-rose-500/40 hover:bg-rose-500/10 text-rose-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busyLabel("Reject", "reject")}
            </button>
            <button
              type="button"
              onClick={onSkip}
              disabled={isDisabled}
              className="px-2.5 py-1 text-[10px] uppercase tracking-widest font-bold rounded border border-white/15 hover:border-white/30 hover:bg-white/[0.04] text-white/55 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busyLabel("Skip", "skip")}
            </button>
          </>
        )}
        {(props.currentStatus === "failed" ||
          props.currentStatus === "skipped" ||
          props.currentStatus === "approved") && (
          <button
            type="button"
            onClick={onReset}
            disabled={pending}
            className="px-2.5 py-1 text-[10px] uppercase tracking-widest font-bold rounded border border-amber-500/40 hover:bg-amber-500/10 text-amber-300 disabled:opacity-40 transition-colors"
          >
            {busyLabel("Reset", "reset")}
          </button>
        )}
      </div>

      {/* PUBLISH NOW — uploads immediately. Hidden once posting/posted. */}
      {!isLocked && (
        <button
          type="button"
          onClick={onPublishNow}
          disabled={isDisabled}
          className="w-full px-3 py-2 text-[10px] uppercase tracking-widest font-bold rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busyLabel(
            props.platform === "yt" ? "▶ Publish to YouTube now" : "▶ Push to TikTok now",
            "publish",
          )}
        </button>
      )}
      {props.currentStatus === "posting" && (
        <div className="text-[10px] text-sky-300 text-center py-1 animate-pulse">
          Uploading…
        </div>
      )}
    </div>
  );
}
