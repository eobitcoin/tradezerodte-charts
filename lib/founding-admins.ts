/**
 * Founding-admin allowlist.
 *
 * Any email here:
 *   1. Is the default `ADMIN_EMAILS` recipient list for new-signup notifications.
 *   2. Is auto-promoted to role='admin' + status='active' on every login (so
 *      a fresh signup for one of these addresses immediately gains admin
 *      access without waiting for another admin to approve them).
 *
 * Keep the list lowercase and comma-joined. The DB-side bootstrap
 * (migration 0013) also runs the same UPDATE for existing rows, so this list
 * is the single source of truth for "who is permanently admin."
 */
export const FOUNDING_ADMIN_EMAILS: ReadonlyArray<string> = [
  "ertemusa@gmail.com",
  "ertemusa1@gmail.com",
  "eobreakers@gmail.com",
];

export const FOUNDING_ADMINS_RAW = FOUNDING_ADMIN_EMAILS.join(",");

export function isFoundingAdmin(email: string): boolean {
  return FOUNDING_ADMIN_EMAILS.includes(email.toLowerCase().trim());
}
