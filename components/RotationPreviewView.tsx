import ExploreScaffold, { BlurredCard } from "./ExploreScaffold";
import type {
  SectorRotationPreview,
  SectorRotationHeadline,
} from "@/lib/explore-preview";

function fmtPct(x: number | null | undefined, signed = false): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const sign = signed && x > 0 ? "+" : "";
  return `${sign}${x.toFixed(1)}%`;
}

function directionLabel(d: string): { label: string; tone: "good" | "bad" | "neutral" } {
  if (d === "turning_positive") return { label: "Turning positive ↗", tone: "good" };
  if (d === "turning_negative") return { label: "Turning negative ↘", tone: "bad" };
  if (d === "stable_positive") return { label: "Stable positive", tone: "neutral" };
  return { label: "Stable negative", tone: "neutral" };
}

export default function RotationPreviewView({
  preview,
  archive,
}: {
  preview: SectorRotationPreview;
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
    : "Weekly sector rotation scan — leadership flips before they hit headlines.";

  return (
    <ExploreScaffold
      type="sector-rotation"
      scanDay={preview.scanDay}
      title={`Sector Rotation — ${scanLabel}`}
      description={teaserDesc}
      authedPath="/research/rotation"
      runAt={preview.runAt}
      archive={archive}
    >
      <header className="space-y-2 mb-6">
        <div className="text-[10px] uppercase tracking-widest text-sky-400">
          Sector Rotation Detector · Weekly Scan · Public preview
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          {preview.rotatingCount} {preview.rotatingCount === 1 ? "sector is" : "sectors are"}{" "}
          rotating · {preview.sectorCount - preview.rotatingCount} stable
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
          <div className="text-[10px] uppercase tracking-widest text-sky-400">
            Headline rotation — fully revealed
          </div>
          <HeadlineCard sector={preview.headline} />
        </section>
      )}

      {preview.hiddenCount > 0 && (
        <section className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-white/55">
            {preview.hiddenCount} more {preview.hiddenCount === 1 ? "sector" : "sectors"} on this
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

function HeadlineCard({ sector }: { sector: SectorRotationHeadline }) {
  const d = directionLabel(sector.rotationDirection);
  return (
    <div className="rounded-lg border border-sky-500/40 bg-sky-500/[0.04] overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 bg-white/[0.02] border-b border-white/10">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl font-bold tracking-tight">{sector.sectorName}</h2>
          <span className="font-mono text-sm text-white/65">{sector.sectorEtf}</span>
        </div>
        <span
          className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded ${
            d.tone === "good"
              ? "bg-emerald-500/15 text-emerald-300"
              : d.tone === "bad"
                ? "bg-rose-500/15 text-rose-300"
                : "bg-white/[0.05] text-white/55"
          }`}
        >
          {d.label}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 px-4 py-3 text-sm">
        <Metric label="RS · now" value={fmtPct(sector.relativeStrength, true)} />
        <Metric label="RS · 1 yr ago" value={fmtPct(sector.relativeStrengthPriorYear, true)} />
        <Metric label="Top ETF (by 10d flow)" value={sector.topEtfTicker ?? "—"} />
      </div>

      <div className="px-4 py-3 border-t border-white/5">
        <div className="text-[10px] uppercase tracking-widest text-white/55 mb-2">Thesis</div>
        <p className="text-sm leading-relaxed text-white/80">{sector.thesis}</p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-white/45">{label}</span>
      <span className="text-base font-mono">{value}</span>
    </div>
  );
}
