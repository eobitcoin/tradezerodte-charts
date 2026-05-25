import { NextResponse } from "next/server";
import { getObjectStream } from "@/lib/s3";
import { buildWeeklyEarningsVideoKey } from "@/lib/video-mux";

export const runtime = "nodejs";

/**
 * GET /api/weekly-briefings/video/YYYY-MM-DD — serves the final Weekly
 * Earnings Brief MP4 from the Railway bucket. PUBLIC (no auth) so the
 * embedded video player on the public /morning-brief/earnings page and
 * the YouTube/TikTok upload pipelines can reach it without login.
 *
 * Parallel to /api/briefings/video/[date]; weekly clips live under the
 * weekly-earnings-briefings bucket prefix.
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

  const obj = await getObjectStream(buildWeeklyEarningsVideoKey(date));
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
