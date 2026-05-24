import { NextResponse } from "next/server";
import { getObjectStream } from "@/lib/s3";
import { buildWeeklyEarningsAudioKey } from "@/lib/elevenlabs";

export const runtime = "nodejs";

/**
 * GET /api/weekly-briefings/audio/YYYY-MM-DD — serves a Weekly Earnings
 * Brief's voiceover MP3 from the Railway bucket. PUBLIC (no auth) so Hedra
 * can fetch the URL when we hand it to the lip-sync generation.
 *
 * Parallel to /api/briefings/audio/[date] but pulls from the separate
 * weekly-earnings-briefings bucket prefix so daily and weekly never collide.
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

  const obj = await getObjectStream(buildWeeklyEarningsAudioKey(date));
  if (!obj) return NextResponse.json({ error: "not found" }, { status: 404 });

  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": obj.contentType ?? "audio/mpeg",
      ...(obj.contentLength != null
        ? { "Content-Length": String(obj.contentLength) }
        : {}),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}
