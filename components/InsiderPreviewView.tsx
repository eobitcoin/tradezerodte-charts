import ExploreScaffold, { BlurredCard } from "./ExploreScaffold";
import type { InsiderPreview, InsiderHeadline } from "@/lib/explore-preview";

function fmtUsd(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(2)}M`;
  if (x >= 1_000) return `$${(x / 1_000).toFixed(0)}K`;
  return `$${x.toLocaleString()}`;
}

function fmtShares(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toLocaleString();
}

export default function InsiderPreviewView({
  preview,
  archive,
}: {
  preview: InsiderPreview;
  archive: Array<{ scanDay: string; href: string; label: string }>;
}) {
  const scanLabel = new Date(`${preview.scanDay}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <ExploreScaffold
      type="insider"
      scanDay={preview.scanDay}
      title={`Insider Buys — ${scanLabel}`}
      description={`Daily SEC Form 4 scan. ${preview.buyCount} qualifying open-market buys — the headline pick is fully revealed; the rest are members-only.`}
      authedPath="/insider"
      runAt={preview.runAt}
      archive={archive}
    >
      <header className="space-y-2 mb-6">
        <div className="text-[10px] uppercase tracking-widest text-emerald-400">
          Insider Buys (SEC Form 4) · Daily Scan · Public preview
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          {preview.buyCount} insider {preview.buyCount === 1 ? "buy" : "buys"} on {scanLabel}
        </h1>
        <div className="text-xs text-white/55">Form 4 filings since the prior session close</div>
      </header>

      {preview.headline && (
        <section className="space-y-3 mb-6">
          <div className="text-[10px] uppercase tracking-widest text-emerald-400">
            Largest buy of the day — fully revealed
          </div>
          <HeadlineCard buy={preview.headline} />
        </section>
      )}

      {preview.hiddenCount > 0 && (
        <section className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-white/55">
            {preview.hiddenCount} more {preview.hiddenCount === 1 ? "buy" : "buys"} on this
            scan · members-only
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: preview.hiddenCount }).map((_, i) => (
              <BlurredCard key={i} />
            ))}
          </div>
        </section>
      )}
    </ExploreScaffold>
  );
}

function HeadlineCard({ buy }: { buy: InsiderHeadline }) {
  return (
    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.04] overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 bg-white/[0.02] border-b border-white/10">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl font-bold tracking-tight">{buy.ticker}</h2>
          {buy.insiderName && <span className="text-sm text-white/70">{buy.insiderName}</span>}
          {buy.position && (
            <span className="px-2 py-0.5 rounded bg-white/[0.05] text-white/65 text-xs">
              {buy.position}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 px-4 py-3 text-sm">
        <Metric label="Total value" value={fmtUsd(buy.totalValueUsd)} tone="good" />
        <Metric label="Shares" value={fmtShares(buy.shares)} />
        <Metric label="Filed" value={buy.filingDate ?? "—"} />
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-white/45">{label}</span>
      <span className={`text-base font-mono ${tone === "good" ? "text-emerald-400" : ""}`}>
        {value}
      </span>
    </div>
  );
}
