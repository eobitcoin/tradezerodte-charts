/**
 * POST /api/admin/users/[id]/role
 *
 * Body: { role: "admin" | "user" }
 *
 * Changes a user's role. Cannot demote yourself (so you can't accidentally
 * lock the system out of admin access).
 *
 * Two safety steps live here that aren't obvious from the route name:
 *
 *   1. **Founding-admin opt-out**: if the target's email is on the
 *      `FOUNDING_ADMIN_EMAILS` allowlist, a plain role write would be silently
 *      reverted on their next login (see app/api/auth/login/route.ts). To make
 *      demotions of bootstrap accounts stick, we also flip `foundingAdminOptOut`
 *      on demote (true) / re-promote (false).
 *
 *   2. **Session invalidation**: we hard-revoke every active session for the
 *      target user. `getCurrentUser()` re-reads `role` from the DB on each
 *      request, so a stale session can't keep admin privileges — but
 *      invalidating sessions makes the change instantly visible (no waiting
 *      for the next page load) and matches what /disable and /extend do.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { deleteAllSessionsForUser, getCurrentAdmin } from "@/lib/auth";
import { countActiveAdmins, recordAdminAction } from "@/lib/admin";
import { isFoundingAdmin } from "@/lib/founding-admins";

export const runtime = "nodejs";

const Body = z.object({
  role: z.enum(["admin", "user"]),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;
  if (id === admin.id) {
    return NextResponse.json({ error: "cannot change your own role" }, { status: 400 });
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }

  const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!target) return NextResponse.json({ error: "user not found" }, { status: 404 });
  if (target.role === body.role) {
    return NextResponse.json({ error: `user is already ${body.role}` }, { status: 409 });
  }

  // Last-admin guard. If this demotion would leave the system with zero
  // currently-active admins, refuse. We only check on admin → user (the
  // direction that *removes* admin capability); promotions always pass.
  if (body.role === "user" && target.role === "admin") {
    const remaining = await countActiveAdmins();
    if (remaining <= 1) {
      return NextResponse.json(
        {
          error:
            "Refusing to demote the last active admin. Promote another user to admin first, then retry.",
        },
        { status: 409 },
      );
    }
  }

  // If the target is on the founding-admin allowlist, sync the opt-out flag
  // with the new role so the login-time bootstrap respects this decision:
  //   - demote (admin → user): set opt-out = true   (block re-promotion)
  //   - re-promote (user → admin): set opt-out = false (re-arm bootstrap)
  // For non-founding emails the flag is a no-op (login bootstrap doesn't
  // apply to them anyway), but we keep it deterministic.
  const founder = isFoundingAdmin(target.email);
  const nextOptOut = founder ? body.role === "user" : target.foundingAdminOptOut;

  const before = {
    role: target.role,
    foundingAdminOptOut: target.foundingAdminOptOut,
  };
  const after = {
    role: body.role,
    foundingAdminOptOut: nextOptOut,
  };

  await db.update(users).set(after).where(eq(users.id, id));

  // Force re-auth. Sessions live ~30 days; without this the demoted user keeps
  // a valid session cookie and, while they can no longer hit admin-only
  // endpoints (DB-fresh role check), they still appear "logged in" until
  // they bounce. Match /disable + /extend semantics for consistency.
  await deleteAllSessionsForUser(id);

  await recordAdminAction({
    actorUserId: admin.id,
    targetUserId: id,
    action: "set_role",
    before,
    after,
    note: founder
      ? body.role === "user"
        ? "Demoted founding-admin email — opt-out flag set so login bootstrap is suppressed."
        : "Re-promoted founding-admin email — opt-out flag cleared."
      : undefined,
  });

  return NextResponse.json({ ok: true });
}
