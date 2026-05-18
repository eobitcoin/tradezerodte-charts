import { NextResponse } from "next/server";
import { getObjectStream } from "@/lib/s3";
import { buildBriefingVideoKey } from "@/lib/video-mux";

export const runtime = "nodejs";

/**
 * GET /api/briefings/video/YYYY-MM-DD — serves the final muxed briefing MP4
 * (Higgsfield video + our ElevenLabs audio overlaid via ffmpeg) from the
 * Railway bucket. PUBLIC (no auth) so the embedded video on the public
 * /briefings page and YouTube upload pipeline can reach it without login.
 *
 * Cache-Control: no-store — the same trading_day key gets overwritten if we
 * re-render. Stale browser/CDN caches would defeat the point.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const obj = await getObjectStream(buildBriefingVideoKey(date));
  if (!obj) return NextResponse.json({ error: "not found" }, { status: 404 });

  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": obj.contentType ?? "video/mp4",
      ...(obj.contentLength != null
        ? { "Content-Length": String(obj.contentLength) }
        : {}),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}
