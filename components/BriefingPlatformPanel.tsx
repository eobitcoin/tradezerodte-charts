"use client";

/**
 * Shared YouTube/TikTok per-platform panel for the admin briefing cards.
 *
 * Used by both:
 *   - AdminBriefingCard         → daily 0DTE brief (apiBasePath="/api/admin/briefings")
 *   - AdminWeeklyEarningsCard   → Sunday earnings brief (apiBasePath="/api/admin/weekly-briefings")
 *
 * The panel itself is identical for both — same actions (approve/reject/skip/reset/
 * update_caption + Publish Now), same UI. The only thing that changes is the
 * URL path and which natural key (tradingDay vs weekAnchor) is interpolated.
 *
 * The wrapping route file is responsible for routing the click to the correct
 * publish orchestrator (lib/briefing-publish.ts vs lib/weekly-earnings-publish.ts).
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { PlatformPublishStatus } from "@/lib/db/schema";

export type BriefingPlatformKey = "yt" | "tt";

interface PlatformPanelProps {
  platform: BriefingPlatformKey;
  /** Natural key for the row (tradingDay for daily, weekAnchor for weekly).
   *  Interpolated into apiBasePath at click time. */
  rowKey: string;
  /** Without trailing slash, e.g. "/api/admin/briefings" or
   *  "/api/admin/weekly-briefings". The panel POSTs to
   *  `{apiBasePath}/{rowKey}/{platform}` for action calls and
   *  `{apiBasePath}/{rowKey}/{platform}/publish` for Publish Now. */
  apiBasePath: string;
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

export default function BriefingPlatformPanel(props: PlatformPanelProps) {
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
        `${props.apiBasePath}/${props.rowKey}/${props.platform}`,
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
    if (!confirm(`Skip ${props.label} for ${props.rowKey}? It will never post.`))
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
  function onPublishNow() {
    const verb =
      props.platform === "yt"
        ? "Publish to YouTube now (public)"
        : "Push to TikTok drafts now";
    if (!confirm(`${verb} for ${props.rowKey}?\n\nThis uploads the video immediately.`))
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
          await fetch(
            `${props.apiBasePath}/${props.rowKey}/${props.platform}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "update_caption", ...body }),
            },
          ).catch(() => undefined);

          const res = await fetch(
            `${props.apiBasePath}/${props.rowKey}/${props.platform}/publish`,
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
