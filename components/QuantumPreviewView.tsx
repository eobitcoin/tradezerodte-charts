import ExploreScaffold, { BlurredCard } from "./ExploreScaffold";
import ResearchView from "./ResearchView";
import type { QuantumPreview } from "@/lib/explore-preview";

/**
 * Public preview view for /explore/quantum/[scanDay].
 *
 * Reveals one headline quantum ticker fully (markdown body + all charts —
 * the post includes the technical + fundamentals + valuation + catalyst
 * sections), then renders `hiddenCount` blurred placeholders for the other
 * tickers covered on the same scan_day. Members hit the BlurredCards or
 * the CTA → /signup → /research/quantum for the full set.
 *
 * Same security model as InstitutionalPreviewView / MetalsPreviewView:
 * blurred placeholders carry no identifying info.
 */
export default function QuantumPreviewView({
  preview,
  archive,
}: {
  preview: QuantumPreview;
  archive: Array<{ scanDay: string; href: string; label: string }>;
}) {
  const scanLabel = new Date(`${preview.scanDay}T12:00:00Z`).toLocaleDateString(
    undefined,
    { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  );
  const teaser = preview.headline
    ? (preview.headline.headline || preview.headline.title).slice(0, 180)
    : "Weekly quantum-computing research — technical structure, fundamentals, valuation, and catalysts for IONQ, RGTI, QBTS, QUBT, INFQ, FORM.";

  return (
    <ExploreScaffold
      type="quantum"
      scanDay={preview.scanDay}
      title={`Quantum Research — ${scanLabel}`}
      description={teaser}
      authedPath="/research/quantum"
      runAt={preview.runAt}
      archive={archive}
    >
      <header className="space-y-2 mb-6">
        <div className="text-[10px] uppercase tracking-widest text-cyan-400">
          Quantum Research · Weekly · Public preview
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          {preview.totalTickerCount}{" "}
          {preview.totalTickerCount === 1 ? "quantum ticker" : "quantum tickers"}{" "}
          covered this week
        </h1>
        <div className="text-xs text-white/55">Scan day · {scanLabel}</div>
      </header>

      {preview.headline && (
        <section className="space-y-3 mb-8">
          <div className="text-[10px] uppercase tracking-widest text-cyan-400">
            Headline pick — fully revealed
          </div>
          {/* ResearchView renders body_md + images. For quantum the body
              includes Technical + Fundamentals + Valuation + Catalysts —
              the headline post is an intentional full reveal so visitors
              can see the depth of analysis before the gate fires. */}
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
