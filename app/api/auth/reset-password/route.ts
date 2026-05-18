/**
 * POST /api/auth/reset-password
 *
 * Body: { token, password }
 *
 * Consumes a single-use reset token, sets the new password, and revokes
 * every active session for the user (defense-in-depth: if any session was
 * hijacked, the password reset evicts it). User must sign in again with the
 * new password.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  consumePasswordResetToken,
  hashPassword,
  deleteAllSessionsForUser,
} from "@/lib/auth";

export const runtime = "nodejs";

const Body = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }
  const { token, password } = parsed;

  const consumed = await consumePasswordResetToken(token);
  if (!consumed.ok) {
    return NextResponse.json(
      {
        error:
          consumed.reason === "token expired"
            ? "This reset link has expired. Request a new one."
            : "This reset link is invalid or has already been used. Request a new one.",
        reason: consumed.reason,
      },
      { status: 400 },
    );
  }

  const newHash = await hashPassword(password);
  await db
    .update(users)
    .set({ passwordHash: newHash })
    .where(eq(users.id, consumed.userId));

  // Defense-in-depth: kill all active sessions on password change. Anyone
  // who was already signed in (legit user on another device, or a hijacker)
  // gets ejected on their next request.
  await deleteAllSessionsForUser(consumed.userId);

  return NextResponse.json({ ok: true });
}
