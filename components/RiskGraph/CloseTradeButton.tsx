"use client";

/**
 * Close-trade button. Confirms with the user, fires the close API,
 * and refreshes the page on success so the new realized P&L renders.
 *
 * Only renders when the trade is currently "open" — the parent page
 * controls visibility based on status.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  id: string;
  name: string;
  /** "header" (default) = full pill button for the detail page header.
   *  "row" = compact icon-style button for the saved-list table. */
  variant?: "header" | "row";
}

export default function CloseTradeButton({ id, name, variant = "header" }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doClose() {
    if (
      !confirm(
        `Close "${name}" at current market prices? This snapshots the chain and books a realized P&L.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/risk-graph/save/${id}/close`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      const pnl = body.realizedPnl as number;
      const sign = pnl >= 0 ? "+" : "−";
      alert(`Closed. Realized P&L: ${sign}$${Math.abs(pnl).toFixed(2)}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (variant === "row") {
    return (
      <button
        onClick={doClose}
        disabled={busy}
        title={error ?? `Close ${name} at current market`}
        className="inline-flex items-center gap-1.5 rounded border border-emerald-500/50 bg-emerald-500/[0.10] px-2.5 py-1 text-[10px] uppercase tracking-widest text-emerald-200 font-semibold hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2.5 6 L5 8.5 L9.5 3.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        {busy ? "…" : "Close"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-xs text-rose-300 max-w-xs truncate" title={error}>
          {error}
        </span>
      )}
      <button
        onClick={doClose}
        disabled={busy}
        className="rounded border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-xs uppercase tracking-widest text-emerald-200 font-semibold hover:bg-emerald-500/25 disabled:opacity-40"
      >
        {busy ? "Closing…" : "Close trade"}
      </button>
    </div>
  );
}
