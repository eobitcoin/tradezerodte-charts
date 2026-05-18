/**
 * POST /api/admin/users/[id]/enable
 *
 * Re-activates a previously disabled user. Status returns to 'active' and
 * the disabledAt/disabledReason are cleared. Does not change accessExpiresAt.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";
import { recordAdminAction } from "@/lib/admin";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!target) return NextResponse.json({ error: "user not found" }, { status: 404 });
  if (target.status === "active") {
    return NextResponse.json({ error: "user is already active" }, { status: 409 });
  }

  const before = {
    status: target.status,
    disabledAt: target.disabledAt,
    disabledReason: target.disabledReason,
  };
  const after = {
    status: "active" as const,
    disabledAt: null,
    disabledReason: null,
  };

  await db.update(users).set(after).where(eq(users.id, id));
  await recordAdminAction({
    actorUserId: admin.id,
    targetUserId: id,
    action: "enable",
    before,
    after,
  });

  return NextResponse.json({ ok: true });
}
