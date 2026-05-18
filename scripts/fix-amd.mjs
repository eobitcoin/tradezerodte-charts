import postgres from "postgres";
const sql = postgres(process.env.DATABASE_PUBLIC_URL, { ssl: "require" });
const closedAt = new Date("2026-05-15T19:13:25.951Z"); // Tradier txn date
const exitFill = 1.56;
const entryFill = 1.02;
const qty = 9;
const realized = (exitFill - entryFill) * 100 * qty;
console.log(`Reconciling AMD: realized = $${realized.toFixed(2)}`);
const upd = await sql`
  UPDATE bot_trades
  SET status = 'closed',
      exit_fill_usd = ${exitFill.toFixed(4)},
      realized_pnl_usd = ${realized.toFixed(2)},
      closed_at = ${closedAt}
  WHERE source_ticker = 'AMD' AND status = 'open'
  RETURNING id, status, exit_fill_usd, realized_pnl_usd, closed_at
`;
console.log("Updated:", upd);
// Also log to the tape so the user sees the reconciliation in Activity
await sql`
  INSERT INTO bot_actions (kind, severity, message, trade_id, data)
  VALUES (
    'force_exit',
    'info',
    'AMD AMD260515P00430000 — position closed externally at Tradier (sell_to_close 126689909 @ $1.56 on 2026-05-15 19:13 UTC). Reconciled: realized P&L +$486.00. Manual one-shot fix.',
    ${upd[0]?.id ?? null},
    ${{ source: 'manual_reconcile', tradierOrderId: '126689909', exitFill: 1.56, entryFill: 1.02, qty: 9, realizedPnlUsd: 486 }}
  )
`;
console.log("Tape entry inserted");
await sql.end();
