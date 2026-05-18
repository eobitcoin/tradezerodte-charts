import postgres from "postgres";
const sql = postgres(process.env.DATABASE_PUBLIC_URL, { ssl: "require" });
const deleted = await sql`
  DELETE FROM posts
  WHERE trading_day = '2026-05-14' AND scan_kind = 'market_open'
    AND title LIKE 'MARKET OPEN TEST%'
  RETURNING id, title
`;
console.log("Deleted:", deleted);
await sql.end();
