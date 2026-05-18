import postgres from "postgres";
const sql = postgres(process.env.DATABASE_PUBLIC_URL, { ssl: "require" });
const rows = await sql`
  SELECT trading_day, scan_kind, title, run_at, updated_at, length(body_md) AS body_chars
  FROM posts
  WHERE trading_day >= CURRENT_DATE - INTERVAL '3 days'
  ORDER BY trading_day DESC, updated_at DESC
`;
console.log("Recent posts:");
for (const r of rows) {
  console.log(`  day=${r.trading_day.toISOString().slice(0,10)} kind=${r.scan_kind} updated=${r.updated_at.toISOString()} chars=${r.body_chars} title="${(r.title||"").slice(0,60)}"`);
}
await sql.end();
