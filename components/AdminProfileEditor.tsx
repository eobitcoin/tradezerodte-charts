"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminProfileEditor({
  userId,
  displayName,
  fullName,
  timezone,
  adminNotes,
}: {
  userId: string;
  displayName: string | null;
  fullName: string | null;
  timezone: string | null;
  adminNotes: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    displayName: displayName ?? "",
    fullName: fullName ?? "",
    timezone: timezone ?? "",
    adminNotes: adminNotes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: form.displayName || null,
          fullName: form.fullName || null,
          timezone: form.timezone || null,
          adminNotes: form.adminNotes || null,
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
        value={form.timezone}
        placeholder="America/New_York"
        onChange={(v) => setForm({ ...form, timezone: v })}
      />
      <label className="block">
        <span className="text-xs uppercase tracking-[0.16em] text-black/55 dark:text-white/55">
          Admin notes <span className="font-normal lowercase">(not visible to user)</span>
        </span>
        <textarea
          rows={3}
          value={form.adminNotes}
          onChange={(e) => setForm({ ...form, adminNotes: e.target.value })}
          className="mt-1 block w-full rounded border border-black/10 dark:border-white/15 bg-transparent px-2.5 py-1.5 text-sm"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 rounded bg-black text-white dark:bg-white dark:text-black text-sm font-semibold disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save profile"}
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-[0.16em] text-black/55 dark:text-white/55">
        {label}
      </span>
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
