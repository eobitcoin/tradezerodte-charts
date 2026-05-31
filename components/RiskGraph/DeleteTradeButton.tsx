"use client";

/**
 * Confirm-and-delete button for a saved trade idea.
 *
 * Two variants:
 *   - "row" (default): small × icon, used inline in the saved-list table
 *   - "header": full button with text, used on the detail page header
 *
 * Both call DELETE /api/risk-graph/save/[id] after a confirm prompt
 * and then either router.refresh() (row variant) or router.push() to
 * the saved list (header variant).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  id: string;
  name: string;
  variant?: "row" | "header";
  /** Where to navigate after delete from the header variant. */
  redirectTo?: string;
}

export default function DeleteTradeButton({
  id,
  name,
  variant = "row",
  redirectTo = "/research/risk-graph/saved",
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doDelete() {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/risk-graph/save/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      if (variant === "row") {
        router.refresh();
      } else {
        router.push(redirectTo);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (variant === "row") {
    return (
      <button
        onClick={doDelete}
        disabled={busy}
        title={error ?? `Delete ${name}`}
        className="text-rose-400 hover:text-rose-300 disabled:opacity-30 text-base px-1"
      >
        ×
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-rose-300">{error}</span>}
      <button
        onClick={doDelete}
        disabled={busy}
        className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs uppercase tracking-widest text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
      >
        {busy ? "Deleting…" : "Delete trade idea"}
      </button>
    </div>
  );
}
