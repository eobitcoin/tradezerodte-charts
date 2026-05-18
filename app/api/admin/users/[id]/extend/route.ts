/**
 * POST /api/admin/users/[id]/extend
 *
 * Body: { accessExpiresAt: ISO-string | null }
 *
 * Sets a new expiry date (or removes expiry). Does NOT change status — use
 * approve/enable for status transitions. If the new expiry is in the past,
 * the next request from this user will eject them via evaluateAccess().
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentAdmin, deleteAllSessionsForUser } from "@/lib/auth";
import { recordAdminAction } from "@/lib/admin";

export const runtime = "nodejs";

const Body = z.object({
  accessExpiresAt: z.union([z.string().datetime(), z.null()]),
});

export async function POST(
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

  const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!target) return NextResponse.json({ error: "user not found" }, { status: 404 });

  const expiresAt = body.accessExpiresAt === null ? null : new Date(body.accessExpiresAt);
  const before = { accessExpiresAt: target.accessExpiresAt };
  const after = { accessExpiresAt: expiresAt };

  await db.update(users).set(after).where(eq(users.id, id));

  // If the new expiry is in the past, kick them out now.
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    await deleteAllSessionsForUser(id);
  }

  await recordAdminAction({
    actorUserId: admin.id,
    targetUserId: id,
    action: "extend_access",
    before,
    after,
  });

  return NextResponse.json({ ok: true });
}
