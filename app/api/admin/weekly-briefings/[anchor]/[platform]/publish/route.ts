/**
 * POST /api/admin/weekly-briefings/[anchor]/[platform]/publish
 *
 * Admin "Publish Now" for a Weekly Earnings Brief — synchronous upload to the
 * given platform. Parallel to the daily version under /api/admin/briefings.
 *
 * The admin's click IS the authorization (`requireApproved: false`); the
 * shared idempotency check on already-posted still applies.
 */
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import {
  publishWeeklyEarningsToYouTube,
  publishWeeklyEarningsToTikTok,
} from "@/lib/weekly-earnings-publish";

export const runtime = "nodejs";
// Generous ceiling — the upload runs ~10-25s; this just prevents an
// overzealous platform timeout from cutting a slow YouTube insert short.
export const maxDuration = 120;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ anchor: string; platform: string }> },
) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { anchor, platform } = await params;
  if (!DATE_RE.test(anchor)) {
    return NextResponse.json({ error: "invalid week anchor" }, { status: 400 });
  }
  if (platform !== "yt" && platform !== "tt") {
    return NextResponse.json({ error: "invalid platform" }, { status: 400 });
  }

  const result =
    platform === "yt"
      ? await publishWeeklyEarningsToYouTube(anchor, {
          privacy: "public",
          isShort: true,
          requireApproved: false,
        })
      : await publishWeeklyEarningsToTikTok(anchor, { requireApproved: false });

  if (!result.ok) {
    const status = result.status === "blocked" ? 409 : 502;
    return NextResponse.json(
      { error: result.error ?? "publish failed", status: result.status },
      { status },
    );
  }

  return NextResponse.json(result);
}
