import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, userProfiles } from "@/lib/db/schema";
import { generateId, hashPassword, createVerificationToken } from "@/lib/auth";
import { sendVerificationEmail, sendNewSignupNotification } from "@/lib/email";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().email().max(254).transform((v) => v.toLowerCase().trim()),
  password: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }
  const { email, password } = parsed;

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let userId: string;
  let isNewSignup = false;
  if (existing[0]) {
    if (existing[0].emailVerified) {
      return NextResponse.json({ error: "email already registered" }, { status: 409 });
    }
    userId = existing[0].id;
    const passwordHash = await hashPassword(password);
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  } else {
    userId = generateId(16);
    const passwordHash = await hashPassword(password);
    // status defaults to 'pending' via the column default — admin must approve.
    await db.insert(users).values({ id: userId, email, passwordHash, emailVerified: false });
    // Create the 1:1 profile row so admin views always have a target to render.
    await db.insert(userProfiles).values({ userId }).onConflictDoNothing();
    isNewSignup = true;
  }

  const token = await createVerificationToken(userId);
  try {
    await sendVerificationEmail(email, token);
  } catch (err) {
    console.error("verification email failed:", err);
    return NextResponse.json(
      { error: "signup ok but verification email failed; contact admin" },
      { status: 500 },
    );
  }

  // Best-effort admin notification on genuinely new signups (skip when this is
  // a re-submission of an unverified address — that's effectively a password
  // reset before approval and shouldn't re-notify).
  if (isNewSignup) {
    void sendNewSignupNotification({ newUserEmail: email, signupAt: new Date() });
  }

  return NextResponse.json(
    {
      ok: true,
      message:
        "Check your email to verify the address. After that, an admin will approve your account before you can sign in.",
    },
    { status: 200 },
  );
}
