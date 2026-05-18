/**
 * PATCH /api/admin/users/[id]/profile
 *
 * Admin edits any user's profile, including admin-only notes that the user
 * themselves can't see.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";
import { recordAdminAction } from "@/lib/admin";

export const runtime = "nodejs";

const Body = z.object({
  displayName: z.string().max(100).nullable().optional(),
  fullName: z.string().max(200).nullable().optional(),
  timezone: z.string().max(80).nullable().optional(),
  adminNotes: z.string().max(2000).nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  let body;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }

  const existing = (
    await db.select().from(userProfiles).where(eq(userProfiles.userId, id)).limit(1)
  )[0];
  const before = existing ?? null;

  const updates = {
    ...body,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(userProfiles).set(updates).where(eq(userProfiles.userId, id));
  } else {
    await db.insert(userProfiles).values({ userId: id, ...body });
  }

  await recordAdminAction({
    actorUserId: admin.id,
    targetUserId: id,
    action: "update_profile",
    before: before ?? undefined,
    after: { ...(existing ?? {}), ...body },
  });

  return NextResponse.json({ ok: true });
}
