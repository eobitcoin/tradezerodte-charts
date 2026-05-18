/**
 * DELETE /api/admin/users/[id]
 *
 * Permanently removes a user record from the database. Cascading FKs wipe
 * their sessions, verification tokens, profile row, and every admin_actions
 * row where they were the actor or target. This is the "scrub the record"
 * delete — for a soft alternative that preserves history, use disable.
 *
 * Guards:
 *   - Admin can't delete themselves.
 *   - Admin can't delete another admin (forces explicit demote-then-delete).
 *   - Body must include `{ confirm: <email> }` exactly matching the
 *     target's email, so a misclick can't nuke the wrong row.
 *
 * Note: there's no audit-log row for this action because the cascade would
 * wipe it along with the target. If we later need post-delete forensics we
 * can switch admin_actions.target_user_id to ON DELETE SET NULL and add a
 * "deleted_at"/"deleted_email" snapshot column.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";

export const runtime = "nodejs";

const Body = z.object({
  confirm: z.string().email(),
});

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  if (id === admin.id) {
    return NextResponse.json({ error: "cannot delete yourself" }, { status: 400 });
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "delete requires { confirm: <target email> }", detail: String(err) },
      { status: 400 },
    );
  }

  const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!target) return NextResponse.json({ error: "user not found" }, { status: 404 });

  // Refuse to delete other admins — admin must be demoted first. Prevents
  // accidental removal of the only other admin in a panic.
  if (target.role === "admin") {
    return NextResponse.json(
      { error: "demote this admin to user before deleting" },
      { status: 409 },
    );
  }

  // Confirmation must exactly match the email being deleted.
  if (body.confirm.toLowerCase() !== target.email.toLowerCase()) {
    return NextResponse.json(
      { error: "confirmation email does not match target" },
      { status: 400 },
    );
  }

  await db.delete(users).where(eq(users.id, id));

  return NextResponse.json({ ok: true, deletedEmail: target.email });
}
