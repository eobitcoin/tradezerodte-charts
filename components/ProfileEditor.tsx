"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ProfileEditor({
  displayName,
  fullName,
  timezone,
}: {
  displayName: string | null;
  fullName: string | null;
  timezone: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    displayName: displayName ?? "",
    fullName: fullName ?? "",
    timezone: timezone ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: form.displayName || null,
          fullName: form.fullName || null,
          timezone: form.timezone || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `${res.status}`);
      }
      setMsg({ kind: "ok", text: "Saved." });
      router.refresh();
    } catch (err) {
      setMsg({ kind: "err", text: String((err as Error).message ?? err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 text-sm">
      <Field
        label="Display name"
        hint="Shown to admins and (later) other users"
        value={form.displayName}
        onChange={(v) => setForm({ ...form, displayName: v })}
      />
      <Field
        label="Full name"
        value={form.fullName}
        onChange={(v) => setForm({ ...form, fullName: v })}
      />
      <Field
        label="Timezone"
        placeholder="America/New_York"
        value={form.timezone}
        onChange={(v) => setForm({ ...form, timezone: v })}
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 rounded bg-black text-white dark:bg-white dark:text-black text-sm font-semibold disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {msg && (
          <span
            className={`text-xs ${
              msg.kind === "ok"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-[0.16em] text-black/55 dark:text-white/55">
        {label}
      </span>
      {hint && (
        <span className="text-[11px] text-black/45 dark:text-white/45 ml-2">
          {hint}
        </span>
      )}
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded border border-black/10 dark:border-white/15 bg-transparent px-2.5 py-1.5 text-sm"
      />
    </label>
  );
}
