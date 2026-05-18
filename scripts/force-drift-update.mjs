import postgres from "postgres";
const sql = postgres(process.env.DATABASE_PUBLIC_URL, { ssl: "require" });
const before = await sql`SELECT entry_repeg_max_drift_pct FROM bot_config WHERE id='default'`;
console.log("Before:", before[0]);
const upd = await sql`
  UPDATE bot_config SET entry_repeg_max_drift_pct = '10.00'
  WHERE id='default'
  RETURNING entry_repeg_max_drift_pct
`;
console.log("After:", upd[0]);
// Also check applied migrations
const mig = await sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 3`;
console.log("Last migrations:", mig);
await sql.end();
