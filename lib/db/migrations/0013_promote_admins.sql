-- Promote the founding-admin email list to admin role.
-- Idempotent: if any of these accounts don't exist yet, the UPDATE simply
-- affects 0 rows. The runtime auth layer also checks the same allowlist on
-- every login and auto-promotes, so future signups for these addresses also
-- become admin without requiring another migration.
UPDATE "users"
SET "role" = 'admin', "status" = 'active', "approved_at" = COALESCE("approved_at", now())
WHERE LOWER("email") IN ('ertemusa@gmail.com', 'ertemusa1@gmail.com', 'eobreakers@gmail.com');
