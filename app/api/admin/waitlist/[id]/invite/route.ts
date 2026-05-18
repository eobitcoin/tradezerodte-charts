/**
 * POST /api/admin/waitlist/[id]/invite
 *
 * Admin converts a waitlist signup into a real user account, sends them an
 * "invitation" email with a password-reset link so they can set their own
 * password and sign in.
 *
 * Body: { accessExpiresAt: ISO | null | "default" }   // same shape as approve
 *
 * What happens:
 *   1. Verify waitlist row exists + status = 'pending'.
 *   2. Verify no `users` row already exists for that email.
 *   3. Create `users` row: status='active', email_verified=true, role='user',
 *      accessExpiresAt set per the request.
 *   4. Create empty `user_profiles` row (full_name from waitlist).
 *   5. Mint a password-reset token (1h TTL — same as existing reset flow).
 *   6. Send "you're invited" email with link to /reset-password?token=...
 *   7. Update waitlist row: status='invited', invited_at, invited_by, user_id.
 *   8. Record an admin action audit log entry.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, userProfiles, waitlistSignups } from "@/lib/db/schema";
import {
  getCurrentAdmin,
  generateId,
  createPasswordResetToken,
} from "@/lib/auth";
import { recordAdminAction, defaultAccessExpiry } from "@/lib/admin";
import { sendWaitlistInvitation } from "@/lib/email";

export const runtime = "nodejs";

const Body = z.object({
  accessExpiresAt: z.union([
    z.string().datetime(),
    z.literal("default"),
    z.null(),
  ]),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  let body;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }

  const [entry] = await db
    .select()
    .from(waitlistSignups)
    .where(eq(waitlistSignups.id, id))
    .limit(1);
  if (!entry) return NextResponse.json({ error: "waitlist entry not found" }, { status: 404 });
  if (entry.status !== "pending") {
    return NextResponse.json(
      { error: `waitlist entry is already ${entry.status}` },
      { status: 409 },
    );
  }

  // Conflict guard: don't double-create users if someone already signed up
  // via the normal path with the same email.
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, entry.email))
    .limit(1);
  if (existingUser) {
    return NextResponse.json(
      {
        error: `a user account already exists for ${entry.email}; manage them via /admin/users instead`,
      },
      { status: 409 },
    );
  }

  const accessExpiresAt =
    body.accessExpiresAt === null
      ? null
      : body.accessExpiresAt === "default"
        ? defaultAccessExpiry()
        : new Date(body.accessExpiresAt);

  const now = new Date();
  const userId = generateId(16);

  // We don't know the user's password yet — they'll set it via the reset
  // link. Store a placeholder that nobody can authenticate against.
  const placeholderPasswordHash = `scrypt$${Buffer.from("invited-pending").toString("hex")}$${Buffer.from("invited-pending").toString("hex")}`;

  await db.insert(users).values({
    id: userId,
    email: entry.email,
    passwordHash: placeholderPasswordHash,
    emailVerified: true, // we accept the waitlist email as verified
    role: "user",
    status: "active",
    accessExpiresAt,
    approvedAt: now,
    approvedBy: admin.id,
  });

  await db
    .insert(userProfiles)
    .values({ userId, fullName: entry.fullName })
    .onConflictDoNothing();

  const setPasswordToken = await createPasswordResetToken(userId);

  await db
    .update(waitlistSignups)
    .set({
      status: "invited",
      invitedAt: now,
      invitedBy: admin.id,
      userId,
    })
    .where(eq(waitlistSignups.id, id));

  await recordAdminAction({
    actorUserId: admin.id,
    targetUserId: userId,
    action: "approve",
    note: `waitlist invitation: ${entry.fullName} <${entry.email}>`,
    after: {
      status: "active",
      accessExpiresAt,
      approvedBy: admin.id,
      source: "waitlist",
    },
  });

  try {
    await sendWaitlistInvitation({
      to: entry.email,
      fullName: entry.fullName,
      setPasswordToken,
      accessExpiresAt,
    });
  } catch (err) {
    console.error("[admin-waitlist/invite] email send failed:", err);
    // Email failed but the user account exists. Return a partial-success
    // response so the admin knows to follow up manually.
    return NextResponse.json(
      {
        ok: true,
        warning: "user created but invitation email failed; share /reset-password manually",
        userId,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, userId });
}
