import ExploreScaffold, { BlurredCard } from "./ExploreScaffold";
import ResearchView from "./ResearchView";
import type { MetalsPreview } from "@/lib/explore-preview";

/**
 * Public preview view for /explore/metals/[scanDay].
 *
 * Reveals one headline metals ticker fully (markdown body + all charts),
 * then renders `hiddenCount` blurred placeholders for the other metals
 * tickers covered on the same scan_day. The placeholders carry NO
 * identifying info — same security model as InstitutionalPreviewView.
 *
 * Members hit the BlurredCards or the CTA → /signup → /research/metals
 * for the full set.
 */
export default function MetalsPreviewView({
  preview,
  archive,
}: {
  preview: MetalsPreview;
  archive: Array<{ scanDay: string; href: string; label: string }>;
}) {
  const scanLabel = new Date(`${preview.scanDay}T12:00:00Z`).toLocaleDateString(
    undefined,
    { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  );
  const teaser = preview.headline
    ? (preview.headline.headline || preview.headline.title).slice(0, 180)
    : "Weekly metals research — GLD, SLV, GDX, GDXJ, CPER, PPLT, NEM, FCX.";

  return (
    <ExploreScaffold
      type="metals"
      scanDay={preview.scanDay}
      title={`Metals Research — ${scanLabel}`}
      description={teaser}
      authedPath="/research/metals"
      runAt={preview.runAt}
      archive={archive}
    >
      <header className="space-y-2 mb-6">
        <div className="text-[10px] uppercase tracking-widest text-amber-400">
          Metals Research · Weekly · Public preview
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          {preview.totalTickerCount}{" "}
          {preview.totalTickerCount === 1 ? "metals ticker" : "metals tickers"}{" "}
          covered this week
        </h1>
        <div className="text-xs text-white/55">Scan day · {scanLabel}</div>
      </header>

      {preview.headline && (
        <section className="space-y-3 mb-8">
          <div className="text-[10px] uppercase tracking-widest text-amber-400">
            Headline pick — fully revealed
          </div>
          {/* ResearchView renders body_md + images in the same shape
              members see on the authenticated route. The headline post is
              an intentional full reveal — same content as /research/metals,
              just for one ticker per week. */}
          <ResearchView post={preview.headline} />
        </section>
      )}

      {preview.hiddenCount > 0 && (
        <section className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-white/55">
            {preview.hiddenCount} more{" "}
            {preview.hiddenCount === 1 ? "ticker" : "tickers"} on this scan ·
            members-only
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: preview.hiddenCount }).map((_, i) => (
              <li key={i}>
                <BlurredCard />
              </li>
            ))}
          </ul>
        </section>
      )}
    </ExploreScaffold>
  );
}
