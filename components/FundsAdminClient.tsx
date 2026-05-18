"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { InstitutionalFund } from "@/lib/db/schema";

export default function FundsAdminClient({
  initialFunds,
}: {
  initialFunds: InstitutionalFund[];
}) {
  const router = useRouter();
  const [funds, setFunds] = useState(initialFunds);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // New-fund form state
  const [name, setName] = useState("");
  const [cik, setCik] = useState("");
  const [note, setNote] = useState("");

  function refresh() {
    void fetch("/api/admin/research/funds")
      .then((r) => r.json())
      .then((j) => {
        if (j.funds) setFunds(j.funds);
      });
  }

  function addFund(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const res = await fetch("/api/admin/research/funds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, cik, note: note || null }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "add failed");
        return;
      }
      setName("");
      setCik("");
      setNote("");
      refresh();
      router.refresh();
    });
  }

  function toggleEnabled(id: string, enabled: boolean) {
    start(async () => {
      await fetch(`/api/admin/research/funds/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      refresh();
      router.refresh();
    });
  }

  function deleteFund(id: string, name: string) {
    if (!confirm(`Delete "${name}"? Disabling instead is usually safer.`)) return;
    start(async () => {
      await fetch(`/api/admin/research/funds/${id}`, { method: "DELETE" });
      refresh();
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Add form */}
      <form
        onSubmit={addFund}
        className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3"
      >
        <div className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
          Add fund
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
          <label className="block">
            <span className="text-xs">Name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Tiger Global Management"
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs">CIK</span>
            <input
              type="text"
              required
              value={cik}
              onChange={(e) => setCik(e.target.value)}
              placeholder="0001167483"
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs">Note (optional, shown only to admins)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this fund, style notes, caveats..."
            className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 text-sm"
          />
        </label>
        {err && <div className="text-xs text-rose-500">{err}</div>}
        <button
          type="submit"
          disabled={pending || !name || !cik}
          className="rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500/20 disabled:opacity-40"
        >
          {pending ? "Adding..." : "Add fund"}
        </button>
      </form>

      {/* List */}
      <div className="rounded-lg border border-black/10 dark:border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55 bg-black/[0.02] dark:bg-white/[0.02]">
            <tr>
              <th className="text-left px-4 py-2">Fund</th>
              <th className="text-left px-4 py-2">CIK</th>
              <th className="text-left px-4 py-2">Note</th>
              <th className="text-right px-4 py-2">Sort</th>
              <th className="text-center px-4 py-2">Enabled</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {funds.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-black/55 dark:text-white/55">
                  No funds configured. Add one above.
                </td>
              </tr>
            ) : (
              funds.map((f) => (
                <tr key={f.id} className="border-t border-black/5 dark:border-white/5">
                  <td className="px-4 py-2 font-medium">{f.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{f.cik}</td>
                  <td className="px-4 py-2 text-xs text-black/60 dark:text-white/60">{f.note ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{f.sortOrder}</td>
                  <td className="px-4 py-2 text-center">
                    <label className="inline-flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={f.enabled}
                        disabled={pending}
                        onChange={(e) => toggleEnabled(f.id, e.target.checked)}
                      />
                    </label>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => deleteFund(f.id, f.name)}
                      disabled={pending}
                      className="text-[10px] uppercase tracking-widest text-rose-500 hover:text-rose-600 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-black/55 dark:text-white/55">
        Changes apply on the next scheduled scan. The routine fetches the fund
        list at the start of each run via{" "}
        <code className="px-1 py-0.5 rounded bg-black/[0.05] dark:bg-white/[0.05]">
          GET /api/institutional/funds/&lt;token&gt;
        </code>
        .
      </p>
    </div>
  );
}
