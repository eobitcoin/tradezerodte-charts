/**
 * POST /api/admin/users/[id]/approve
 *
 * Body: { accessExpiresAt: ISO-string | null | "default" }
 *   - "default" → 1 year from now (matches the admin UI default)
 *   - null      → no expiry
 *   - ISO       → specific expiry timestamp
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";
import { recordAdminAction, defaultAccessExpiry } from "@/lib/admin";
import { sendApprovalEmail } from "@/lib/email";

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
  if (target.status === "active") {
    return NextResponse.json({ error: "user is already active" }, { status: 409 });
  }

  const expiresAt =
    body.accessExpiresAt === null
      ? null
      : body.accessExpiresAt === "default"
        ? defaultAccessExpiry()
        : new Date(body.accessExpiresAt);

  const before = {
    status: target.status,
    accessExpiresAt: target.accessExpiresAt,
    approvedAt: target.approvedAt,
    approvedBy: target.approvedBy,
  };
  const after = {
    status: "active" as const,
    accessExpiresAt: expiresAt,
    approvedAt: new Date(),
    approvedBy: admin.id,
    disabledAt: null,
    disabledReason: null,
  };

  await db.update(users).set(after).where(eq(users.id, id));
  await recordAdminAction({
    actorUserId: admin.id,
    targetUserId: id,
    action: "approve",
    before,
    after,
  });

  // Email the user (best-effort — don't fail the API call if Resend hiccups).
  void sendApprovalEmail({ to: target.email, accessExpiresAt: expiresAt });

  return NextResponse.json({ ok: true });
}
