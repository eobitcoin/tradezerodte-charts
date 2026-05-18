"use client";

import { useTransition, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { BotConfig } from "@/lib/db/schema";
import type { BotStatus } from "@/lib/botwick";
import type { CredsStatus } from "@/lib/botwick/tradier-adapter";
import BotWickSignalSandbox from "@/components/BotWickSignalSandbox";

type Props = { config: BotConfig; status: BotStatus; creds: CredsStatus };

const MODES = ["off", "paper", "live"] as const;
const GRADES = ["A+", "A", "A-", "B+", "ALL"] as const;

type IngestResult = {
  postDay: string;
  considered: number;
  inserted: number;
  skipped: { ticker: string; reason: string; code: string }[];
};

type TickOutcome =
  | "fired"
  | "armed_no_recheck"
  | "armed"
  | "no_match"
  | "ast_missing"
  | "skipped_already_progressed";

type TickResult = {
  tickAt: string;
  mode: string;
  pendingCount: number;
  tickersConsidered: number;
  trades: {
    tradeId: string;
    ticker: string;
    status: string;
    outcome: TickOutcome;
    reason?: string;
  }[];
  errors: { ticker: string; reason: string; code: string }[];
  submitted: Array<{
    tradeId: string;
    ticker: string;
    outcome: "submitted" | "blocked" | "error";
    orderId?: string;
    price?: number;
    reason?: string;
    code?: string;
  }>;
  exits?: Array<{
    tradeId: string;
    ticker: string;
    outcome:
      | "no_match"
      | "no_quote"
      | "no_occ"
      | "fired_stop"
      | "fired_target"
      | "fired_time_stop"
      | "fired_alma_reversal"
      | "submit_blocked"
      | "submit_error"
      | "no_entry_fill";
    reason?: string;
  }>;
  reconciled: Array<{
    tradeId: string;
    ticker: string;
    phase?: "entry" | "exit";
    tradierStatus: string;
    newStatus: string | null;
    filled: boolean;
    realizedPnlUsd?: number;
  }>;
};

export default function BotWickAdminView({ config, status, creds }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);
  const [tickResult, setTickResult] = useState<TickResult | null>(null);
  const [enabled, setEnabled] = useState(config.enabled);
  const [mode, setMode] = useState<(typeof MODES)[number]>(config.mode);
  const [gradeFilter, setGradeFilter] = useState<(typeof GRADES)[number]>(
    config.gradeFilter as (typeof GRADES)[number],
  );
  const [maxRiskPerTradeUsd, setMaxRisk] = useState(config.maxRiskPerTradeUsd);
  const [maxStockNotionalUsd, setMaxStockNotional] = useState(
    String(config.maxStockNotionalUsd ?? "10000.00"),
  );
  const [maxDailyLossUsd, setMaxDaily] = useState(config.maxDailyLossUsd);
  const [maxOpenPositions, setMaxOpen] = useState(config.maxOpenPositions);
  const [maxPlanSlippagePct, setMaxSlippage] = useState(config.maxPlanSlippagePct);
  const [dayTradeForceExit, setDayTradeForceExit] = useState(config.dayTradeForceExit);
  const [positionSizeUsd, setPositionSize] = useState(config.positionSizeUsd);
  const [almaInstrumentMode, setAlmaInstrumentMode] = useState<"options" | "stock_long" | "stock_short" | "stock_both">(
    (config.almaInstrumentMode as "options" | "stock_long" | "stock_short" | "stock_both") ?? "options",
  );
  const [almaWatchlistText, setAlmaWatchlistText] = useState(
    (config.almaWatchlist ?? []).join(", "),
  );
  const [almaSteepSlopePct, setAlmaSteepSlope] = useState(config.almaSteepSlopePct);
  const [almaPullbackCoolDownBars, setAlmaCoolDown] = useState(
    String(config.almaPullbackCoolDownBars ?? 5),
  );
  const [almaPullbackThresholdPct, setAlmaPullbackThreshold] = useState(
    config.almaPullbackThresholdPct ?? "0.10",
  );
  const [entryRepegMax, setEntryRepegMax] = useState(config.entryRepegMax);
  const [entryRepegMaxDriftPct, setEntryRepegMaxDriftPct] = useState(
    config.entryRepegMaxDriftPct ?? "30.00",
  );
  const [defaultTarget1Pct, setDefaultTarget1] = useState(config.defaultTarget1Pct);
  const [defaultTarget2Pct, setDefaultTarget2] = useState(config.defaultTarget2Pct);
  const [defaultStopLossPct, setDefaultStopLoss] = useState(config.defaultStopLossPct);
  const [defaultTimeStopMin, setDefaultTimeStop] = useState(config.defaultTimeStopMin);
  const [almaReversalExit, setAlmaReversalExit] = useState(config.almaReversalExit);
  const [priceReversalAlmaExit, setPriceReversalAlmaExit] = useState(
    config.priceReversalAlmaExit ?? false,
  );
  const [priceReversalAlmaThresholdPct, setPriceReversalAlmaThresholdPct] = useState(
    config.priceReversalAlmaThresholdPct ?? "0.05",
  );
  const [priceReversalAlmaGraceBars, setPriceReversalAlmaGraceBars] = useState(
    String(config.priceReversalAlmaGraceBars ?? 5),
  );

  // ── Option 2: ALMA 9/39 RSI strategy ───────────────────────────────
  const [alma939InstrumentMode, setAlma939InstrumentMode] = useState<"options" | "stock_long" | "stock_short" | "stock_both">(
    (config.alma939InstrumentMode as "options" | "stock_long" | "stock_short" | "stock_both") ?? "options",
  );
  const [alma939WatchlistText, setAlma939WatchlistText] = useState(
    (config.alma939Watchlist ?? ["SPY", "QQQ"]).join(", "),
  );
  const [alma939FastLen, setAlma939FastLen] = useState(String(config.alma939FastLen ?? 9));
  const [alma939SlowLen, setAlma939SlowLen] = useState(String(config.alma939SlowLen ?? 39));
  const [alma939Offset, setAlma939Offset] = useState(String(config.alma939Offset ?? "0.85"));
  const [alma939Sigma, setAlma939Sigma] = useState(String(config.alma939Sigma ?? "6.0"));
  const [alma939UseRsiFilter, setAlma939UseRsiFilter] = useState(config.alma939UseRsiFilter ?? true);
  const [alma939RsiLen, setAlma939RsiLen] = useState(String(config.alma939RsiLen ?? 14));
  const [alma939LongRsiMin, setAlma939LongRsiMin] = useState(String(config.alma939LongRsiMin ?? "50.00"));
  const [alma939LongRsiMax, setAlma939LongRsiMax] = useState(String(config.alma939LongRsiMax ?? "72.00"));
  const [alma939ShortRsiMin, setAlma939ShortRsiMin] = useState(String(config.alma939ShortRsiMin ?? "28.00"));
  const [alma939ShortRsiMax, setAlma939ShortRsiMax] = useState(String(config.alma939ShortRsiMax ?? "50.00"));
  const [alma939UseChopFilter, setAlma939UseChopFilter] = useState(config.alma939UseChopFilter ?? true);
  const [alma939ChopLen, setAlma939ChopLen] = useState(String(config.alma939ChopLen ?? 14));
  const [alma939ChopThreshold, setAlma939ChopThreshold] = useState(String(config.alma939ChopThreshold ?? "50.00"));
  const [alma939ChopMode, setAlma939ChopMode] = useState<"below" | "above">(
    (config.alma939ChopMode as "below" | "above") ?? "below",
  );
  const [alma939UseVwapEntryFilter, setAlma939UseVwapEntryFilter] = useState(config.alma939UseVwapEntryFilter ?? true);
  const [alma939VwapLongMode, setAlma939VwapLongMode] = useState<"close" | "hl2">(
    (config.alma939VwapLongMode as "close" | "hl2") ?? "close",
  );
  const [alma939VwapShortMode, setAlma939VwapShortMode] = useState<"close" | "hl2">(
    (config.alma939VwapShortMode as "close" | "hl2") ?? "close",
  );
  const [alma939UseSessionFilter, setAlma939UseSessionFilter] = useState(config.alma939UseSessionFilter ?? true);
  const [alma939SessionStart, setAlma939SessionStart] = useState(config.alma939SessionStart ?? "09:30");
  const [alma939SessionEnd, setAlma939SessionEnd] = useState(config.alma939SessionEnd ?? "16:00");
  const [alma939UseForceClose, setAlma939UseForceClose] = useState(config.alma939UseForceClose ?? true);
  const [alma939ForceCloseHour, setAlma939ForceCloseHour] = useState(String(config.alma939ForceCloseHour ?? 15));
  const [alma939ForceCloseMinute, setAlma939ForceCloseMinute] = useState(String(config.alma939ForceCloseMinute ?? 55));
  const [alma939UseAlmaSignalExits, setAlma939UseAlmaSignalExits] = useState(config.alma939UseAlmaSignalExits ?? false);
  const [alma939UseLongCloseBelowAlma39Exit, setAlma939UseLongCloseBelowAlma39Exit] = useState(config.alma939UseLongCloseBelowAlma39Exit ?? true);
  const [alma939UseLongAlmaCrossDownExit, setAlma939UseLongAlmaCrossDownExit] = useState(config.alma939UseLongAlmaCrossDownExit ?? true);
  const [alma939UseShortCloseAboveAlma39Exit, setAlma939UseShortCloseAboveAlma39Exit] = useState(config.alma939UseShortCloseAboveAlma39Exit ?? true);
  const [alma939UseShortAlmaCrossUpExit, setAlma939UseShortAlmaCrossUpExit] = useState(config.alma939UseShortAlmaCrossUpExit ?? true);
  const [alma939UseVwapExitRules, setAlma939UseVwapExitRules] = useState(config.alma939UseVwapExitRules ?? true);
  const [alma939UseLongCloseBelowVwapExit, setAlma939UseLongCloseBelowVwapExit] = useState(config.alma939UseLongCloseBelowVwapExit ?? false);
  const [alma939UseShortCloseAboveVwapExit, setAlma939UseShortCloseAboveVwapExit] = useState(config.alma939UseShortCloseAboveVwapExit ?? false);
  const [alma939UseLongAlma9CrossBelowVwapExit, setAlma939UseLongAlma9CrossBelowVwapExit] = useState(config.alma939UseLongAlma9CrossBelowVwapExit ?? true);
  const [alma939UseShortAlma9CrossAboveVwapExit, setAlma939UseShortAlma9CrossAboveVwapExit] = useState(config.alma939UseShortAlma9CrossAboveVwapExit ?? true);
  const [alma939UseStopLoss, setAlma939UseStopLoss] = useState(config.alma939UseStopLoss ?? true);
  const [alma939SlMode, setAlma939SlMode] = useState<"fixed" | "trailing">((config.alma939SlMode as "fixed" | "trailing") ?? "fixed");
  const [alma939FixedSlPct, setAlma939FixedSlPct] = useState(String(config.alma939FixedSlPct ?? "1.00"));
  const [alma939TrailSlPct, setAlma939TrailSlPct] = useState(String(config.alma939TrailSlPct ?? "1.00"));
  const [alma939TrailUpdateMode, setAlma939TrailUpdateMode] = useState<"prev_extreme" | "curr_extreme" | "close">(
    (config.alma939TrailUpdateMode as "prev_extreme" | "curr_extreme" | "close") ?? "prev_extreme",
  );
  const [alma939UseProfitTargets, setAlma939UseProfitTargets] = useState(config.alma939UseProfitTargets ?? true);
  const [alma939UseTp1, setAlma939UseTp1] = useState(config.alma939UseTp1 ?? true);
  const [alma939Tp1Pct, setAlma939Tp1Pct] = useState(String(config.alma939Tp1Pct ?? "0.50"));
  const [alma939Tp1Qty, setAlma939Tp1Qty] = useState(String(config.alma939Tp1Qty ?? "20.00"));
  const [alma939UseTp2, setAlma939UseTp2] = useState(config.alma939UseTp2 ?? true);
  const [alma939Tp2Pct, setAlma939Tp2Pct] = useState(String(config.alma939Tp2Pct ?? "1.00"));
  const [alma939Tp2Qty, setAlma939Tp2Qty] = useState(String(config.alma939Tp2Qty ?? "20.00"));
  const [alma939UseTp3, setAlma939UseTp3] = useState(config.alma939UseTp3 ?? true);
  const [alma939Tp3Pct, setAlma939Tp3Pct] = useState(String(config.alma939Tp3Pct ?? "1.50"));
  const [alma939Tp3Qty, setAlma939Tp3Qty] = useState(String(config.alma939Tp3Qty ?? "20.00"));
  const [alma939UseTp4, setAlma939UseTp4] = useState(config.alma939UseTp4 ?? true);
  const [alma939Tp4Pct, setAlma939Tp4Pct] = useState(String(config.alma939Tp4Pct ?? "2.00"));
  const [alma939Tp4Qty, setAlma939Tp4Qty] = useState(String(config.alma939Tp4Qty ?? "20.00"));
  const [alma939UseTp5, setAlma939UseTp5] = useState(config.alma939UseTp5 ?? true);
  const [alma939Tp5Pct, setAlma939Tp5Pct] = useState(String(config.alma939Tp5Pct ?? "2.50"));
  const [alma939Tp5Qty, setAlma939Tp5Qty] = useState(String(config.alma939Tp5Qty ?? "20.00"));

  const [liveOrdersConfirmed, setLiveOrdersConfirmed] = useState(config.liveOrdersConfirmed);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const res = await fetch("/api/admin/botwick/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          mode,
          gradeFilter,
          maxRiskPerTradeUsd,
          maxStockNotionalUsd,
          maxDailyLossUsd,
          maxOpenPositions,
          maxPlanSlippagePct,
          dayTradeForceExit,
          positionSizeUsd,
          almaInstrumentMode,
          almaWatchlist: almaWatchlistText
            .split(/[,\s]+/)
            .map((t) => t.trim().toUpperCase())
            .filter(Boolean),
          almaSteepSlopePct,
          almaPullbackCoolDownBars: Number(almaPullbackCoolDownBars),
          almaPullbackThresholdPct,
          entryRepegMax,
          entryRepegMaxDriftPct,
          defaultTarget1Pct,
          defaultTarget2Pct,
          defaultStopLossPct,
          defaultTimeStopMin,
          almaReversalExit,
          priceReversalAlmaExit,
          priceReversalAlmaThresholdPct,
          priceReversalAlmaGraceBars: Number(priceReversalAlmaGraceBars),
          // Option 2 (ALMA 9/39 RSI)
          alma939InstrumentMode,
          alma939Watchlist: alma939WatchlistText
            .split(/[,\s]+/)
            .map((t) => t.trim().toUpperCase())
            .filter(Boolean),
          alma939FastLen: Number(alma939FastLen),
          alma939SlowLen: Number(alma939SlowLen),
          alma939Offset,
          alma939Sigma,
          alma939UseRsiFilter,
          alma939RsiLen: Number(alma939RsiLen),
          alma939LongRsiMin,
          alma939LongRsiMax,
          alma939ShortRsiMin,
          alma939ShortRsiMax,
          alma939UseChopFilter,
          alma939ChopLen: Number(alma939ChopLen),
          alma939ChopThreshold,
          alma939ChopMode,
          alma939UseVwapEntryFilter,
          alma939VwapLongMode,
          alma939VwapShortMode,
          alma939UseSessionFilter,
          alma939SessionStart,
          alma939SessionEnd,
          alma939UseForceClose,
          alma939ForceCloseHour: Number(alma939ForceCloseHour),
          alma939ForceCloseMinute: Number(alma939ForceCloseMinute),
          alma939UseAlmaSignalExits,
          alma939UseLongCloseBelowAlma39Exit,
          alma939UseLongAlmaCrossDownExit,
          alma939UseShortCloseAboveAlma39Exit,
          alma939UseShortAlmaCrossUpExit,
          alma939UseVwapExitRules,
          alma939UseLongCloseBelowVwapExit,
          alma939UseShortCloseAboveVwapExit,
          alma939UseLongAlma9CrossBelowVwapExit,
          alma939UseShortAlma9CrossAboveVwapExit,
          alma939UseStopLoss,
          alma939SlMode,
          alma939FixedSlPct,
          alma939TrailSlPct,
          alma939TrailUpdateMode,
          alma939UseProfitTargets,
          alma939UseTp1,
          alma939Tp1Pct,
          alma939Tp1Qty,
          alma939UseTp2,
          alma939Tp2Pct,
          alma939Tp2Qty,
          alma939UseTp3,
          alma939Tp3Pct,
          alma939Tp3Qty,
          alma939UseTp4,
          alma939Tp4Pct,
          alma939Tp4Qty,
          alma939UseTp5,
          alma939Tp5Pct,
          alma939Tp5Qty,
          liveOrdersConfirmed,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      router.refresh();
    });
  }

  async function ingest() {
    setErr(null);
    setIngestResult(null);
    start(async () => {
      const res = await fetch("/api/admin/botwick/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Ingest failed (${res.status})`);
        return;
      }
      setIngestResult(j.summary as IngestResult);
      router.refresh();
    });
  }

  async function tick() {
    setErr(null);
    setTickResult(null);
    start(async () => {
      const res = await fetch("/api/admin/botwick/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `Tick failed (${res.status})`);
        return;
      }
      setTickResult(j.summary as TickResult);
      router.refresh();
    });
  }

  async function resetArchive() {
    if (
      !window.confirm(
        "Reset & Archive bot state?\n\n• Activity tape will be cleared (snapshot moved to ARCHIVE).\n• ALMA READY states will be wiped (fresh start).\n• Non-live trades (pending/armed/closed/cancelled) will be archived.\n• Bot will be DISABLED (enabled=false). Kill-switch + live-orders confirmation will be reset.\n• LIVE trades (open/working/closing) will be preserved and continue to be managed.\n\nYou'll need to re-toggle Enabled to resume trading.\n\nProceed?",
      )
    ) {
      return;
    }
    setErr(null);
    start(async () => {
      const res = await fetch("/api/admin/botwick/reset-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `Reset & Archive failed (${res.status})`);
        return;
      }
      const j = await res.json().catch(() => ({}));
      window.alert(
        `Reset & Archive complete.\n\n• ${j.archivedActions ?? 0} events archived\n• ${j.archivedTrades ?? 0} trades archived\n• ${j.clearedAlmaStates ?? 0} ALMA READY states cleared`,
      );
      router.refresh();
    });
  }

  async function kill(engage: boolean) {
    setErr(null);
    start(async () => {
      const res = await fetch("/api/admin/botwick/kill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engage,
          reason: engage ? "Admin emergency stop" : null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `Kill switch failed (${res.status})`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">BotWick — Admin Controls</h1>
          <p className="text-sm text-black/60 dark:text-white/60 mt-1">
            Status: <span className="font-mono uppercase">{status}</span>
            {" · "}Updated{" "}
            <span className="font-mono">
              {new Date(config.updatedAt).toLocaleString("en-US", {
                timeZone: "America/New_York",
              })}
            </span>
          </p>
        </div>
        {/* Kill switch */}
        {config.killSwitchEngaged ? (
          <button
            type="button"
            onClick={() => kill(false)}
            disabled={pending}
            className="px-4 py-2 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 font-semibold text-sm disabled:opacity-50"
          >
            Clear kill switch
          </button>
        ) : (
          <button
            type="button"
            onClick={() => kill(true)}
            disabled={pending}
            className="px-4 py-2 rounded border border-rose-500/50 bg-rose-500/15 text-rose-700 dark:text-rose-300 hover:bg-rose-500/25 font-bold uppercase tracking-wide text-sm disabled:opacity-50"
          >
            ⛔ Kill switch
          </button>
        )}
      </header>

      {/* Reset & Archive — admin-only, large blast radius. Wipes the visible
          tape and ALMA state but preserves live trades + audit history. */}
      <section className="rounded-lg border border-amber-500/40 bg-amber-500/[0.04] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <div className="font-semibold">Reset &amp; Archive</div>
          <p className="text-xs text-black/65 dark:text-white/65 mt-1 max-w-2xl">
            Clears the Activity tape and ALMA READY states for a fresh start. Archived events
            and trades move to the <span className="font-mono">ARCHIVE</span> tab. Live trades
            (<span className="font-mono">open / working / closing / submitting</span>) are NEVER
            archived — they continue to be managed by the bot.
          </p>
        </div>
        <button
          type="button"
          onClick={resetArchive}
          disabled={pending}
          className="px-4 py-2 rounded border border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-200 hover:bg-amber-500/25 font-semibold uppercase tracking-wide text-xs disabled:opacity-50"
        >
          BotWick Reset &amp; Archive
        </button>
      </section>

      {/* Tradier credentials — informational. Read from env at SSR time so
          the admin can verify what's set without opening Railway. */}
      <fieldset className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
        <legend className="px-2 text-xs uppercase tracking-widest text-black/55 dark:text-white/55">
          Tradier credentials
        </legend>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <CredCell label="Sandbox token" ok={creds.sandboxToken} note="TRADIER_SANDBOX_TOKEN" />
          <CredCell
            label="Sandbox account"
            ok={creds.sandboxAccount}
            note={creds.sandboxAccountMasked ?? "TRADIER_SANDBOX_ACCOUNT_ID"}
          />
          <CredCell label="Live token" ok={creds.liveToken} note="TRADIER_LIVE_TOKEN / API_KEY" />
          <CredCell
            label="Live account"
            ok={creds.liveAccount}
            note={creds.liveAccountMasked ?? "TRADIER_LIVE_ACCOUNT_ID"}
          />
        </div>
        {/* What paper mode will actually use for data. The orders side is
            always sandbox for paper — this only describes the data feed. */}
        <p className="text-xs text-black/65 dark:text-white/65">
          <span className="uppercase tracking-widest text-[10px] text-black/45 dark:text-white/45 mr-2">
            Paper data source
          </span>
          {creds.paperDataSource === "live_realtime" ? (
            <span className="text-emerald-700 dark:text-emerald-300">
              Real-time (production data feed)
            </span>
          ) : (
            <span className="text-amber-600 dark:text-amber-300">
              Sandbox (15-min delayed) — add <code>TRADIER_LIVE_TOKEN</code> or{" "}
              <code>TRADIER_API_KEY</code> to upgrade to real-time
            </span>
          )}
          <span className="block mt-1 text-[11px] text-black/45 dark:text-white/45">
            Paper-mode orders always route to sandbox. Only the data feed switches.
          </span>
        </p>
      </fieldset>

      <form onSubmit={submit} className="space-y-5">
        {/* Enable / mode */}
        <fieldset className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-4">
          <legend className="px-2 text-xs uppercase tracking-widest text-black/55 dark:text-white/55">
            Master controls
          </legend>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Bot enabled</span>
              <span className="block text-xs text-black/55 dark:text-white/55">
                Master switch. When off, the runner refuses to place any orders.
                Defaults to off and resets to off any time the kill switch is
                tripped.
              </span>
            </span>
          </label>

          <div>
            <label className="text-sm font-medium">Mode</label>
            <div className="mt-1 flex gap-2">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 rounded border text-sm font-mono uppercase ${
                    mode === m
                      ? "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : "border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="text-xs text-black/55 dark:text-white/55 mt-1">
              <strong>off</strong> = no orders. <strong>paper</strong> = sandbox orders + real-time
              data (when a prod token is configured). <strong>live</strong> = real-money
              production endpoint for both data and orders. Live mode also requires the explicit
              confirmation below.
            </p>
          </div>

          {/* Day-trade force-exit — operating-mode toggle. Default ON: the
              bot is honest about being 0DTE-only. */}
          <label className="flex items-start gap-3 p-3 rounded border border-black/10 dark:border-white/10">
            <input
              type="checkbox"
              checked={dayTradeForceExit}
              onChange={(e) => setDayTradeForceExit(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="font-semibold">Day-Trade Force Exit</span>
              <span className="block text-xs text-black/65 dark:text-white/65 mt-1">
                When on (recommended), at <strong>15:55 ET</strong> the bot cancels every pending /
                armed / working trade and submits a <strong>market sell_to_close</strong> on every
                open position. Nothing rides overnight — no theta-to-zero, no pin risk, no exposure
                while you sleep. Disable only if you intend to swing trades manually.
              </span>
            </span>
          </label>

          {/* Live-orders safety rail — independent of `mode` so flipping
              mode=live for real-time data does NOT silently arm real trading
              when the OMS lands. Resets automatically on kill switch. */}
          <label
            className={`flex items-start gap-3 p-3 rounded border ${
              liveOrdersConfirmed
                ? "border-rose-500/50 bg-rose-500/5"
                : "border-black/10 dark:border-white/10"
            }`}
          >
            <input
              type="checkbox"
              checked={liveOrdersConfirmed}
              onChange={(e) => setLiveOrdersConfirmed(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="font-semibold">
                Live orders confirmed{" "}
                <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 ml-1">
                  Phase 4 gate
                </span>
              </span>
              <span className="block text-xs text-black/65 dark:text-white/65 mt-1">
                When the order management system ships, it will refuse to submit live orders
                unless this flag is true <em>and</em> mode=live <em>and</em> bot is enabled{" "}
                <em>and</em> kill switch is off. Engaging the kill switch clears this flag.
                Leave it off while you&apos;re testing Phase 3 monitoring with real-time data —
                you cannot accidentally trade live until you tick this box later.
              </span>
            </span>
          </label>
        </fieldset>

        {/* Strategy filter */}
        <fieldset className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
          <legend className="px-2 text-xs uppercase tracking-widest text-black/55 dark:text-white/55">
            Trade-plan filter
          </legend>
          <div>
            <label className="text-sm font-medium">Minimum grade to trade</label>
            <div className="mt-1 flex gap-2 flex-wrap">
              {GRADES.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGradeFilter(g)}
                  className={`px-3 py-1.5 rounded border text-sm font-mono ${
                    gradeFilter === g
                      ? "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : "border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
            <p className="text-xs text-black/55 dark:text-white/55 mt-1">
              Bot only acts on plans graded at or above this threshold. <strong>ALL</strong> takes everything (not recommended).
            </p>
          </div>
        </fieldset>

        {/* Position size (intent — used by signal strategies that size themselves) */}
        <fieldset className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-2">
          <legend className="px-2 text-xs uppercase tracking-widest text-black/55 dark:text-white/55">
            Position size
          </legend>
          <label className="block max-w-xs">
            <span className="text-sm font-medium">Intent per trade ($)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={positionSizeUsd}
              onChange={(e) => setPositionSize(e.target.value)}
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
            />
          </label>
          <p className="text-xs text-black/55 dark:text-white/55">
            Target dollar amount per trade — the single golden source for sizing across every
            strategy. At submit time the OMS computes
            <span className="font-mono"> qty = floor(min(positionSize, maxRiskPerTrade) / (live_mid × 100))</span>
            {" "}against the live mid (not the plan mid). Max Risk Per Trade clamps this — increase
            it too if you raise intent and want bigger fills.
          </p>
        </fieldset>

        {/* ALMA × VWAP settings (only relevant when Option 1 is active).
            Collapsible — collapsed by default. */}
        <details className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3 [&>summary]:cursor-pointer">
          <summary className="text-xs uppercase tracking-widest text-black/55 dark:text-white/55 select-none">
            ALMA × VWAP settings · Option 1
          </summary>
          <label className="block">
            <span className="text-sm font-medium">Instrument</span>
            <select
              value={almaInstrumentMode}
              onChange={(e) => setAlmaInstrumentMode(e.target.value as "options" | "stock_long" | "stock_short" | "stock_both")}
              className="mt-1 w-full sm:w-auto rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 text-sm"
            >
              <option value="options">Options (OTM 0DTE; long_call / long_put)</option>
              <option value="stock_long">Stock — long only (buys shares; SHORT signals skipped)</option>
              <option value="stock_short">Stock — short only (short-sells shares; LONG signals skipped; margin account required)</option>
              <option value="stock_both">Stock — long + short (buys on LONG, short-sells on SHORT; margin required)</option>
            </select>
            <span className="block text-[11px] text-black/55 dark:text-white/55 mt-1">
              Stock mode sizes against <strong>Max stock notional</strong> in Risk caps, capped further by Tradier&apos;s reported stock buying power at submit. Margin/PDT accounts under $25k get a PDT-warning tape entry on each stock entry.
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Watchlist</span>
            <input
              type="text"
              value={almaWatchlistText}
              onChange={(e) => setAlmaWatchlistText(e.target.value)}
              placeholder="SPY, QQQ, AAPL, TSLA"
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm uppercase"
            />
            <span className="block text-xs text-black/55 dark:text-white/55 mt-1">
              Comma-separated tickers the ALMA × VWAP scanner watches each tick. Up to 20.
              Only used when the ALMA strategy is active.
            </span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block">
              <span className="text-sm font-medium">Steep slope threshold (% per bar)</span>
              <input
                type="number"
                step={0.01}
                min={0}
                max={5}
                value={almaSteepSlopePct}
                onChange={(e) => setAlmaSteepSlope(e.target.value)}
                className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
              />
              <span className="block text-xs text-black/55 dark:text-white/55 mt-1">
                Minimum ALMA slope (% per 5-min bar) at cross time. Lower = more setups.
              </span>
            </label>
            <label className="block">
              <span className="text-sm font-medium">Pullback cool-down (bars)</span>
              <input
                type="number"
                step={1}
                min={0}
                max={30}
                value={almaPullbackCoolDownBars}
                onChange={(e) => setAlmaCoolDown(e.target.value)}
                className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
              />
              <span className="block text-xs text-black/55 dark:text-white/55 mt-1">
                After arming, the bot waits this many bars for a pullback. During the
                cool-down, a close crossing back through VWAP does <em>not</em> clear READY —
                whippy bars are tolerated. After cool-down, the standard close-holds guard
                resumes. Default 5 (~25 min).
              </span>
            </label>
            <label className="block">
              <span className="text-sm font-medium">Pullback band threshold (% of ALMA)</span>
              <input
                type="number"
                step={0.01}
                min={0}
                max={5}
                value={almaPullbackThresholdPct}
                onChange={(e) => setAlmaPullbackThreshold(e.target.value)}
                className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
              />
              <span className="block text-xs text-black/55 dark:text-white/55 mt-1">
                Max wick depth beyond ALMA9 that still counts as a pullback. For LONG: bar.low
                must be in <code>[ALMA × (1 − thresh/100), ALMA]</code>. Wicks deeper than this
                are treated as real reversals, not buyable dips. Default 0.10%.
              </span>
            </label>
          </div>
          <label className="flex items-start gap-3 p-3 rounded border border-black/10 dark:border-white/10">
            <input
              type="checkbox"
              checked={almaReversalExit}
              onChange={(e) => setAlmaReversalExit(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="font-semibold">ALMA reversal exit (optional)</span>
              <span className="block text-xs text-black/65 dark:text-white/65 mt-1">
                Additional exit filter for ALL open positions, not just ALMA-strategy ones.
                When ALMA(9) crosses against the position's side (LONG: ALMA back under VWAP,
                SHORT: ALMA back over VWAP), the bot submits a <strong>MARKET sell_to_close</strong>.
                Runs alongside the regular target/stop/time_stop checks — whichever fires first
                wins. Priority order: <code>stop &gt; alma_break &gt; reversal &gt; target &gt; time_stop</code>.
                Off by default.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 p-3 rounded border border-black/10 dark:border-white/10">
            <input
              type="checkbox"
              checked={priceReversalAlmaExit}
              onChange={(e) => setPriceReversalAlmaExit(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm flex-1">
              <span className="font-semibold">Price-Reversal ALMA exit (optional)</span>
              <span className="block text-xs text-black/65 dark:text-white/65 mt-1">
                Earlier signal than the standard reversal: watches the bar <em>close</em> vs
                ALMA9 directly. For LONGs, fires when <code>close &lt; ALMA × (1 − thresh/100)</code>.
                For SHORTs, when <code>close &gt; ALMA × (1 + thresh/100)</code>. Submits a
                <strong> MARKET sell_to_close</strong>. Independent of the standard reversal exit —
                both can be on at the same time. Off by default.
              </span>
              <span className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
                <label className="block">
                  <span className="text-xs font-medium">Threshold (% of ALMA)</span>
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    max={5}
                    value={priceReversalAlmaThresholdPct}
                    onChange={(e) => setPriceReversalAlmaThresholdPct(e.target.value)}
                    disabled={!priceReversalAlmaExit}
                    className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm disabled:opacity-40"
                  />
                  <span className="block text-[11px] text-black/55 dark:text-white/55 mt-1">
                    Default 0.05%. Larger = more forgiving. Smaller = exit faster.
                  </span>
                </label>
                <label className="block">
                  <span className="text-xs font-medium">Don&apos;t exit for (# of bars)</span>
                  <input
                    type="number"
                    step={1}
                    min={0}
                    max={30}
                    value={priceReversalAlmaGraceBars}
                    onChange={(e) => setPriceReversalAlmaGraceBars(e.target.value)}
                    disabled={!priceReversalAlmaExit}
                    className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm disabled:opacity-40"
                  />
                  <span className="block text-[11px] text-black/55 dark:text-white/55 mt-1">
                    Grace period after fill. Default 5 → exit becomes active on
                    the 6th 5-min bar (~25 min). Set 0 to disable the grace
                    period entirely.
                  </span>
                </label>
              </span>
            </span>
          </label>
        </details>

        {/* Option 2 — ALMA 9/39 RSI settings. Collapsed by default since this
            fieldset is large and only matters when the strategy is active. */}
        <details className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3 [&>summary]:cursor-pointer">
          <summary className="text-xs uppercase tracking-widest text-black/55 dark:text-white/55 select-none">
            ALMA 9/39 RSI settings · Option 2
          </summary>
          <p className="text-xs text-black/55 dark:text-white/55 mt-2">
            Used only when SIGNALS → Option 2 (ALMA 9/39 RSI) is active. All defaults match the
            PineScript reference. Instrument toggle below switches between trading options or
            shares of the underlying.
          </p>

          {/* Instrument mode */}
          <label className="block">
            <span className="text-sm font-medium">Instrument</span>
            <select
              value={alma939InstrumentMode}
              onChange={(e) => setAlma939InstrumentMode(e.target.value as "options" | "stock_long" | "stock_short" | "stock_both")}
              className="mt-1 w-full sm:w-auto rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 text-sm"
            >
              <option value="options">Options (OTM 0DTE; long_call / long_put)</option>
              <option value="stock_long">Stock — long only (buys shares; SHORT signals skipped)</option>
              <option value="stock_short">Stock — short only (short-sells shares; LONG signals skipped; margin account required)</option>
              <option value="stock_both">Stock — long + short (buys on LONG, short-sells on SHORT; margin required)</option>
            </select>
            <span className="block text-[11px] text-black/55 dark:text-white/55 mt-1">
              Stock mode sizes against <strong>Max stock notional</strong> in Risk caps, capped further by Tradier&apos;s reported stock buying power at submit. Margin/PDT accounts under $25k get a PDT-warning tape entry on each stock entry.
            </span>
          </label>

          {/* Watchlist + ALMA indicator */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <label className="block sm:col-span-4">
              <span className="text-sm font-medium">Watchlist</span>
              <input
                type="text"
                value={alma939WatchlistText}
                onChange={(e) => setAlma939WatchlistText(e.target.value)}
                placeholder="SPY, QQQ, AAPL, NVDA"
                className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm uppercase"
              />
              <span className="block text-[11px] text-black/55 dark:text-white/55 mt-1">
                Comma-separated tickers this strategy scans each tick. Independent from Option 1's watchlist.
              </span>
            </label>
            <label className="block">
              <span className="text-sm font-medium">ALMA fast length</span>
              <input type="number" min={2} max={200} value={alma939FastLen} onChange={(e) => setAlma939FastLen(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm" />
            </label>
            <label className="block">
              <span className="text-sm font-medium">ALMA slow length</span>
              <input type="number" min={2} max={500} value={alma939SlowLen} onChange={(e) => setAlma939SlowLen(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm" />
            </label>
            <label className="block">
              <span className="text-sm font-medium">ALMA offset</span>
              <input type="number" step={0.01} value={alma939Offset} onChange={(e) => setAlma939Offset(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm" />
            </label>
            <label className="block">
              <span className="text-sm font-medium">ALMA sigma</span>
              <input type="number" step={0.1} value={alma939Sigma} onChange={(e) => setAlma939Sigma(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm" />
            </label>
          </div>

          {/* RSI filter */}
          <fieldset className="rounded border border-black/10 dark:border-white/10 p-3 space-y-2">
            <legend className="px-2 text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
              RSI filter
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={alma939UseRsiFilter} onChange={(e) => setAlma939UseRsiFilter(e.target.checked)} />
              <span>Enable RSI band filter</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              <label className="block"><span className="text-xs">RSI length</span><input type="number" min={2} max={200} value={alma939RsiLen} onChange={(e) => setAlma939RsiLen(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-sm" /></label>
              <label className="block"><span className="text-xs">Long min</span><input type="number" step={0.1} value={alma939LongRsiMin} onChange={(e) => setAlma939LongRsiMin(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-sm" /></label>
              <label className="block"><span className="text-xs">Long max</span><input type="number" step={0.1} value={alma939LongRsiMax} onChange={(e) => setAlma939LongRsiMax(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-sm" /></label>
              <label className="block"><span className="text-xs">Short min</span><input type="number" step={0.1} value={alma939ShortRsiMin} onChange={(e) => setAlma939ShortRsiMin(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-sm" /></label>
              <label className="block"><span className="text-xs">Short max</span><input type="number" step={0.1} value={alma939ShortRsiMax} onChange={(e) => setAlma939ShortRsiMax(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-sm" /></label>
            </div>
          </fieldset>

          {/* Choppiness filter */}
          <fieldset className="rounded border border-black/10 dark:border-white/10 p-3 space-y-2">
            <legend className="px-2 text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
              Choppiness Index filter
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={alma939UseChopFilter} onChange={(e) => setAlma939UseChopFilter(e.target.checked)} />
              <span>Enable Choppiness filter</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block"><span className="text-xs">Length</span><input type="number" min={2} max={200} value={alma939ChopLen} onChange={(e) => setAlma939ChopLen(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-sm" /></label>
              <label className="block"><span className="text-xs">Threshold</span><input type="number" step={0.5} value={alma939ChopThreshold} onChange={(e) => setAlma939ChopThreshold(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-sm" /></label>
              <label className="block"><span className="text-xs">Trade when</span>
                <select value={alma939ChopMode} onChange={(e) => setAlma939ChopMode(e.target.value as "below" | "above")} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-sm">
                  <option value="below">Below threshold (trending)</option>
                  <option value="above">Above threshold (chop)</option>
                </select>
              </label>
            </div>
          </fieldset>

          {/* VWAP entry filter */}
          <fieldset className="rounded border border-black/10 dark:border-white/10 p-3 space-y-2">
            <legend className="px-2 text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
              VWAP entry filter
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={alma939UseVwapEntryFilter} onChange={(e) => setAlma939UseVwapEntryFilter(e.target.checked)} />
              <span>Require price on the right side of VWAP for entries</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block"><span className="text-xs">Long reference</span>
                <select value={alma939VwapLongMode} onChange={(e) => setAlma939VwapLongMode(e.target.value as "close" | "hl2")} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-sm">
                  <option value="close">Close above VWAP</option>
                  <option value="hl2">HL2 above VWAP</option>
                </select>
              </label>
              <label className="block"><span className="text-xs">Short reference</span>
                <select value={alma939VwapShortMode} onChange={(e) => setAlma939VwapShortMode(e.target.value as "close" | "hl2")} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-sm">
                  <option value="close">Close below VWAP</option>
                  <option value="hl2">HL2 below VWAP</option>
                </select>
              </label>
            </div>
          </fieldset>

          {/* Session + force-close */}
          <fieldset className="rounded border border-black/10 dark:border-white/10 p-3 space-y-2">
            <legend className="px-2 text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
              NY session
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={alma939UseSessionFilter} onChange={(e) => setAlma939UseSessionFilter(e.target.checked)} />
              <span>Restrict entries to NY session window</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <label className="block"><span className="text-xs">Session start (HH:MM)</span><input type="text" value={alma939SessionStart} onChange={(e) => setAlma939SessionStart(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-sm" /></label>
              <label className="block"><span className="text-xs">Session end (HH:MM)</span><input type="text" value={alma939SessionEnd} onChange={(e) => setAlma939SessionEnd(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-sm" /></label>
              <label className="block"><span className="text-xs">Force-close hour (ET)</span><input type="number" min={0} max={23} value={alma939ForceCloseHour} onChange={(e) => setAlma939ForceCloseHour(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-sm" /></label>
              <label className="block"><span className="text-xs">Force-close minute (ET)</span><input type="number" min={0} max={59} value={alma939ForceCloseMinute} onChange={(e) => setAlma939ForceCloseMinute(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-sm" /></label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={alma939UseForceClose} onChange={(e) => setAlma939UseForceClose(e.target.checked)} />
              <span>Block new entries past the force-close cutoff</span>
            </label>
          </fieldset>

          {/* ALMA exits */}
          <fieldset className="rounded border border-black/10 dark:border-white/10 p-3 space-y-2">
            <legend className="px-2 text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
              ALMA-based exits
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={alma939UseAlmaSignalExits} onChange={(e) => setAlma939UseAlmaSignalExits(e.target.checked)} />
              <span><strong>Enable ALMA signal exits</strong> (off by default)</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pl-6">
              <label className="flex items-center gap-2"><input type="checkbox" checked={alma939UseLongCloseBelowAlma39Exit} onChange={(e) => setAlma939UseLongCloseBelowAlma39Exit(e.target.checked)} /> LONG: close &lt; ALMA39</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={alma939UseLongAlmaCrossDownExit} onChange={(e) => setAlma939UseLongAlmaCrossDownExit(e.target.checked)} /> LONG: ALMA9 crosses below ALMA39</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={alma939UseShortCloseAboveAlma39Exit} onChange={(e) => setAlma939UseShortCloseAboveAlma39Exit(e.target.checked)} /> SHORT: close &gt; ALMA39</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={alma939UseShortAlmaCrossUpExit} onChange={(e) => setAlma939UseShortAlmaCrossUpExit(e.target.checked)} /> SHORT: ALMA9 crosses above ALMA39</label>
            </div>
          </fieldset>

          {/* VWAP exits */}
          <fieldset className="rounded border border-black/10 dark:border-white/10 p-3 space-y-2">
            <legend className="px-2 text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
              VWAP-based exits
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={alma939UseVwapExitRules} onChange={(e) => setAlma939UseVwapExitRules(e.target.checked)} />
              <span><strong>Enable VWAP exit rules</strong></span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pl-6">
              <label className="flex items-center gap-2"><input type="checkbox" checked={alma939UseLongCloseBelowVwapExit} onChange={(e) => setAlma939UseLongCloseBelowVwapExit(e.target.checked)} /> LONG: close &lt; VWAP</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={alma939UseShortCloseAboveVwapExit} onChange={(e) => setAlma939UseShortCloseAboveVwapExit(e.target.checked)} /> SHORT: close &gt; VWAP</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={alma939UseLongAlma9CrossBelowVwapExit} onChange={(e) => setAlma939UseLongAlma9CrossBelowVwapExit(e.target.checked)} /> LONG: ALMA9 × VWAP cross down + close confirms</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={alma939UseShortAlma9CrossAboveVwapExit} onChange={(e) => setAlma939UseShortAlma9CrossAboveVwapExit(e.target.checked)} /> SHORT: ALMA9 × VWAP cross up + close confirms</label>
            </div>
          </fieldset>

          {/* Stop loss (Phase 2: fixed or trailing) */}
          <fieldset className="rounded border border-black/10 dark:border-white/10 p-3 space-y-2">
            <legend className="px-2 text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
              Stop loss
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={alma939UseStopLoss} onChange={(e) => setAlma939UseStopLoss(e.target.checked)} />
              <span><strong>Enable stop loss</strong></span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pl-6">
              <label className="block">
                <span className="text-xs">Mode</span>
                <select
                  value={alma939SlMode}
                  onChange={(e) => setAlma939SlMode(e.target.value as "fixed" | "trailing")}
                  className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
                >
                  <option value="fixed">Fixed %</option>
                  <option value="trailing">Trailing %</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs">Fixed SL % (underlying)</span>
                <input type="number" step={0.01} min={0} value={alma939FixedSlPct} onChange={(e) => setAlma939FixedSlPct(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-sm" />
              </label>
              <label className="block">
                <span className="text-xs">Trailing SL % (underlying)</span>
                <input type="number" step={0.01} min={0} value={alma939TrailSlPct} onChange={(e) => setAlma939TrailSlPct(e.target.value)} className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono text-sm" />
              </label>
            </div>
            <label className="block pl-6">
              <span className="text-xs">Trailing anchor (which bar/price drives the trail)</span>
              <select
                value={alma939TrailUpdateMode}
                onChange={(e) => setAlma939TrailUpdateMode(e.target.value as "prev_extreme" | "curr_extreme" | "close")}
                className="mt-1 w-full sm:w-auto rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
              >
                <option value="prev_extreme">Prev bar extreme (Pine default)</option>
                <option value="curr_extreme">Current bar extreme</option>
                <option value="close">Closes only</option>
              </select>
            </label>
            <p className="text-[11px] text-black/55 dark:text-white/55">
              In trailing mode the stop only moves favorably (up for longs, down for shorts) and is
              floored at the fixed SL distance from entry until the first favorable move past it.
            </p>
          </fieldset>

          {/* Profit targets — 5 levels with per-level scale-out qty% */}
          <fieldset className="rounded border border-black/10 dark:border-white/10 p-3 space-y-2">
            <legend className="px-2 text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
              Profit targets (TP1–TP5 scale-out)
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={alma939UseProfitTargets} onChange={(e) => setAlma939UseProfitTargets(e.target.checked)} />
              <span><strong>Enable profit targets</strong></span>
            </label>
            <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-end text-xs pl-6">
              <div className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45">Level</div>
              <div className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45">% from entry</div>
              <div className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45">Qty % of original</div>

              <label className="flex items-center gap-1"><input type="checkbox" checked={alma939UseTp1} onChange={(e) => setAlma939UseTp1(e.target.checked)} /> TP1</label>
              <input type="number" step={0.01} min={0} value={alma939Tp1Pct} onChange={(e) => setAlma939Tp1Pct(e.target.value)} className="rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono" />
              <input type="number" step={1} min={1} max={100} value={alma939Tp1Qty} onChange={(e) => setAlma939Tp1Qty(e.target.value)} className="rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono" />

              <label className="flex items-center gap-1"><input type="checkbox" checked={alma939UseTp2} onChange={(e) => setAlma939UseTp2(e.target.checked)} /> TP2</label>
              <input type="number" step={0.01} min={0} value={alma939Tp2Pct} onChange={(e) => setAlma939Tp2Pct(e.target.value)} className="rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono" />
              <input type="number" step={1} min={1} max={100} value={alma939Tp2Qty} onChange={(e) => setAlma939Tp2Qty(e.target.value)} className="rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono" />

              <label className="flex items-center gap-1"><input type="checkbox" checked={alma939UseTp3} onChange={(e) => setAlma939UseTp3(e.target.checked)} /> TP3</label>
              <input type="number" step={0.01} min={0} value={alma939Tp3Pct} onChange={(e) => setAlma939Tp3Pct(e.target.value)} className="rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono" />
              <input type="number" step={1} min={1} max={100} value={alma939Tp3Qty} onChange={(e) => setAlma939Tp3Qty(e.target.value)} className="rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono" />

              <label className="flex items-center gap-1"><input type="checkbox" checked={alma939UseTp4} onChange={(e) => setAlma939UseTp4(e.target.checked)} /> TP4</label>
              <input type="number" step={0.01} min={0} value={alma939Tp4Pct} onChange={(e) => setAlma939Tp4Pct(e.target.value)} className="rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono" />
              <input type="number" step={1} min={1} max={100} value={alma939Tp4Qty} onChange={(e) => setAlma939Tp4Qty(e.target.value)} className="rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono" />

              <label className="flex items-center gap-1"><input type="checkbox" checked={alma939UseTp5} onChange={(e) => setAlma939UseTp5(e.target.checked)} /> TP5</label>
              <input type="number" step={0.01} min={0} value={alma939Tp5Pct} onChange={(e) => setAlma939Tp5Pct(e.target.value)} className="rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono" />
              <input type="number" step={1} min={1} max={100} value={alma939Tp5Qty} onChange={(e) => setAlma939Tp5Qty(e.target.value)} className="rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 font-mono" />
            </div>
            <p className="text-[11px] text-black/55 dark:text-white/55">
              Each enabled level scales out its Qty % of the ORIGINAL position via MARKET sell_to_close
              when underlying reaches the % from entry. The last enabled level always full-closes the
              remainder. Stops cancel the remaining position; ALMA/VWAP exits also full-close.
            </p>
          </fieldset>
        </details>

        {/* Risk caps */}
        <fieldset className="rounded-lg border border-black/10 dark:border-white/10 p-4 grid grid-cols-2 sm:grid-cols-5 gap-4">
          <legend className="px-2 text-xs uppercase tracking-widest text-black/55 dark:text-white/55">
            Risk caps
          </legend>
          <label className="block">
            <span className="text-sm font-medium">Max risk per trade ($)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={maxRiskPerTradeUsd}
              onChange={(e) => setMaxRisk(e.target.value)}
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
            />
            <span className="block mt-1 text-[10px] text-black/45 dark:text-white/45">Used by option entries</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Max stock notional ($)</span>
            <input
              type="number"
              min={0}
              step={1}
              value={maxStockNotionalUsd}
              onChange={(e) => setMaxStockNotional(e.target.value)}
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
            />
            <span className="block mt-1 text-[10px] text-black/45 dark:text-white/45">Per-trade cap for stock modes; capped further by Tradier buying power at submit</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Max daily loss ($)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={maxDailyLossUsd}
              onChange={(e) => setMaxDaily(e.target.value)}
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Max open positions</span>
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={maxOpenPositions}
              onChange={(e) => setMaxOpen(Number(e.target.value))}
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
            />
          </label>
          <label className="block">
            <span
              className="text-sm font-medium"
              title="Max % the live option mid can deviate from the plan estimate before the bot refuses to fire."
            >
              Max plan slippage (%)
            </span>
            <input
              type="number"
              min={1}
              max={500}
              step={1}
              value={maxPlanSlippagePct}
              onChange={(e) => setMaxSlippage(e.target.value)}
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
            />
          </label>
          <label className="block">
            <span
              className="text-sm font-medium"
              title="How many limit-order re-pegs before the bot crosses the spread with a MARKET order. 0 disables re-pegging entirely."
            >
              Re-peg max
            </span>
            <input
              type="number"
              min={0}
              max={5}
              step={1}
              value={entryRepegMax}
              onChange={(e) => setEntryRepegMax(Number(e.target.value))}
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
            />
          </label>
          <label className="block">
            <span
              className="text-sm font-medium"
              title="Maximum percent the live mid may be ABOVE the original signal mid (for buys) before the re-peg abandons the trade. A cheaper live mid is always allowed. 30% is reasonable for 0DTE; setting very high effectively disables."
            >
              Re-peg drift cap (%)
            </span>
            <input
              type="number"
              min={0}
              max={1000}
              step={5}
              value={entryRepegMaxDriftPct}
              onChange={(e) => setEntryRepegMaxDriftPct(e.target.value)}
              className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
            />
            <span className="block text-[11px] text-black/55 dark:text-white/55 mt-1">
              If the option mid has run more than this % above the original signal mid, the re-peg
              abandons instead of chasing (asymmetric — cheaper is always fine).
            </span>
          </label>
        </fieldset>

        {/* Default exits — safety net applied when a trade's AST doesn't
            specify its own. ALMA × VWAP trades always use these; plan-based
            trades use them only for branches the parser missed. */}
        <fieldset className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
          <legend className="px-2 text-xs uppercase tracking-widest text-black/55 dark:text-white/55">
            Default exits
          </legend>
          <p className="text-xs text-black/65 dark:text-white/65">
            Safety-net exits applied to any trade whose plan-supplied AST is missing the
            corresponding branch. ALMA × VWAP trades always use these (the strategy doesn&apos;t
            emit per-trade exits). Plan-based trades inherit their plan&apos;s explicit
            target/stop/time when the parser recognised them, falling back to these defaults
            otherwise.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="block">
              <span className="text-sm font-medium">Target 1 (% premium)</span>
              <input
                type="number"
                min={1}
                max={500}
                step={1}
                value={defaultTarget1Pct}
                onChange={(e) => setDefaultTarget1(e.target.value)}
                className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Target 2 (% premium)</span>
              <input
                type="number"
                min={1}
                max={1000}
                step={1}
                value={defaultTarget2Pct}
                onChange={(e) => setDefaultTarget2(e.target.value)}
                className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Stop loss (% premium)</span>
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={defaultStopLossPct}
                onChange={(e) => setDefaultStopLoss(e.target.value)}
                className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Time stop (min after signal)</span>
              <input
                type="number"
                min={5}
                max={390}
                step={5}
                value={defaultTimeStopMin}
                onChange={(e) => setDefaultTimeStop(Number(e.target.value))}
                className="mt-1 w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-sm"
              />
            </label>
          </div>
        </fieldset>

        {err && (
          <p className="text-sm text-rose-500" role="alert">
            {err}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </form>

      {/* Ingest panel — runs the parser + v1 risk gates against the latest
          research post. Safe to click repeatedly; ingest dedups against any
          non-terminal bot_trades. */}
      <fieldset className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
        <legend className="px-2 text-xs uppercase tracking-widest text-black/55 dark:text-white/55">
          Plan ingest (ghost mode)
        </legend>
        <p className="text-sm text-black/65 dark:text-white/65">
          Parse the latest research post&apos;s trade plans, run static risk gates, and write events
          to the live tape. <strong>No orders are placed</strong> — this only populates the bot&apos;s
          intent queue so you can verify it understands each plan.
        </p>
        <button
          type="button"
          onClick={ingest}
          disabled={pending}
          className="px-4 py-2 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 font-semibold text-sm disabled:opacity-50"
        >
          {pending ? "Ingesting…" : "Ingest latest post"}
        </button>
        {ingestResult && (
          <div className="text-xs font-mono mt-2 text-black/70 dark:text-white/70">
            Post day <strong>{ingestResult.postDay}</strong> · considered {ingestResult.considered} · inserted {ingestResult.inserted} · skipped {ingestResult.skipped.length}
            {ingestResult.skipped.length > 0 && (
              <ul className="mt-1 list-disc pl-5 space-y-0.5">
                {ingestResult.skipped.slice(0, 10).map((s, i) => (
                  <li key={i} className="text-black/55 dark:text-white/55">
                    {s.ticker} — <span className="uppercase tracking-wider text-[10px] text-black/45 dark:text-white/45">{s.code}</span> · {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </fieldset>

      {/* Auto-tick (Railway cron). Bearer-authed endpoint that ANY scheduled
          job can hit every minute. The actual schedule lives in Railway's
          cron service config; this panel just verifies the secret is set
          and provides the exact command. */}
      <fieldset className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
        <legend className="px-2 text-xs uppercase tracking-widest text-black/55 dark:text-white/55">
          Auto-tick (cron)
        </legend>
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`h-2 w-2 rounded-full ${creds.cronTokenSet ? "bg-emerald-500" : "bg-zinc-500/60"}`}
            aria-hidden="true"
          />
          <span>
            BOTWICK_CRON_TOKEN is{" "}
            <span className={creds.cronTokenSet ? "text-emerald-700 dark:text-emerald-300 font-semibold" : "text-amber-600 dark:text-amber-300 font-semibold"}>
              {creds.cronTokenSet ? "set" : "not set"}
            </span>
          </span>
        </div>
        {!creds.cronTokenSet && (
          <p className="text-xs text-black/65 dark:text-white/65">
            Generate a 32-byte random token and add{" "}
            <code className="px-1">BOTWICK_CRON_TOKEN=&lt;value&gt;</code> to Railway env.
            Until then the cron endpoint returns 500.
          </p>
        )}
        <details className="text-xs text-black/75 dark:text-white/75">
          <summary className="cursor-pointer font-semibold">Railway cron setup (one-time)</summary>
          <ol className="mt-2 list-decimal pl-5 space-y-1">
            <li>Railway dashboard → your project → <strong>+ New</strong> → <strong>Empty service</strong> → name it <code>botwick-cron</code>.</li>
            <li>In the new service: <strong>Settings → Deploy → Custom Start Command</strong>:
              <pre className="bg-black/[0.04] dark:bg-white/[0.04] rounded p-2 mt-1 overflow-x-auto">curl -fsS -X POST -H &quot;Authorization: Bearer $BOTWICK_CRON_TOKEN&quot; https://www.tradezerodte.com/api/cron/botwick/tick</pre>
            </li>
            <li><strong>Settings → Cron Schedule</strong>: <code>* 13-19 * * 1-5</code> &nbsp; (every minute, 09:30–16:00 ET ≈ 13:30–20:00 UTC year-round; pick whichever cron syntax Railway accepts).</li>
            <li>In <strong>Variables</strong>: paste the same <code>BOTWICK_CRON_TOKEN</code> value the main service has.</li>
            <li>Deploy. The endpoint is bearer-auth + market-hours-gated, so out-of-hours pings cost nothing.</li>
          </ol>
          <p className="mt-2">
            Manual sanity-check command:
            <code className="block bg-black/[0.04] dark:bg-white/[0.04] rounded p-2 mt-1 overflow-x-auto">
              curl -i -X POST -H &quot;Authorization: Bearer $TOKEN&quot; https://www.tradezerodte.com/api/cron/botwick/tick
            </code>
          </p>
        </details>
      </fieldset>

      {/* Monitor tick — pulls live Tradier data, evaluates entry conditions
          against pending trades, transitions matches to signal_armed. */}
      <fieldset className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
        <legend className="px-2 text-xs uppercase tracking-widest text-black/55 dark:text-white/55">
          Monitor tick (Phase 3a)
        </legend>
        <p className="text-sm text-black/65 dark:text-white/65">
          Run ONE monitoring pass: for every ticker with a pending trade, pull a live Tradier quote
          + 5-min bars, build market state, evaluate the entry condition, and transition matches to
          <code className="px-1">signal_armed</code>. <strong>Still no orders</strong> — that&apos;s
          Phase 3b/4. Requires <code className="px-1">TRADIER_SANDBOX_TOKEN</code> (paper) or{" "}
          <code className="px-1">TRADIER_LIVE_TOKEN</code> (live) in env.
        </p>
        <button
          type="button"
          onClick={tick}
          disabled={pending}
          className="px-4 py-2 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 font-semibold text-sm disabled:opacity-50"
        >
          {pending ? "Ticking…" : "Run monitoring tick"}
        </button>
        {tickResult && (
          <div className="text-xs font-mono mt-2 text-black/70 dark:text-white/70 space-y-2">
            <div>
              mode={tickResult.mode} · pending={tickResult.pendingCount} · tickers={tickResult.tickersConsidered} · fired=
              {tickResult.trades.filter((t) => t.outcome === "fired").length} · armed=
              {tickResult.trades.filter((t) => t.outcome === "armed" || t.outcome === "armed_no_recheck").length} · submitted=
              {(tickResult.submitted ?? []).filter((s) => s.outcome === "submitted").length} · exits=
              {(tickResult.exits ?? []).filter((e) => e.outcome.startsWith("fired_")).length} · filled=
              {(tickResult.reconciled ?? []).filter((r) => r.filled).length} · errors={tickResult.errors.length}
            </div>
            {tickResult.trades.length > 0 && (
              <ul className="list-disc pl-5 space-y-0.5">
                {tickResult.trades.slice(0, 20).map((t) => (
                  <li
                    key={t.tradeId}
                    className={
                      t.outcome === "fired"
                        ? "text-emerald-700 dark:text-emerald-300 font-semibold"
                        : t.outcome === "armed" || t.outcome === "armed_no_recheck"
                          ? "text-amber-600 dark:text-amber-300"
                          : "text-black/55 dark:text-white/55"
                    }
                  >
                    {t.ticker} → {t.outcome}
                    {t.reason ? ` (${t.reason})` : ""}
                  </li>
                ))}
              </ul>
            )}
            {tickResult.errors.length > 0 && (
              <ul className="list-disc pl-5 space-y-0.5 text-rose-500">
                {tickResult.errors.map((e, i) => (
                  <li key={i}>
                    {e.ticker} — <span className="uppercase tracking-wider text-[10px]">{e.code}</span> · {e.reason}
                  </li>
                ))}
              </ul>
            )}
            {tickResult.submitted && tickResult.submitted.length > 0 && (
              <div>
                <div className="uppercase tracking-widest text-[10px] text-black/55 dark:text-white/55 mb-1">
                  OMS — submit
                </div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {tickResult.submitted.map((s) => (
                    <li
                      key={s.tradeId}
                      className={
                        s.outcome === "submitted"
                          ? "text-emerald-700 dark:text-emerald-300"
                          : s.outcome === "blocked"
                            ? "text-amber-600 dark:text-amber-300"
                            : "text-rose-500"
                      }
                    >
                      {s.ticker} → {s.outcome}
                      {s.orderId ? ` (order ${s.orderId} @ ${s.price})` : s.reason ? ` (${s.reason})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {tickResult.exits && tickResult.exits.length > 0 && (
              <div>
                <div className="uppercase tracking-widest text-[10px] text-black/55 dark:text-white/55 mb-1">
                  OMS — exits
                </div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {tickResult.exits.map((e) => {
                    const fired = e.outcome.startsWith("fired_");
                    const stopFired = e.outcome === "fired_stop";
                    return (
                      <li
                        key={e.tradeId}
                        className={
                          stopFired
                            ? "text-rose-500 font-semibold"
                            : fired
                              ? "text-emerald-700 dark:text-emerald-300 font-semibold"
                              : "text-black/55 dark:text-white/55"
                        }
                      >
                        {e.ticker} → {e.outcome}
                        {e.reason ? ` (${e.reason})` : ""}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {tickResult.reconciled && tickResult.reconciled.length > 0 && (
              <div>
                <div className="uppercase tracking-widest text-[10px] text-black/55 dark:text-white/55 mb-1">
                  OMS — reconcile
                </div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {tickResult.reconciled.map((r) => {
                    const isClosed = r.newStatus === "closed";
                    const pnl = r.realizedPnlUsd;
                    const pnlSign = pnl != null && pnl >= 0 ? "+" : "";
                    return (
                      <li
                        key={r.tradeId}
                        className={
                          isClosed
                            ? (pnl ?? 0) >= 0
                              ? "text-emerald-700 dark:text-emerald-300 font-semibold"
                              : "text-rose-500 font-semibold"
                            : r.filled
                              ? "text-emerald-700 dark:text-emerald-300 font-semibold"
                              : "text-black/55 dark:text-white/55"
                        }
                      >
                        {r.ticker} [{r.phase ?? "?"}] — tradier:{r.tradierStatus}
                        {r.newStatus ? ` → ${r.newStatus}` : ""}
                        {pnl != null && ` · pnl ${pnlSign}$${pnl.toFixed(2)}`}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </fieldset>

      {/* Signal sandbox — pure preview, never writes anywhere. */}
      <BotWickSignalSandbox />

      {/* Audit hint */}
      <div className="rounded border border-black/10 dark:border-white/10 p-3 text-xs text-black/60 dark:text-white/60">
        Every change is logged in <code>bot_actions</code> and visible in the live tape.
        See <a href="/help" className="underline">help</a> for the full architecture + safety notes.
      </div>
    </div>
  );
}

function CredCell({ label, ok, note }: { label: string; ok: boolean; note: string }) {
  return (
    <div className="rounded border border-black/10 dark:border-white/10 p-2">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-zinc-500/50"}`}
          aria-hidden="true"
        />
        <span className="text-xs uppercase tracking-widest text-black/55 dark:text-white/55">
          {label}
        </span>
      </div>
      <div className="text-xs font-mono mt-1 text-black/70 dark:text-white/70 truncate" title={note}>
        {ok ? note : `missing: ${note}`}
      </div>
    </div>
  );
}
