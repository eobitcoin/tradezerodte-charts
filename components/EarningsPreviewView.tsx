import ExploreScaffold, { BlurredCard } from "./ExploreScaffold";
import type { EarningsPreview, EarningsHeadline } from "@/lib/explore-preview";

function fmtPct(x: number | null | undefined, signed = false): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const sign = signed && x > 0 ? "+" : "";
  return `${sign}${x.toFixed(1)}%`;
}

function fmtEarningsDate(d: string): string {
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  const dt = new Date(`${d}T12:00:00Z`);
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function fmtEarningsTime(t: EarningsHeadline["earningsTime"]): string {
  if (t === "bmo") return "BMO";
  if (t === "amc") return "AMC";
  return "—";
}

export default function EarningsPreviewView({
  preview,
  archive,
}: {
  preview: EarningsPreview;
  archive: Array<{ scanDay: string; href: string; label: string }>;
}) {
  const scanLabel = new Date(`${preview.scanDay}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const teaserDesc = preview.summary
    ? preview.summary.slice(0, 180).trim() + (preview.summary.length > 180 ? "…" : "")
    : "Weekly earnings whiplash scan — implied vs historical realized volatility.";

  return (
    <ExploreScaffold
      type="earnings"
      scanDay={preview.scanDay}
      title={`Earnings Whiplash — ${scanLabel}`}
      description={teaserDesc}
      authedPath="/research/earnings"
      runAt={preview.runAt}
      archive={archive}
    >
      <header className="space-y-2 mb-6">
        <div className="text-[10px] uppercase tracking-widest text-amber-400">
          Earnings Whiplash Map · Weekly Scan · Public preview
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          {preview.stockCount} earnings setups · {preview.flaggedCount} flagged as asymmetric
        </h1>
        <div className="text-xs text-white/55">Scan day · {scanLabel}</div>
      </header>

      {preview.summary && (
        <section className="prose prose-invert max-w-none text-sm mb-8">
          {preview.summary.split(/\n{2,}/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      )}

      {preview.headline && (
        <section className="space-y-3 mb-6">
          <div className="text-[10px] uppercase tracking-widest text-amber-400">
            {preview.headline.isFlagged
              ? "Flagged asymmetric setup — fully revealed"
              : "Headline pick — fully revealed"}
          </div>
          <HeadlineCard stock={preview.headline} />
        </section>
      )}

      {preview.hiddenCount > 0 && (
        <section className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-white/55">
            {preview.hiddenCount} more {preview.hiddenCount === 1 ? "setup" : "setups"} on this
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

function HeadlineCard({ stock }: { stock: EarningsHeadline }) {
  const flagged = stock.isFlagged;
  return (
    <div
      className={`rounded-lg border ${flagged ? "border-amber-500/40 bg-amber-500/[0.04]" : "border-white/15 bg-white/[0.02]"} overflow-hidden`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 bg-white/[0.02] border-b border-white/10">
        <div className="flex items-baseline gap-3">
          {flagged && (
            <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
              Flagged
            </span>
          )}
          <h2 className="text-2xl font-bold tracking-tight">{stock.ticker}</h2>
          <span className="text-sm text-white/70">{stock.companyName}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {stock.sector && (
            <span className="px-2 py-0.5 rounded bg-white/[0.05] text-white/65">{stock.sector}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 px-4 py-3 text-sm">
        <Metric
          label="Earnings"
          value={`${fmtEarningsDate(stock.earningsDate)} ${fmtEarningsTime(stock.earningsTime)}`}
        />
        <Metric label="Implied move" value={fmtPct(stock.impliedMovePct)} />
        <Metric label="Historical avg" value={fmtPct(stock.historicalAvgMovePct)} />
        <Metric
          label="IV − HV gap"
          value={fmtPct(stock.ivVsHvDeltaPct, true)}
          tone={stock.ivVsHvDeltaPct != null && stock.ivVsHvDeltaPct < 0 ? "good" : undefined}
        />
      </div>

      {flagged && stock.flagReason && (
        <div className="px-4 py-3 border-t border-white/5 bg-amber-500/[0.04]">
          <div className="text-[10px] uppercase tracking-widest text-amber-300 mb-1">Why flagged</div>
          <p className="text-sm leading-relaxed">{stock.flagReason}</p>
        </div>
      )}

      <div className="px-4 py-3 border-t border-white/5">
        <div className="text-[10px] uppercase tracking-widest text-white/55 mb-2">Thesis</div>
        <p className="text-sm leading-relaxed text-white/80">{stock.thesis}</p>
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
