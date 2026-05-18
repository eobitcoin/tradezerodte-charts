/**
 * POST /api/admin/users/[id]/disable
 *
 * Body: { reason?: string }
 *
 * Sets status='disabled', deletes all sessions for the target so they're
 * kicked out immediately, and emails them.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentAdmin, deleteAllSessionsForUser } from "@/lib/auth";
import { countActiveAdmins, recordAdminAction } from "@/lib/admin";
import { sendDisabledEmail } from "@/lib/email";

export const runtime = "nodejs";

const Body = z.object({
  reason: z.string().max(500).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  if (id === admin.id) {
    return NextResponse.json({ error: "cannot disable yourself" }, { status: 400 });
  }

  let body: z.infer<typeof Body> = {};
  try {
    if (req.headers.get("content-length") && Number(req.headers.get("content-length")) > 0) {
      body = Body.parse(await req.json());
    }
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }

  const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!target) return NextResponse.json({ error: "user not found" }, { status: 404 });
  if (target.status === "disabled") {
    return NextResponse.json({ error: "user is already disabled" }, { status: 409 });
  }

  // Last-admin guard. Disabling an active admin removes admin capability the
  // same way demoting them does, so we apply the same floor: never let the
  // count of currently-active admins drop to zero. Skip the check entirely if
  // the target isn't an admin or isn't currently active.
  if (target.role === "admin" && target.status === "active") {
    const remaining = await countActiveAdmins();
    if (remaining <= 1) {
      return NextResponse.json(
        {
          error:
            "Refusing to disable the last active admin. Promote another user to admin first, then retry.",
        },
        { status: 409 },
      );
    }
  }

  const before = {
    status: target.status,
    disabledAt: target.disabledAt,
    disabledReason: target.disabledReason,
  };
  const after = {
    status: "disabled" as const,
    disabledAt: new Date(),
    disabledReason: body.reason ?? null,
  };

  await db.update(users).set(after).where(eq(users.id, id));
  // Hard-revoke active sessions so the user is logged out on their next request.
  await deleteAllSessionsForUser(id);

  await recordAdminAction({
    actorUserId: admin.id,
    targetUserId: id,
    action: "disable",
    before,
    after,
    note: body.reason ?? undefined,
  });

  void sendDisabledEmail({ to: target.email, reason: body.reason ?? null });

  return NextResponse.json({ ok: true });
}
