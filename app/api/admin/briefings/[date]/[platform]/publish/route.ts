/**
 * POST /api/admin/briefings/[date]/[platform]/publish
 *
 * Admin "Publish Now" — immediately uploads the briefing video to the given
 * platform, synchronously. Unlike the scheduled cron path, the admin's click
 * IS the authorization, so the shared publish function is called with
 * `requireApproved: false` (idempotency on already-posted still applies).
 *
 * Platform: 'yt' (YouTube) or 'tt' (TikTok inbox/drafts).
 *
 * The YouTube upload runs ~10-25s (bucket download + Data API insert); TikTok
 * inbox is similar. Both are well within a normal request on our Node server.
 */
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import {
  publishBriefingToYouTube,
  publishBriefingToTikTok,
} from "@/lib/briefing-publish";

export const runtime = "nodejs";
// Generous ceiling — the upload itself is ~10-25s; this just prevents an
// overzealous platform timeout from cutting a slow YouTube insert short.
export const maxDuration = 120;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ date: string; platform: string }> },
) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { date, platform } = await params;
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  if (platform !== "yt" && platform !== "tt") {
    return NextResponse.json({ error: "invalid platform" }, { status: 400 });
  }

  const result =
    platform === "yt"
      ? await publishBriefingToYouTube(date, {
          privacy: "public",
          isShort: true,
          requireApproved: false,
        })
      : await publishBriefingToTikTok(date, { requireApproved: false });

  if (!result.ok) {
    // blocked = precondition (no video / no row); failed = upload threw.
    const status = result.status === "blocked" ? 409 : 502;
    return NextResponse.json(
      { error: result.error ?? "publish failed", status: result.status },
      { status },
    );
  }

  return NextResponse.json(result);
}
