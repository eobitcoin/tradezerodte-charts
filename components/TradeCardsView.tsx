import Link from "next/link";
import type { Post } from "@/lib/db/schema";
import { mergeDayScans, scorecardFor, type DayScorecard } from "@/lib/merge-trades";
import TradeCard from "@/components/TradeCard";

interface Props {
  tradingDay: string;
  premarket: Post | null;
  marketOpen: Post | null;
  analysis: Post | null;
  settlement: Post | null;
}

/**
 * Authenticated TRADE CARDS tab. Merges the four daily scans (premarket,
 * market_open, analysis, settlement) into a single authoritative list of
 * trade cards with scan-hierarchy status (confirmed / revised / killed /
 * added) and any post-close outcome attached.
 */
export default function TradeCardsView({
  tradingDay,
  premarket,
  marketOpen,
  analysis,
  settlement,
}: Props) {
  const { trades, hasMarketOpen, hasAnalysis, hasSettlement } = mergeDayScans({
    premarket,
    marketOpen,
    analysis,
    settlement,
  });
  const scorecard = scorecardFor(trades);
  const headPost = premarket ?? marketOpen ?? analysis;
  const sentiment = headPost?.sentiment ?? null;
  const bias = headPost?.bias ?? null;

  const scanLabel = new Date(`${tradingDay}T12:00:00Z`).toLocaleDateString(
    undefined,
    { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  );

  const livingCount = trades.filter((t) => t.status !== "killed").length;
  const killedCount = trades.length - livingCount;

  return (
    <main className="max-w-4xl lg:max-w-5xl mx-auto px-4 py-8 font-sans">
      <header className="space-y-3 mb-8">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[10px] uppercase tracking-widest text-red-400">
            Trade cards · {scanLabel}
          </div>
          <Link
            href="/learn/trade-cards"
            className="text-xs text-white/55 hover:text-white hover:underline"
          >
            Help · how to read this →
          </Link>
        </div>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">
          {trades.length === 0
            ? "No trades on the board for this session"
            : `${livingCount} live ${livingCount === 1 ? "trade" : "trades"}${
                killedCount > 0 ? ` · ${killedCount} killed` : ""
              }`}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <ScanChip label="Premarket" present={!!premarket} />
          <ScanChip label="Market open" present={hasMarketOpen} />
          <ScanChip label="Analysis" present={hasAnalysis} />
          <ScanChip label="Settlement" present={hasSettlement} />
          {sentiment && (
            <span
              className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded ${
                sentiment === "bullish"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : sentiment === "bearish"
                    ? "bg-rose-500/15 text-rose-300"
                    : "bg-white/[0.05] text-white/65"
              }`}
            >
              {sentiment}
            </span>
          )}
          {bias && (
            <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-white/[0.05] text-white/65">
              {bias}
            </span>
          )}
        </div>
        <p className="text-xs text-white/55 max-w-prose">
          Each card represents the current authoritative plan for that ticker.
          Updates from the 9:45 market-open scan and the post-close analysis
          scan are folded in here — revisions surface as an &ldquo;Updated&rdquo;
          badge with the changed fields; kills surface as a struck-through card
          with the reason.
        </p>
      </header>

      {trades.length > 0 && (
        <Scorecard scorecard={scorecard} hasAnalysis={hasAnalysis} />
      )}

      {trades.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {trades.map((t) => (
            <TradeCard key={`${t.ticker}-${t.source}`} trade={t} />
          ))}
        </div>
      )}

      {trades.length === 0 && (
        <div className="rounded border border-white/10 bg-white/[0.02] p-6 text-sm text-white/65">
          The premarket scan hasn&apos;t published any trades for this session
          yet. Trade cards populate as soon as the routine writes its first
          post.
        </div>
      )}
    </main>
  );
}

function Scorecard({
  scorecard,
  hasAnalysis,
}: {
  scorecard: DayScorecard;
  hasAnalysis: boolean;
}) {
  if (!scorecard.hasOutcomes) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 mb-6 text-xs text-white/55 flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        <span>
          {hasAnalysis
            ? "Awaiting outcome stamps from the post-close analysis scan."
            : "End-of-day scorecard will appear here once the analysis scan publishes (post-close)."}
        </span>
      </div>
    );
  }

  const netTone =
    scorecard.netPnlPct > 0
      ? "text-emerald-300"
      : scorecard.netPnlPct < 0
        ? "text-rose-300"
        : "text-white/70";
  const winRatePct =
    scorecard.winRate != null ? `${Math.round(scorecard.winRate * 100)}%` : "—";

  return (
    <div className="rounded-lg border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent px-4 py-4 mb-6">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-widest text-white/45">
            Session
          </span>
          <span className={`text-2xl font-bold font-mono ${netTone}`}>
            {scorecard.netPnlPct > 0 ? "+" : ""}
            {scorecard.netPnlPct.toFixed(0)}%
          </span>
          <span className="text-[10px] uppercase tracking-widest text-white/45 ml-1">
            net P&amp;L
          </span>
        </div>
        <ScoreChip label="W" value={scorecard.wins} tone="good" />
        <ScoreChip label="L" value={scorecard.losses} tone="bad" />
        {scorecard.noFills > 0 && (
          <ScoreChip label="No fill" value={scorecard.noFills} tone="neutral" />
        )}
        {scorecard.timeStops > 0 && (
          <ScoreChip label="Time stop" value={scorecard.timeStops} tone="warn" />
        )}
        {scorecard.manualExits > 0 && (
          <ScoreChip
            label="Manual"
            value={scorecard.manualExits}
            tone="neutral"
          />
        )}
        {scorecard.killed > 0 && (
          <ScoreChip label="Killed" value={scorecard.killed} tone="bad" />
        )}
        <div className="flex items-baseline gap-2 ml-auto">
          <span className="text-[10px] uppercase tracking-widest text-white/45">
            Win rate
          </span>
          <span className="text-base font-bold font-mono text-white/85">
            {winRatePct}
          </span>
        </div>
      </div>
      {scorecard.resolved < scorecard.total && (
        <div className="text-[11px] text-white/45 mt-2">
          {scorecard.resolved} of {scorecard.total} trades resolved · remainder
          still awaiting outcome
        </div>
      )}
    </div>
  );
}

function ScoreChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "bad" | "neutral" | "warn";
}) {
  const cls =
    tone === "good"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : tone === "bad"
        ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
        : tone === "warn"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
          : "border-white/15 bg-white/[0.04] text-white/65";
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 text-xs px-2 py-0.5 rounded border ${cls}`}
    >
      <span className="font-mono font-bold">{value}</span>
      <span className="text-[10px] uppercase tracking-widest opacity-80">
        {label}
      </span>
    </span>
  );
}

function ScanChip({ label, present }: { label: string; present: boolean }) {
  return (
    <span
      className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${
        present
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-white/10 bg-white/[0.02] text-white/40"
      }`}
    >
      {present ? "✓ " : "○ "}
      {label}
    </span>
  );
}
