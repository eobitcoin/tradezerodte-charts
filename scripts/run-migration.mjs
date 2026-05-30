#!/usr/bin/env node
/**
 * One-shot migration runner — applies a single .sql file to whatever
 * DATABASE_URL points at. Use when you don't have psql installed locally.
 *
 * Usage:
 *   DATABASE_URL="postgres://..." node scripts/run-migration.mjs <path-to-sql>
 *
 * Example (with Railway env injection):
 *   DATABASE_URL="$(railway service Postgres > /dev/null && \
 *     railway variables --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)" \
 *     node scripts/run-migration.mjs lib/db/migrations/0054_unusual_options_activity.sql
 *
 * The runner executes the file as ONE transaction — either all statements
 * succeed and the migration commits, or it rolls back and nothing changes.
 * That way a half-failed migration can't leave the schema in a weird
 * partial state. For migrations that need to span transactions (CREATE
 * INDEX CONCURRENTLY, etc.), split into multiple files and run each one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/run-migration.mjs <path-to-sql>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const path = resolve(file);
const body = readFileSync(path, "utf8");

console.log(`Applying ${path} …`);
try {
  await sql.begin(async (tx) => {
    // postgres.js doesn't run multi-statement strings via the tagged
    // template — use the unsafe escape hatch deliberately. The input
    // is a developer-authored migration file from our own repo, not
    // user input, so SQL injection is not a concern.
    await tx.unsafe(body);
  });
  console.log("✓ Applied successfully");
} catch (err) {
  console.error("✗ Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
