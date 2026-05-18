import postgres from "postgres";
const sql = postgres(process.env.DATABASE_PUBLIC_URL, { ssl: "require" });
const [r] = await sql`SELECT entry_repeg_max_drift_pct FROM bot_config WHERE id='default'`;
console.log("entry_repeg_max_drift_pct =", r.entry_repeg_max_drift_pct);
await sql.end();
