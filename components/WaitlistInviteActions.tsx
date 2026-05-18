"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type AccessChoice = "default" | "none" | "custom";

export default function WaitlistInviteActions({
  waitlistId,
  email,
  defaultAccessIso,
}: {
  waitlistId: string;
  email: string;
  defaultAccessIso: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [accessChoice, setAccessChoice] = useState<AccessChoice>("default");
  const [customDate, setCustomDate] = useState<string>(defaultAccessIso.slice(0, 10));

  function resolveExpiry(): string | "default" | null {
    if (accessChoice === "default") return "default";
    if (accessChoice === "none") return null;
    return new Date(`${customDate}T23:59:59Z`).toISOString();
  }

  async function invite() {
    setError(null);
    setWarning(null);
    const res = await fetch(`/api/admin/waitlist/${waitlistId}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessExpiresAt: resolveExpiry() }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `${res.status}`);
    }
    const j = await res.json().catch(() => ({}));
    if (j.warning) setWarning(j.warning);
  }

  function handle() {
    startTransition(() => {
      invite()
        .then(() => router.refresh())
        .catch((e) => setError(String(e.message ?? e)));
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={pending}
        className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
      >
        Invite
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.04] p-3 space-y-2 min-w-[280px]">
      <div className="text-xs text-black/65 dark:text-white/65">
        Invite <strong className="font-mono text-[12px]">{email}</strong> with access:
      </div>
      <fieldset className="space-y-1 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`acc-${waitlistId}`}
            checked={accessChoice === "default"}
            onChange={() => setAccessChoice("default")}
          />
          <span>1 year (default)</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`acc-${waitlistId}`}
            checked={accessChoice === "none"}
            onChange={() => setAccessChoice("none")}
          />
          <span>No expiry</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`acc-${waitlistId}`}
            checked={accessChoice === "custom"}
            onChange={() => setAccessChoice("custom")}
          />
          <span>Custom:</span>
          <input
            type="date"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            onClick={() => setAccessChoice("custom")}
            className="rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-0.5 text-xs font-mono"
          />
        </label>
      </fieldset>
      {error && (
        <div className="text-xs text-rose-700 dark:text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded px-2 py-1">
          {error}
        </div>
      )}
      {warning && (
        <div className="text-xs text-amber-700 dark:text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded px-2 py-1">
          {warning}
        </div>
      )}
      <div className="flex gap-2">
        <button
          disabled={pending}
          onClick={handle}
          className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
        >
          {pending ? "Inviting…" : "Send invitation"}
        </button>
        <button
          disabled={pending}
          onClick={() => setOpen(false)}
          className="px-3 py-1 rounded border border-black/15 dark:border-white/15 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
