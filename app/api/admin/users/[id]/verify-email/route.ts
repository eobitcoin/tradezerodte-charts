/**
 * POST /api/admin/users/[id]/verify-email
 *
 * Manual override for users whose verification email got bounced/blocked
 * by their provider (e.g. Yahoo PH01 content rejections during a new
 * domain's reputation warmup). Flips email_verified=true without requiring
 * the user to click a token link.
 *
 * Does NOT change status — the user still needs to be approved separately.
 * Combined flow for a stuck signup is: verify-email → approve.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, verificationTokens } from "@/lib/db/schema";
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
  if (target.emailVerified) {
    return NextResponse.json({ error: "email is already verified" }, { status: 409 });
  }

  await db.update(users).set({ emailVerified: true }).where(eq(users.id, id));
  // Clean up any outstanding verification token for this user — it's no
  // longer needed and would otherwise expire silently.
  await db.delete(verificationTokens).where(eq(verificationTokens.userId, id));

  await recordAdminAction({
    actorUserId: admin.id,
    targetUserId: id,
    action: "verify_email",
    before: { emailVerified: false },
    after: { emailVerified: true },
    note: "manual override (verification email likely bounced)",
  });

  return NextResponse.json({ ok: true });
}
