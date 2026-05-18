import postgres from "postgres";

(async () => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set");
  
  const sql = postgres(dbUrl);
  const r = await sql`select trading_day, jsonb_pretty(trades) as trades from posts order by trading_day desc limit 2`;
  console.log(JSON.stringify(r, null, 2));
  await sql.end();
})();
