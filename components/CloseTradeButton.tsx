"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Props = {
  tradeId: string;
  ticker: string;
  occSymbol?: string | null;
};

/**
 * Admin-only inline button next to an open bot trade. Submits a MARKET
 * sell_to_close via POST /api/admin/botwick/trades/[id]/close. The follow-up
 * fill is picked up by the normal reconcile path on the next tick.
 *
 * Renders nothing while a close is in flight to prevent double-clicks; the
 * page is refreshed on success so the trade re-appears in `closing` status.
 */
export default function CloseTradeButton({ tradeId, ticker, occSymbol }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);

  function onClick() {
    if (busy || pending) return;
    const label = occSymbol ? `${ticker} ${occSymbol}` : ticker;
    if (
      !window.confirm(
        `Manually close ${label}?\n\nSubmits a MARKET sell_to_close to Tradier right now. The bot's normal exit logic is bypassed.\n\nProceed?`,
      )
    ) {
      return;
    }
    setBusy(true);
    start(async () => {
      try {
        const res = await fetch(`/api/admin/botwick/trades/${tradeId}/close`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          window.alert(`Close failed: ${j.error ?? `HTTP ${res.status}`}`);
          setBusy(false);
          return;
        }
        // Pre-flight detected no position at Tradier — surface the reconciliation
        // outcome so the admin knows no order went to the broker.
        if (j.positionAbsent === true) {
          const pnl =
            j.matchedGainloss && j.realizedPnlUsd != null
              ? ` Matched gainloss P&L: ${j.realizedPnlUsd >= 0 ? "+" : ""}$${Number(j.realizedPnlUsd).toFixed(2)}.`
              : " P&L not yet available from Tradier — check the P&L tab.";
          window.alert(
            `No position at Tradier — likely already closed externally.\n\nNO new order was submitted. Trade marked as closed in the DB.${pnl}`,
          );
        }
        // Refresh either way — status badge needs to update.
        router.refresh();
      } catch (e) {
        window.alert(`Close failed: ${String(e)}`);
      } finally {
        setBusy(false);
      }
    });
  }

  const disabled = busy || pending;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Submit MARKET sell_to_close immediately"
      className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border transition-colors ${
        disabled
          ? "border-rose-500/20 text-rose-500/40 cursor-wait"
          : "border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
      }`}
    >
      {disabled ? "Closing…" : "Close"}
    </button>
  );
}
