import ExploreScaffold, { BlurredCard } from "./ExploreScaffold";
import TradeCard from "./TradeCard";
import type { DailyAnalysisPreview } from "@/lib/explore-preview";

export default function DailyAnalysisPreviewView({
  preview,
  archive,
}: {
  preview: DailyAnalysisPreview;
  archive: Array<{ scanDay: string; href: string; label: string }>;
}) {
  const scanLabel = new Date(`${preview.tradingDay}T12:00:00Z`).toLocaleDateString(
    undefined,
    { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  );
  const headline = preview.headlineTrade;
  const teaserDesc = headline?.rationale
    ? headline.rationale.slice(0, 180).trim() +
      (headline.rationale.length > 180 ? "…" : "")
    : `Daily 0DTE trading research for ${scanLabel}. Top trades scored A+ to F.`;

  return (
    <ExploreScaffold
      type="daily"
      scanDay={preview.tradingDay}
      title={`Daily Analysis — ${scanLabel}`}
      description={teaserDesc}
      authedPath="/"
      runAt={preview.runAt}
      archive={archive}
    >
      <header className="space-y-2 mb-6">
        <div className="text-[10px] uppercase tracking-widest text-red-400">
          Daily 0DTE Analysis · Premarket · Public preview
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          {preview.tradeCount === 0
            ? "No trades flagged for this session"
            : `${preview.tradeCount} ${preview.tradeCount === 1 ? "trade" : "trades"} graded for ${scanLabel}`}
        </h1>
        <div className="text-xs text-white/55">Trading day · {scanLabel}</div>
        {(preview.sentiment ||
          preview.bias ||
          preview.hasMarketOpen ||
          preview.hasAnalysis) && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {preview.sentiment && (
              <span
                className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded ${
                  preview.sentiment === "bullish"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : preview.sentiment === "bearish"
                      ? "bg-rose-500/15 text-rose-300"
                      : "bg-white/[0.05] text-white/65"
                }`}
              >
                {preview.sentiment}
              </span>
            )}
            {preview.bias && (
              <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-white/[0.05] text-white/65">
                {preview.bias}
              </span>
            )}
            {preview.hasMarketOpen && (
              <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-amber-500/15 text-amber-300">
                Updated · market open
              </span>
            )}
            {preview.hasAnalysis && (
              <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-amber-500/15 text-amber-300">
                Updated · post-close
              </span>
            )}
          </div>
        )}
      </header>

      {headline && (
        <section className="space-y-3 mb-6">
          <div className="text-[10px] uppercase tracking-widest text-red-400">
            Top-ranked trade — fully revealed
          </div>
          <TradeCard trade={headline} />
        </section>
      )}

      {preview.hiddenCount > 0 && (
        <section className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-white/55">
            {preview.hiddenCount} more {preview.hiddenCount === 1 ? "trade" : "trades"} on this
            scan · members-only
          </div>
          <div className="grid grid-cols-1 gap-3">
            {Array.from({ length: preview.hiddenCount }).map((_, i) => (
              <BlurredCard key={i} />
            ))}
          </div>
        </section>
      )}
    </ExploreScaffold>
  );
}
