/**
 * GET /api/botwick/tape/stream
 *
 * Server-Sent Events feed of new `bot_actions` rows. Used by the Matrix
 * tape on the user view so it updates in real time without F5.
 *
 * Auth: session cookie (same as the /botwick page). EventSource can't set
 * Authorization headers, so we ride on the existing user-session check.
 *
 * Wire format: standard SSE — `data: {json}\n\n` per row. Client uses the
 * default `onmessage` event. We also emit periodic `: keepalive\n\n`
 * comments so proxies / load balancers don't kill the idle connection.
 *
 * Cursor: `?since=ISO_TIMESTAMP` — the SSR'd page passes its newest
 * action's `ts` so we only stream what the client doesn't already have.
 * On reconnect, EventSource includes the same `since` (we don't yet bump
 * it on every event server-side because the client tracks its own cursor
 * by ignoring duplicate ids).
 *
 * Polling: every ~2.5s. With one or two viewers this is trivial; if we
 * end up with many we can swap for LISTEN/NOTIFY later.
 */

import { gt, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { botActions } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

const POLL_MS = 2500;
const KEEPALIVE_MS = 25_000;
// Hard cap so a forgotten browser tab doesn't keep a connection open forever.
// EventSource auto-reconnects; client just picks up where we left off.
const MAX_DURATION_MS = 10 * 60 * 1000;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("forbidden", { status: 403 });

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  let since: Date = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 60_000);
  if (Number.isNaN(since.getTime())) since = new Date(Date.now() - 60_000);

  const startedAt = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let cancelled = false;
      const close = () => {
        if (cancelled) return;
        cancelled = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", close);

      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cancelled = true;
        }
      };

      // Initial comment so the connection opens visibly on the client.
      send(`: connected ${new Date().toISOString()}\n\n`);

      let lastKeepalive = Date.now();

      while (!cancelled) {
        if (Date.now() - startedAt > MAX_DURATION_MS) {
          // Soft-close. EventSource will auto-reconnect; the client passes
          // the latest seen `ts` so we resume cleanly.
          send(`event: closing\ndata: {"reason":"max_duration"}\n\n`);
          break;
        }

        try {
          const rows = await db
            .select()
            .from(botActions)
            .where(gt(botActions.ts, since))
            .orderBy(asc(botActions.ts))
            .limit(100);

          for (const row of rows) {
            send(`data: ${JSON.stringify(row)}\n\n`);
            since = row.ts;
          }
        } catch (e) {
          // Log + surface to client so they know something's off.
          send(
            `event: error\ndata: ${JSON.stringify({ message: String(e).slice(0, 200) })}\n\n`,
          );
        }

        if (Date.now() - lastKeepalive > KEEPALIVE_MS) {
          send(`: keepalive\n\n`);
          lastKeepalive = Date.now();
        }

        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Some platforms buffer responses; this hints "stream me".
      "X-Accel-Buffering": "no",
    },
  });
}
