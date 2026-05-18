import { NextResponse } from "next/server";
import { getObjectStream } from "@/lib/s3";
import { buildBriefingAudioKey } from "@/lib/elevenlabs";

export const runtime = "nodejs";

/**
 * GET /api/briefings/audio/YYYY-MM-DD — serves the briefing's voiceover MP3
 * from the Railway bucket. PUBLIC (no authentication) so Higgsfield can fetch
 * the URL when we hand it to `generate_video` as the `audio` media reference.
 *
 * Security model: the audio file is the voiceover for a YouTube Shorts video
 * we publish to the public channel daily. It is not sensitive content. The
 * URL is deterministic (one per trading_day), so anyone with the date can
 * fetch — that's intentional. The corresponding video on YouTube will be
 * public anyway.
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

  const obj = await getObjectStream(buildBriefingAudioKey(date));
  if (!obj) return NextResponse.json({ error: "not found" }, { status: 404 });

  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": obj.contentType ?? "audio/mpeg",
      ...(obj.contentLength != null
        ? { "Content-Length": String(obj.contentLength) }
        : {}),
      // The audio file at this URL is regenerated whenever the briefing's
      // script changes (same key in the bucket). Using `no-store` so the
      // admin player + any caller always sees the freshest bytes — otherwise
      // browsers/CDNs serve a stale copy for up to 24h after the first hit.
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}
