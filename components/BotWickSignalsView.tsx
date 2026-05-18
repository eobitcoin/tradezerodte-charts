"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { STRATEGIES, STRATEGY_ORDER, type StrategyMeta } from "@/lib/botwick/strategies";
import type { SignalStrategy } from "@/lib/db/schema";

type Props = {
  active: SignalStrategy;
};

/**
 * BotWick — SIGNALS tab.
 *
 * Renders the strategy catalog from `lib/botwick/strategies` so this view
 * stays in sync with the runtime by construction. Admin picks one strategy
 * (radio); the rest is documentation rendered from the registry. Adding a
 * new strategy in the future is a one-file change to the registry — this
 * component picks it up automatically.
 */
export default function BotWickSignalsView({ active }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOk] = useState<string | null>(null);
  const [selected, setSelected] = useState<SignalStrategy>(active);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    start(async () => {
      const res = await fetch("/api/admin/botwick/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeSignalStrategy: selected }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      setOk(`Active strategy: ${STRATEGIES[selected].name}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Signal strategies</h1>
        <p className="text-sm text-black/60 dark:text-white/60 mt-1">
          The bot honors exactly one signal strategy at a time. Pick the one you want active; the
          rest stays dormant until selected. Adding new strategies in the future is a single-file
          change to the registry — this page renders directly from it.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-4">
        {STRATEGY_ORDER.map((id) => (
          <StrategyCard
            key={id}
            meta={STRATEGIES[id]}
            selected={selected === id}
            isCurrentActive={active === id}
            onSelect={() => setSelected(id)}
          />
        ))}

        {err && (
          <p className="text-sm text-rose-500" role="alert">
            {err}
          </p>
        )}
        {okMsg && (
          <p className="text-sm text-emerald-600 dark:text-emerald-300">{okMsg}</p>
        )}

        <button
          type="submit"
          disabled={pending || selected === active}
          className="px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm disabled:opacity-40"
        >
          {pending
            ? "Saving…"
            : selected === active
              ? `Active: ${STRATEGIES[active].shortLabel}`
              : `Activate "${STRATEGIES[selected].shortLabel}"`}
        </button>
      </form>

      <p className="text-xs text-black/55 dark:text-white/55">
        Strategies marked <span className="px-1 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-mono text-[10px] uppercase tracking-widest">in dev</span> are
        selectable for preview but the monitor will log "strategy not yet implemented" and skip
        entry generation until they ship. Other phases (force-exit, reconcile, plan-based entries
        when applicable) continue to run.
      </p>
    </div>
  );
}

function StrategyCard({
  meta,
  selected,
  isCurrentActive,
  onSelect,
}: {
  meta: StrategyMeta;
  selected: boolean;
  isCurrentActive: boolean;
  onSelect: () => void;
}) {
  const statusChip =
    meta.status === "implemented" ? (
      <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
        live
      </span>
    ) : (
      <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
        in dev
      </span>
    );

  return (
    <label
      className={`block rounded-lg border p-4 cursor-pointer transition-colors ${
        selected
          ? "border-emerald-500/60 bg-emerald-500/5"
          : "border-black/10 dark:border-white/10 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="radio"
          name="strategy"
          value={meta.id}
          checked={selected}
          onChange={onSelect}
          className="mt-1.5"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-base font-semibold">{meta.name}</h2>
            <div className="flex items-center gap-2 text-xs text-black/55 dark:text-white/55">
              {meta.recommended && (
                <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                  recommended
                </span>
              )}
              {isCurrentActive && (
                <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300">
                  currently active
                </span>
              )}
              {statusChip}
            </div>
          </div>
          <p className="text-sm text-black/70 dark:text-white/70 mt-1">{meta.summary}</p>

          <details className="mt-3" open={selected}>
            <summary className="text-xs uppercase tracking-widest text-black/55 dark:text-white/55 cursor-pointer hover:text-black/75 dark:hover:text-white/75">
              Rules
            </summary>
            <ul className="mt-2 list-disc pl-5 space-y-1 text-sm text-black/75 dark:text-white/75">
              {meta.rules.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </details>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {meta.dataSources.map((d) => (
              <span
                key={d}
                className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.05] text-black/55 dark:text-white/55"
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      </div>
    </label>
  );
}
