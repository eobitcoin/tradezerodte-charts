import ExploreScaffold, { BlurredCard } from "./ExploreScaffold";
import type {
  InstitutionalPreview,
  InstitutionalHeadline,
} from "@/lib/explore-preview";

function fmtUsdCompact(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  if (Math.abs(x) >= 1_000_000_000) return `$${(x / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(x) >= 1_000_000) return `$${(x / 1_000_000).toFixed(1)}M`;
  return `$${x.toLocaleString()}`;
}

function fmtShares(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  if (Math.abs(x) >= 1_000_000) return `${(x / 1_000_000).toFixed(1)}M`;
  if (Math.abs(x) >= 1_000) return `${(x / 1_000).toFixed(0)}K`;
  return x.toLocaleString();
}

export default function InstitutionalPreviewView({
  preview,
  archive,
}: {
  preview: InstitutionalPreview;
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
    : "Weekly 13F-driven institutional flow scan.";

  return (
    <ExploreScaffold
      type="institutional"
      scanDay={preview.scanDay}
      title={`Institutional Flow — ${scanLabel}`}
      description={teaserDesc}
      authedPath="/research/institutional"
      runAt={preview.runAt}
      archive={archive}
    >
      <header className="space-y-2 mb-6">
        <div className="text-[10px] uppercase tracking-widest text-emerald-400">
          Institutional Flow · Weekly Scan · Public preview
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          Smart money is quietly loading {preview.stockCount}{" "}
          {preview.stockCount === 1 ? "stock" : "stocks"}
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
          <div className="text-[10px] uppercase tracking-widest text-emerald-400">
            Headline pick — fully revealed
          </div>
          <HeadlineCard stock={preview.headline} />
        </section>
      )}

      {preview.hiddenCount > 0 && (
        <section className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-white/55">
            {preview.hiddenCount} more {preview.hiddenCount === 1 ? "stock" : "stocks"} on this
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

function HeadlineCard({ stock }: { stock: InstitutionalHeadline }) {
  return (
    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.04] overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 bg-white/[0.02] border-b border-white/10">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl font-bold tracking-tight">{stock.ticker}</h2>
          <span className="text-sm text-white/70">{stock.companyName}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {stock.sector && (
            <span className="px-2 py-0.5 rounded bg-white/[0.05] text-white/65">{stock.sector}</span>
          )}
          {stock.marketCapUsdB != null && (
            <span className="text-white/55">${stock.marketCapUsdB.toFixed(1)}B mkt cap</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 px-4 py-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-widest text-white/45">Funds adding</span>
          <span className="text-base font-mono">{stock.supportingFundsCount}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-widest text-white/45">Total shares held</span>
          <span className="text-base font-mono">{fmtShares(stock.totalSharesHeld)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-widest text-white/45">Position value</span>
          <span className="text-base font-mono">{fmtUsdCompact(stock.totalSharesHeldUsd)}</span>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-white/5">
        <div className="text-[10px] uppercase tracking-widest text-white/55 mb-2">Thesis</div>
        <p className="text-sm leading-relaxed text-white/80">{stock.thesis}</p>
      </div>
    </div>
  );
}
