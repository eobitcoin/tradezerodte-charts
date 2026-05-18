/**
 * GET /api/admin/users
 *
 * Returns the full user list joined with profiles. Admin-only.
 * Optional query params:
 *   ?status=pending|active|disabled
 *   ?role=admin|user
 *   ?q=<email substring>
 */
import { NextResponse } from "next/server";
import { eq, ilike, desc, sql, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, userProfiles } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const role = url.searchParams.get("role");
  const q = url.searchParams.get("q");

  const conds = [];
  if (status === "pending" || status === "active" || status === "disabled") {
    conds.push(eq(users.status, status));
  }
  if (role === "admin" || role === "user") {
    conds.push(eq(users.role, role));
  }
  if (q && q.trim()) {
    conds.push(ilike(users.email, `%${q.trim()}%`));
  }

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
      emailVerified: users.emailVerified,
      accessExpiresAt: users.accessExpiresAt,
      approvedAt: users.approvedAt,
      disabledAt: users.disabledAt,
      disabledReason: users.disabledReason,
      subscriptionTier: users.subscriptionTier,
      createdAt: users.createdAt,
      displayName: userProfiles.displayName,
      fullName: userProfiles.fullName,
    })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(conds.length ? and(...conds) : sql`true`)
    .orderBy(desc(users.createdAt));

  return NextResponse.json({ users: rows });
}
