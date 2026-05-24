/**
 * POST /api/admin/weekly-briefings/[anchor]/[platform]
 *
 * Admin approval workflow for Weekly Earnings Brief videos. Parallel to
 * /api/admin/briefings/[date]/[platform] (daily) — same actions, same state
 * transitions, different table (`weeklyEarningsBriefings`) and different
 * natural key (`weekAnchor` rather than `tradingDay`).
 *
 * Actions:
 *   - approve         → status 'approved'; optionally saves edited title/caption
 *   - reject          → status 'failed'; saves `reason` to `<platform>Error`
 *   - skip            → status 'skipped' (posting routine will never touch it)
 *   - reset           → status 'pending_review'; clears error
 *   - update_caption  → no state change, just persists edited title/caption
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  weeklyEarningsBriefings,
  type PlatformPublishStatus,
} from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const Body = z.object({
  action: z.enum(["approve", "reject", "skip", "reset", "update_caption"]),
  title: z.string().trim().max(100).optional(),
  caption: z.string().trim().max(5000).optional(),
  reason: z.string().trim().max(500).optional(),
});

type PlatformKey = "yt" | "tt";

interface PlatformCols {
  statusCol: "ytStatus" | "ttStatus";
  titleCol: "ytTitle" | null;
  captionCol: "ytCaption" | "ttCaption";
  errorCol: "ytError" | "ttError";
}

function colsFor(platform: PlatformKey): PlatformCols {
  if (platform === "yt") {
    return {
      statusCol: "ytStatus",
      titleCol: "ytTitle",
      captionCol: "ytCaption",
      errorCol: "ytError",
    };
  }
  return {
    statusCol: "ttStatus",
    titleCol: null,
    captionCol: "ttCaption",
    errorCol: "ttError",
  };
}

export async function POST(
  req: Request,
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

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { action, title, caption, reason } = parsed.data;

  const row = (
    await db
      .select()
      .from(weeklyEarningsBriefings)
      .where(eq(weeklyEarningsBriefings.weekAnchor, anchor))
      .limit(1)
  )[0];
  if (!row) {
    return NextResponse.json({ error: "weekly brief not found" }, { status: 404 });
  }
  if (!row.videoS3Key) {
    return NextResponse.json(
      { error: "video not yet rendered for this week" },
      { status: 409 },
    );
  }

  const cols = colsFor(platform);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = { updatedAt: new Date() };

  switch (action) {
    case "approve": {
      update[cols.statusCol] = "approved" satisfies PlatformPublishStatus;
      update[cols.errorCol] = null;
      if (typeof caption === "string") update[cols.captionCol] = caption;
      if (platform === "yt" && typeof title === "string") update.ytTitle = title;
      break;
    }
    case "reject": {
      update[cols.statusCol] = "failed" satisfies PlatformPublishStatus;
      update[cols.errorCol] = reason || "rejected by admin";
      break;
    }
    case "skip": {
      update[cols.statusCol] = "skipped" satisfies PlatformPublishStatus;
      update[cols.errorCol] = null;
      break;
    }
    case "reset": {
      update[cols.statusCol] = "pending_review" satisfies PlatformPublishStatus;
      update[cols.errorCol] = null;
      break;
    }
    case "update_caption": {
      if (typeof caption === "string") update[cols.captionCol] = caption;
      if (platform === "yt" && typeof title === "string") update.ytTitle = title;
      break;
    }
  }

  await db
    .update(weeklyEarningsBriefings)
    .set(update)
    .where(eq(weeklyEarningsBriefings.weekAnchor, anchor));

  return NextResponse.json({ ok: true, action, platform, weekAnchor: anchor });
}
