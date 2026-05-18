"use client";

/**
 * BotWick live tape — Server-Sent Events subscriber.
 *
 * Initial render is server-supplied (so the page has content immediately
 * with no JS), and the EventSource layer pushes any new bot_actions rows
 * on top of that as they're written. We dedupe by id so a reconnect that
 * replays from an older cursor can't double-list events.
 */

import { useEffect, useRef, useState } from "react";

const SEVERITY_COLOR: Record<string, string> = {
  info: "text-emerald-400/80",
  success: "text-emerald-300",
  warn: "text-amber-300",
  error: "text-rose-400",
};

type Action = {
  id: string;
  ts: string | Date;
  kind: string;
  severity: string;
  message: string;
  tradeId?: string | null;
  data?: Record<string, unknown> | null;
};

type Props = {
  initial: Action[];
  /** ISO timestamp of the newest event in `initial`, or null if empty. */
  sinceIso: string | null;
  /** Max events to keep in the list. */
  cap?: number;
};

function fmtTime(ts: Date | string): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function BotWickTapeStream({ initial, sinceIso, cap = 200 }: Props) {
  const [events, setEvents] = useState<Action[]>(initial);
  const [status, setStatus] = useState<"connecting" | "open" | "error">("connecting");
  // We track our own "newest seen" cursor so reconnects pick up after the
  // last delivered event, not the original page-load cursor.
  const cursorRef = useRef<string | null>(sinceIso);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function connect() {
      if (stopped) return;
      const qs = cursorRef.current
        ? `?since=${encodeURIComponent(cursorRef.current)}`
        : "";
      es = new EventSource(`/api/botwick/tape/stream${qs}`);

      es.addEventListener("open", () => setStatus("open"));

      es.addEventListener("message", (e: MessageEvent) => {
        try {
          const row = JSON.parse((e as MessageEvent).data) as Action;
          cursorRef.current = String(row.ts);
          setEvents((prev) => {
            if (prev.some((p) => p.id === row.id)) return prev;
            return [row, ...prev].slice(0, cap);
          });
        } catch {
          /* skip malformed line */
        }
      });

      // Server soft-closes after MAX_DURATION; reconnect immediately rather
      // than waiting for the browser's default 3-second backoff.
      es.addEventListener("closing", () => {
        es?.close();
        if (!stopped) setTimeout(connect, 200);
      });

      es.addEventListener("error", () => {
        setStatus("error");
        // EventSource auto-reconnects, but if the server closed cleanly the
        // browser sometimes goes into a permanent CLOSED state. Belt + suspenders.
        if (es?.readyState === EventSource.CLOSED && !stopped) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      });
    }

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [cap]);

  const dotColor =
    status === "open" ? "bg-emerald-500 animate-pulse" : status === "error" ? "bg-rose-500" : "bg-zinc-500";

  return (
    <section className="rounded-lg border border-emerald-500/20 bg-black/90 p-4 min-h-[18rem]">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-[0.25em] text-emerald-500/70">
          ▸ Live tape
        </h2>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-emerald-500/60">
          <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden="true" />
          {status === "open" ? "live" : status === "error" ? "reconnecting" : "connecting"}
        </span>
      </header>

      {events.length === 0 ? (
        <p className="text-sm text-emerald-500/50 italic">
          {`// tape is idle — bot has not emitted any events yet`}
        </p>
      ) : (
        <ol className="space-y-1 text-[12px] leading-relaxed max-h-[28rem] overflow-y-auto pr-1 font-mono">
          {events.map((a) => {
            const color = SEVERITY_COLOR[a.severity] ?? "text-emerald-400/80";
            return (
              <li key={a.id} className="flex gap-3">
                <span className="text-emerald-600/70 shrink-0 w-16">{fmtTime(a.ts)}</span>
                <span className="text-emerald-500/50 shrink-0 w-28 uppercase">{a.kind}</span>
                <span className={`${color} break-words`}>{a.message}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
