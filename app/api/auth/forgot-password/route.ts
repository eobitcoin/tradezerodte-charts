/**
 * POST /api/auth/forgot-password
 *
 * Body: { email }
 *
 * Always returns 200 with a generic message regardless of whether the email
 * is on file. This is the standard countermeasure against account
 * enumeration — an attacker who probes a list of emails can't tell which
 * ones have accounts. The actual reset email only fires when the address
 * resolves to a real, email-verified, non-disabled account.
 *
 * No rate-limiting yet — Resend is the bottleneck and the function is
 * idempotent (each call replaces any prior outstanding token), so the worst
 * an attacker can do today is generate noise in the logs. If we get spammed,
 * add a rate limiter keyed on IP + email.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { createPasswordResetToken } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/email";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().email().max(254).transform((v) => v.toLowerCase().trim()),
});

const GENERIC = {
  ok: true,
  message:
    "If an account exists for that email, a password-reset link has been sent. Check your inbox.",
};

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }
  const { email } = parsed;

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];

  // Only mint a token + send email if the account is in a state that can
  // actually use a reset (real account, verified, not disabled). Pending
  // users don't get a reset email — they need to be approved first; sending
  // them a reset link would be misleading. Same for disabled accounts.
  if (user && user.emailVerified && user.status !== "disabled") {
    try {
      const token = await createPasswordResetToken(user.id);
      await sendPasswordResetEmail(email, token);
    } catch (err) {
      // Log but don't surface — we don't want errors here to leak info
      // about whether the email exists.
      console.error("password reset email failed:", err);
    }
  }

  return NextResponse.json(GENERIC);
}
