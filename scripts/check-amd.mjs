import postgres from "postgres";
const sql = postgres(process.env.DATABASE_PUBLIC_URL, { ssl: "require" });
console.log("=== AMD open trades ===");
const rows = await sql`
  SELECT id, source_ticker, strategy, status, mode, tradier_order_id,
         entry_fill_usd, exit_fill_usd, realized_pnl_usd,
         filled_at, closed_at, archived_at,
         legs
  FROM bot_trades
  WHERE source_ticker = 'AMD' AND status IN ('open','closing','working','submitting')
  ORDER BY signaled_at DESC LIMIT 5
`;
for (const r of rows) {
  console.log(`status=${r.status} mode=${r.mode} orderId=${r.tradier_order_id}`);
  console.log(`  entryFill=${r.entry_fill_usd} exitFill=${r.exit_fill_usd} pnl=${r.realized_pnl_usd}`);
  console.log(`  filled=${r.filled_at?.toISOString?.()} closed=${r.closed_at?.toISOString?.()} archived=${r.archived_at?.toISOString?.()}`);
  console.log(`  legs[0]=${JSON.stringify(r.legs?.[0])}`);
}
console.log("\n=== bot_config ===");
const cfg = await sql`SELECT enabled, mode, kill_switch_engaged FROM bot_config WHERE id='default'`;
console.log(cfg[0]);
await sql.end();
