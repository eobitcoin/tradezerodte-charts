import postgres from "postgres";
const sql = postgres(process.env.DATABASE_PUBLIC_URL, { ssl: "require" });

const rows = await sql`
  SELECT id, source_ticker, strategy, status, mode, tradier_order_id,
         entry_fill_usd, exit_fill_usd, realized_pnl_usd,
         signaled_at, entry_signaled_at, submitting_at, submitted_at, filled_at, closed_at,
         legs, plan
  FROM bot_trades
  WHERE source_ticker = 'TSLA' AND DATE(signaled_at) = CURRENT_DATE
  ORDER BY signaled_at DESC
`;
console.log(`Found ${rows.length} TSLA trade(s) today`);
for (const r of rows) {
  console.log("=".repeat(80));
  console.log("TRADE ID:", r.id);
  console.log("status:", r.status, "| mode:", r.mode);
  console.log("strategy:", r.strategy);
  console.log("tradier_order_id:", r.tradier_order_id);
  console.log("entry_fill_usd:", r.entry_fill_usd, "| exit_fill_usd:", r.exit_fill_usd, "| realized_pnl_usd:", r.realized_pnl_usd);
  console.log("signaled:", r.signaled_at?.toISOString());
  console.log("entry_signaled:", r.entry_signaled_at?.toISOString());
  console.log("submitting:", r.submitting_at?.toISOString());
  console.log("submitted:", r.submitted_at?.toISOString());
  console.log("filled:", r.filled_at?.toISOString());
  console.log("closed:", r.closed_at?.toISOString());
  console.log("legs:", JSON.stringify(r.legs, null, 2));
  console.log("plan (truncated):", JSON.stringify(r.plan, null, 2).slice(0, 800));
}

console.log("\n=== Current bot_config ===");
const cfg = await sql`SELECT enabled, mode, position_size_usd, max_risk_per_trade_usd, max_daily_loss_usd, max_open_positions, max_plan_slippage_pct, active_signal_strategy, updated_at FROM bot_config WHERE id='default'`;
console.log(cfg[0]);

console.log("\n=== bot_actions for TSLA today (last 30) ===");
const acts = await sql`
  SELECT ts, kind, severity, message, data, trade_id
  FROM bot_actions
  WHERE DATE(ts) = CURRENT_DATE
    AND (message ILIKE '%TSLA%' OR (data->>'ticker' = 'TSLA'))
  ORDER BY ts DESC
  LIMIT 40
`;
for (const a of acts) {
  console.log(`${a.ts.toISOString()} [${a.kind}/${a.severity}] ${a.message}`);
  if (a.data && Object.keys(a.data).length > 0) {
    const summary = {};
    for (const k of ["qty","quantity","mid","price","positionSize","maxPerTrade","budget","computedQty","occSymbol","strike"]) {
      if (a.data[k] != null) summary[k] = a.data[k];
    }
    if (Object.keys(summary).length) console.log("    data:", JSON.stringify(summary));
  }
}
await sql.end();
