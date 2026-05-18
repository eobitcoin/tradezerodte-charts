/**
 * PATCH /api/profile
 *
 * Logged-in user edits their own profile. Cannot edit adminNotes, role,
 * status, or expiry — those are admin-controlled.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

const Body = z.object({
  displayName: z.string().max(100).nullable().optional(),
  fullName: z.string().max(200).nullable().optional(),
  timezone: z.string().max(80).nullable().optional(),
});

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }

  const existing = (
    await db.select().from(userProfiles).where(eq(userProfiles.userId, user.id)).limit(1)
  )[0];

  const updates = { ...body, updatedAt: new Date() };
  if (existing) {
    await db.update(userProfiles).set(updates).where(eq(userProfiles.userId, user.id));
  } else {
    await db.insert(userProfiles).values({ userId: user.id, ...body });
  }
  return NextResponse.json({ ok: true });
}
