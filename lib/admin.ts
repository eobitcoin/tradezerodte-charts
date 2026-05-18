/**
 * Admin action audit trail. Every admin-driven mutation on a user (approve,
 * disable, role change, etc.) writes one row to `admin_actions` capturing
 * who did what to whom, with full before/after snapshots so the trail is
 * reconstructable.
 *
 * Convention: `beforeValue` and `afterValue` should contain ONLY the fields
 * that changed (not the full user row), so the audit log stays compact and
 * reads like a diff.
 */
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import { adminActions, users, type AdminAction } from "./db/schema";

export async function recordAdminAction(opts: {
  actorUserId: string;
  targetUserId: string;
  action: AdminAction;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  note?: string;
}): Promise<void> {
  await db.insert(adminActions).values({
    actorUserId: opts.actorUserId,
    targetUserId: opts.targetUserId,
    action: opts.action,
    beforeValue: opts.before ?? null,
    afterValue: opts.after ?? null,
    note: opts.note ?? null,
  });
}

/**
 * Default access expiry when an admin approves a new user without specifying:
 * 1 year from approval. Admins can override with a specific date or pass
 * `null` for no expiry.
 */
export function defaultAccessExpiry(now: Date = new Date()): Date {
  const out = new Date(now);
  out.setFullYear(out.getFullYear() + 1);
  return out;
}

/**
 * Count of users who can currently exercise admin powers right now —
 * `role='admin'` AND `status='active'` AND access not lapsed.
 *
 * Used to block any single mutation that would drop the active-admin count
 * to zero (demotion of the last admin, disabling the last admin, expiring
 * the last admin). Without this, an admin can lock the whole system out of
 * admin access with a single click.
 *
 * Note: this counts the LAST KNOWN state. The check is racy if two admins
 * demote each other simultaneously — but only one will be the "last," and the
 * race is benign: at most one of the two requests will succeed.
 */
export async function countActiveAdmins(): Promise<number> {
  const now = new Date();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        eq(users.role, "admin"),
        eq(users.status, "active"),
        // accessExpiresAt is nullable; either null (no expiry) or in the future.
        // Use Drizzle's typed operators here — postgres-js rejects Date
        // objects interpolated via the sql`` template, but gt/isNull bind
        // them correctly as TIMESTAMPTZ.
        or(isNull(users.accessExpiresAt), gt(users.accessExpiresAt, now)),
      ),
    );
  return rows[0]?.count ?? 0;
}
