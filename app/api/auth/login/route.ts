import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  verifyPassword,
  createSession,
  setSessionCookie,
  evaluateAccess,
} from "@/lib/auth";
import { isFoundingAdmin } from "@/lib/founding-admins";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().email().transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1).max(200),
});

const REASON_TO_MESSAGE: Record<string, string> = {
  pending_approval:
    "Your account is awaiting admin approval. You'll get an email when it's activated.",
  disabled:
    "Your account has been disabled. Please contact the administrator.",
  expired:
    "Your access period has ended. Please contact the administrator to extend it.",
  email_unverified:
    "Email not verified. Check your inbox for the verification link.",
};

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }
  const { email, password } = parsed;

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let user = rows[0];
  if (!user) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  // Founding-admin auto-promote: if this email is on the hardcoded admin
  // allowlist but the row isn't yet admin+active (e.g. fresh signup for one
  // of those emails), upgrade them in place. Only runs after a successful
  // password check so an attacker can't poke the allowlist.
  //
  // SAFETY: `foundingAdminOptOut` is the explicit demotion marker. If an
  // admin used the user-management UI to demote a founding-admin email, we
  // honor that — otherwise the demotion would silently revert on next login,
  // which is exactly the bug we just fixed.
  if (
    isFoundingAdmin(user.email) &&
    !user.foundingAdminOptOut &&
    user.emailVerified &&
    (user.role !== "admin" || user.status !== "active")
  ) {
    await db
      .update(users)
      .set({ role: "admin", status: "active", approvedAt: user.approvedAt ?? new Date() })
      .where(eq(users.id, user.id));
    user = { ...user, role: "admin", status: "active", approvedAt: user.approvedAt ?? new Date() };
  }

  // Status / expiry / verification gate (all post-password so attackers
  // can't probe arbitrary emails for account state).
  const access = evaluateAccess(user);
  if (!access.ok) {
    return NextResponse.json(
      {
        error: REASON_TO_MESSAGE[access.reason] ?? "access denied",
        reason: access.reason,
      },
      { status: 403 },
    );
  }

  const { raw, expiresAt } = await createSession(user.id);
  await setSessionCookie(raw, expiresAt);
  return NextResponse.json({ ok: true });
}
