import type { BotAction, BotAlmaState, BotConfig, BotTrade } from "@/lib/db/schema";
import type { BotStatus } from "@/lib/botwick";
import { STRATEGIES } from "@/lib/botwick/strategies";
import BotWickTapeStream from "./BotWickTapeStream";
import CloseTradeButton from "./CloseTradeButton";

type Props = {
  status: BotStatus;
  config: BotConfig;
  actions: BotAction[];
  trades: BotTrade[];
  almaStates: BotAlmaState[];
  isAdmin?: boolean;
};

const STATUS_TONE: Record<BotStatus, { label: string; dot: string; text: string }> = {
  off:     { label: "OFFLINE",        dot: "bg-zinc-500",    text: "text-zinc-400" },
  armed:   { label: "ARMED",          dot: "bg-amber-400",   text: "text-amber-300" },
  paper:   { label: "PAPER TRADING",  dot: "bg-sky-400",     text: "text-sky-300" },
  trading: { label: "LIVE TRADING",   dot: "bg-emerald-400", text: "text-emerald-300" },
  halted:  { label: "KILL SWITCH",    dot: "bg-rose-500",    text: "text-rose-300" },
};

export default function BotWickUserView({ status, config, actions, trades, almaStates, isAdmin = false }: Props) {
  const tone = STATUS_TONE[status];

  return (
    <div className="space-y-6 font-mono">
      {/* CRT-style status header */}
      <div className="rounded-lg border border-emerald-500/30 bg-black/90 px-5 py-4 shadow-inner shadow-emerald-500/10">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${tone.dot} animate-pulse`} />
            <span className={`text-lg font-bold tracking-widest ${tone.text}`}>
              BOTWICK :: {tone.label}
            </span>
          </div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-emerald-500/60 text-right">
            <div>strategy · {STRATEGIES[config.activeSignalStrategy]?.shortLabel ?? config.activeSignalStrategy}</div>
            <div className="mt-0.5">grade-filter {config.gradeFilter} · max-risk ${config.maxRiskPerTradeUsd} · max-daily ${config.maxDailyLossUsd}</div>
          </div>
        </div>
        {status === "off" && (
          <p className="mt-3 text-sm text-emerald-500/70">
            Bot is offline. The admin will arm it once the day&apos;s research is published and risk
            checks pass. Status updates appear here automatically when it wakes up.
          </p>
        )}
        {status === "halted" && (
          <p className="mt-3 text-sm text-rose-400">
            KILL SWITCH engaged — {config.killSwitchReason ?? "no reason given"}. All open
            positions are being flat-closed. Admin must clear to resume.
          </p>
        )}
        {status === "paper" && (
          <p className="mt-3 text-sm text-sky-300/80">
            Paper trading against the Tradier sandbox. Fills are simulated; nothing real is being risked.
          </p>
        )}
        {status === "trading" && (
          <p className="mt-3 text-sm text-emerald-300/80">
            Live mode active. Every order shown below routes to Tradier production.
          </p>
        )}
        {status === "armed" && (
          <p className="mt-3 text-sm text-amber-300/80">
            Armed but no mode selected. Waiting on admin to choose paper or live.
          </p>
        )}
      </div>

      {/* Two-column: active trades on the left (compact), event tape on the
          right (the main thing the user is here to watch). */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,5fr)] gap-4">
        <div className="space-y-4">
        {/* ALMA READY states — only shown when ALMA-based strategy is active
            AND there are currently armed tickers. Useful to know what the bot
            is about to do before any orders fire. */}
        {(config.activeSignalStrategy === "alma_vwap_cross" ||
          config.activeSignalStrategy === "alma_plus_plan") &&
          almaStates.length > 0 && (
            <section className="rounded-lg border border-amber-500/30 bg-black/80 p-4">
              <h2 className="text-xs uppercase tracking-[0.25em] text-amber-400/80 mb-3">
                ▸ ALMA READY · awaiting pullback
              </h2>
              <ul className="space-y-2 text-sm">
                {almaStates.map((s) => (
                  <li
                    key={s.ticker}
                    className="border border-amber-500/20 rounded px-3 py-2 bg-amber-500/[0.04]"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-amber-300 font-semibold tracking-wide">{s.ticker}</span>
                      <span className="text-[10px] uppercase tracking-widest text-amber-400/70">
                        {s.side}
                      </span>
                    </div>
                    <div className="text-xs text-amber-200/80 mt-0.5 font-mono">
                      ALMA {Number(s.almaAtCross).toFixed(2)} × VWAP {Number(s.vwapAtCross).toFixed(2)} · slope {Number(s.slopePctAtCross).toFixed(3)}%
                    </div>
                    <div className="text-[10px] text-amber-400/60 mt-0.5">
                      armed {new Date(s.readyAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

        {/* Active trades panel */}
        <section className="rounded-lg border border-emerald-500/20 bg-black/80 p-4 min-h-[18rem]">
          <h2 className="text-xs uppercase tracking-[0.25em] text-emerald-500/70 mb-3">
            ▸ Active positions
          </h2>
          {trades.length === 0 ? (
            <p className="text-sm text-emerald-500/50 italic">
              {`// no positions on the tape`}
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {trades.map((t) => {
                const legs = (t.legs as Array<Record<string, unknown>>) ?? [];
                const occ = typeof legs[0]?.occ_symbol === "string" ? (legs[0].occ_symbol as string) : null;
                const isStockLeg = legs[0]?.instrument === "stock";
                const legQty = (legs[0]?.qty as number | undefined) ?? null;
                const canManualClose = isAdmin && t.status === "open";
                return (
                <li
                  key={t.id}
                  className="border border-emerald-500/15 rounded px-3 py-2 bg-emerald-500/[0.03]"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-emerald-300 font-semibold tracking-wide">
                      {t.sourceTicker}
                    </span>
                    <div className="flex items-center gap-2">
                      {canManualClose && (
                        <CloseTradeButton tradeId={t.id} ticker={t.sourceTicker} occSymbol={occ} />
                      )}
                      <span className="text-[10px] uppercase tracking-widest text-emerald-500/60">
                        {t.status}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-emerald-400/80">
                    {t.strategy}
                    {isStockLeg && legQty != null && <> · {legQty} sh</>}
                    {!isStockLeg && occ && <> · {occ}</>}
                    {" · "}{t.mode} · grade {t.sourceGrade ?? "—"}
                  </div>
                  {(t.tradierOrderId || t.entryFillUsd) && (
                    <div className="text-[11px] mt-1 text-emerald-500/70 font-mono">
                      {t.tradierOrderId && <>order {t.tradierOrderId} </>}
                      {t.entryFillUsd && <>· fill ${Number(t.entryFillUsd).toFixed(2)}</>}
                    </div>
                  )}
                  {t.realizedPnlUsd && (
                    <div className="text-xs mt-1">
                      <span className="text-emerald-500/70">pnl </span>
                      <span
                        className={
                          Number(t.realizedPnlUsd) >= 0
                            ? "text-emerald-300"
                            : "text-rose-400"
                        }
                      >
                        {Number(t.realizedPnlUsd) >= 0 ? "+" : ""}
                        ${t.realizedPnlUsd}
                      </span>
                    </div>
                  )}
                </li>
                );
              })}
            </ul>
          )}
        </section>
        </div>

        {/* Event tape — the "Matrix" stream. Client component subscribes to
            /api/botwick/tape/stream via SSE; SSR'd `actions` seed the
            initial render so the page has content immediately. */}
        <BotWickTapeStream
          initial={actions.map((a) => ({
            id: a.id,
            ts: typeof a.ts === "string" ? a.ts : a.ts.toISOString(),
            kind: a.kind,
            severity: a.severity,
            message: a.message,
            tradeId: a.tradeId,
            data: a.data,
          }))}
          sinceIso={
            actions.length > 0
              ? (typeof actions[0].ts === "string"
                  ? actions[0].ts
                  : actions[0].ts.toISOString())
              : null
          }
        />
      </div>

      <p className="text-[10px] uppercase tracking-[0.25em] text-emerald-500/40 font-mono">
        // botwick reads research from tradezerodte.com · routes through tradier · risk-gated
      </p>
    </div>
  );
}
