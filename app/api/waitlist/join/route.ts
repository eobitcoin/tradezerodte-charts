/**
 * POST /api/waitlist/join
 *
 * Public endpoint — anyone can hit this from the /welcome marketing page.
 *
 * Validation:
 *   - email + fullName + whyInterested + tradingExperience all required
 *   - email is case-insensitive unique
 *   - If the email already exists on the waitlist, return the same generic
 *     success response (anti-enumeration). Don't update the existing row.
 *
 * Side effects:
 *   - confirmation email to the applicant
 *   - admin notification email
 *
 * No rate limiting yet; if abuse appears, add IP-based throttling.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { waitlistSignups } from "@/lib/db/schema";
import {
  sendWaitlistConfirmation,
  sendWaitlistAdminNotification,
} from "@/lib/email";

export const runtime = "nodejs";

const TRADING_EXPERIENCE = [
  "Beginner (< 1 year)",
  "Intermediate (1–3 years)",
  "Advanced (3+ years)",
  "Professional / institutional",
] as const;

const Body = z.object({
  email: z.string().email().max(254).transform((v) => v.toLowerCase().trim()),
  fullName: z.string().min(2).max(100).transform((v) => v.trim()),
  whyInterested: z.string().min(10).max(2000).transform((v) => v.trim()),
  tradingExperience: z.enum(TRADING_EXPERIENCE),
  source: z.string().max(80).optional(),
});

const GENERIC_SUCCESS = {
  ok: true,
  message:
    "Thanks — you're on the waitlist. We'll email you when your invitation is ready.",
};

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid body", detail: String(err) },
      { status: 400 },
    );
  }

  // De-dupe on email. If the address already exists on the waitlist, we
  // silently treat it as success (anti-enumeration AND no surprise for a
  // user who forgot they already applied).
  const existing = await db
    .select({ id: waitlistSignups.id })
    .from(waitlistSignups)
    .where(eq(waitlistSignups.email, parsed.email))
    .limit(1);

  if (existing[0]) {
    return NextResponse.json(GENERIC_SUCCESS);
  }

  await db.insert(waitlistSignups).values({
    email: parsed.email,
    fullName: parsed.fullName,
    whyInterested: parsed.whyInterested,
    tradingExperience: parsed.tradingExperience,
    source: parsed.source ?? null,
    status: "pending",
  });

  // Best-effort emails — don't fail the API if Resend hiccups.
  void sendWaitlistConfirmation({ to: parsed.email, fullName: parsed.fullName });
  void sendWaitlistAdminNotification({
    email: parsed.email,
    fullName: parsed.fullName,
    whyInterested: parsed.whyInterested,
    tradingExperience: parsed.tradingExperience,
  });

  return NextResponse.json(GENERIC_SUCCESS);
}
