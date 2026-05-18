import {
  randomBytes,
  createHash,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { eq, lt, and } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "./db";
import {
  sessions,
  users,
  verificationTokens,
  passwordResetTokens,
  type User,
} from "./db/schema";
import { SESSION_COOKIE } from "./session-constant";

/**
 * Access guard — encodes the rule for whether a user is currently allowed in.
 *
 * - `status='active'` is required.
 * - If `accessExpiresAt` is set and in the past, access has lapsed.
 * - `'pending'` and `'disabled'` are explicit blocks with their own copy.
 *
 * Returns `{ ok: true }` when access is granted, otherwise `{ ok: false, reason }`
 * with a stable reason code so callers can choose the right user-facing message.
 */
export type AccessReason =
  | "pending_approval"
  | "disabled"
  | "expired"
  | "email_unverified";

export function evaluateAccess(
  user: Pick<User, "status" | "accessExpiresAt" | "emailVerified">,
): { ok: true } | { ok: false; reason: AccessReason } {
  if (!user.emailVerified) return { ok: false, reason: "email_unverified" };
  if (user.status === "pending") return { ok: false, reason: "pending_approval" };
  if (user.status === "disabled") return { ok: false, reason: "disabled" };
  if (
    user.accessExpiresAt &&
    user.accessExpiresAt.getTime() < Date.now()
  ) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

export { SESSION_COOKIE };

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const VERIFY_TTL_MS = 1000 * 60 * 60 * 24;
// Password-reset tokens are higher-stakes than email verification, so they
// expire faster. One hour is the industry-standard floor.
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 60;
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;

export function generateId(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

function hashSessionId(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scrypt(pw, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(stored: string, pw: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const derived = await scrypt(pw, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export async function createSession(userId: string): Promise<{ raw: string; expiresAt: Date }> {
  const raw = generateId(24);
  const id = hashSessionId(raw);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id, userId, expiresAt });
  return { raw, expiresAt };
}

export async function setSessionCookie(raw: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const id = hashSessionId(raw);
  const rows = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.session.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  // Live access check on every request — disabling, expiring, or revoking a
  // user immediately ejects them on their next page load.
  const access = evaluateAccess(row.user);
  if (!access.ok) {
    await db.delete(sessions).where(eq(sessions.userId, row.user.id));
    return null;
  }
  return row.user;
}

/**
 * Server-side admin gate. Use in admin pages and admin API routes.
 * Returns the admin user when authorized, otherwise null (caller decides what
 * to do — redirect, 403, etc).
 */
export async function getCurrentAdmin(): Promise<User | null> {
  const u = await getCurrentUser();
  if (!u) return null;
  if (u.role !== "admin") return null;
  return u;
}

/**
 * Hard-revoke every session for a user. Called when an admin disables them,
 * changes their role, or extends/shortens access in a way that should kick
 * them out (the next call to getCurrentUser will return null).
 */
export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteCurrentSession() {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return;
  const id = hashSessionId(raw);
  await db.delete(sessions).where(eq(sessions.id, id));
  await clearSessionCookie();
}

export async function createVerificationToken(userId: string): Promise<string> {
  const token = generateId(32);
  const expiresAt = new Date(Date.now() + VERIFY_TTL_MS);
  await db.delete(verificationTokens).where(eq(verificationTokens.userId, userId));
  await db.insert(verificationTokens).values({ token, userId, expiresAt });
  return token;
}

export async function consumeVerificationToken(
  token: string,
): Promise<{ ok: true; userId: string } | { ok: false; reason: string }> {
  const rows = await db
    .select()
    .from(verificationTokens)
    .where(eq(verificationTokens.token, token))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, reason: "invalid token" };
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(verificationTokens).where(eq(verificationTokens.token, token));
    return { ok: false, reason: "token expired" };
  }
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, row.userId));
  await db.delete(verificationTokens).where(eq(verificationTokens.token, token));
  return { ok: true, userId: row.userId };
}

export async function purgeExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/**
 * Mints a single-use password-reset token for a user.
 * Convention: at most one outstanding token per user — minting a new one
 * invalidates any earlier outstanding ones.
 */
export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = generateId(32);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
  await db.insert(passwordResetTokens).values({ token, userId, expiresAt });
  return token;
}

/**
 * Validates and consumes a password-reset token. Returns the user ID on
 * success. Token is single-use: it's deleted whether or not the password
 * change ultimately succeeds (caller should mint a fresh one for retries).
 */
export async function consumePasswordResetToken(
  token: string,
): Promise<{ ok: true; userId: string } | { ok: false; reason: string }> {
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.token, token))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, reason: "invalid token" };
  // Delete the token immediately — even if password update later fails the
  // token is now spent. Forces user to request a fresh one on retry.
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.token, token));
  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "token expired" };
  }
  return { ok: true, userId: row.userId };
}

export { and };
