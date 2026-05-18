import postgres from "postgres";
const sql = postgres(process.env.DATABASE_PUBLIC_URL, { ssl: "require" });
const [row] = await sql`
  SELECT title, length(body_md) AS chars, body_md
  FROM posts
  WHERE trading_day = '2026-05-14' AND scan_kind = 'market_open'
  LIMIT 1
`;
console.log("Title:", row.title);
console.log("Chars:", row.chars);
console.log("---");
// Find a Trade Plan section and print ~30 lines around it
const idx = row.body_md.indexOf("0DTE Trade Plan");
if (idx < 0) {
  console.log("NO '0DTE Trade Plan' string found in market_open body!");
  // Try variations
  for (const v of ["Trade Plan", "trade plan", "TRADE PLAN", "Strike"]) {
    const i = row.body_md.indexOf(v);
    console.log(`  '${v}' at idx ${i}`);
  }
} else {
  console.log(`First '0DTE Trade Plan' at index ${idx}`);
  console.log(row.body_md.slice(Math.max(0, idx - 80), idx + 1200));
}
await sql.end();
