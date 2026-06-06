import Link from "next/link";
import { renderMarkdown, extractSection } from "@/lib/markdown";
import OptionsSubNav from "@/components/OptionsSubNav";
import { legsToUrlParams } from "@/lib/earnings-trade-builder";
import type {
  OptionsEdgeScan,
  OptionsEdgeAnomaly,
} from "@/lib/db/schema";

/**
 * Renders one published Options Edge scan post. Layout:
 *   1. Header — title + scan date + run-at timestamp
 *   2. Routine-written prose summary (markdown)
 *   3. Ranked anomaly cards — each shows ticker + metric + z-score +
 *      suggested strategy + thesis + surface mini-table
 *   4. Footer link to the archive
 *
 * Used by both /research/options-edge (latest) and
 * /research/options-edge/[scanDay] (specific scan).
 */

interface Props {
  scan: OptionsEdgeScan;
  archive: Array<{ scanDay: string }>;
}

const METRIC_LABEL: Record<OptionsEdgeAnomaly["metric"], string> = {
  atm_iv_rank: "ATM IV rank",
  skew_z: "25Δ skew",
  term_z: "Term structure",
  iv_hv_ratio: "IV / HV",
};

const METRIC_TONE: Record<OptionsEdgeAnomaly["metric"], string> = {
  atm_iv_rank: "border-violet-500/40 text-violet-300 bg-violet-500/[0.08]",
  skew_z: "border-amber-500/40 text-amber-300 bg-amber-500/[0.08]",
  term_z: "border-cyan-500/40 text-cyan-300 bg-cyan-500/[0.08]",
  iv_hv_ratio: "border-emerald-500/40 text-emerald-300 bg-emerald-500/[0.08]",
};

function fmtIv(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}
function fmtZ(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}σ`;
}
function fmtPct(v: number | null | undefined, decimals = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(decimals)}`;
}

function fmtScanDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function directionLabel(d: "high" | "low"): string {
  return d === "high" ? "Stretched high" : "Stretched low";
}
/**
 * Convert an OptionsEdge anomaly's leg list + DTE into a Risk Graph
 * BUILD link. The anomaly's strikes are already snap-to-grid via the
 * delta-target inversion at publish time, so they should match the
 * live chain almost always. Expiry is approximated as today + DTE
 * (Risk Graph will fall back to the closest listed expiry if exact).
 *
 * For mixed-DTE structures (calendar spreads — rare), we pick the
 * earliest DTE leg as the "primary" expiry and pass all legs at that
 * expiry. The user can adjust the back-month leg manually after
 * landing in Risk Graph.
 */
function OptionsEdgeBuildButton({
  anomaly,
}: {
  anomaly: OptionsEdgeAnomaly;
}) {
  if (!anomaly.legs || anomaly.legs.length === 0) return null;
  const dtes = anomaly.legs.map((l) => l.dte).filter((d) => d > 0);
  if (dtes.length === 0) return null;
  const primaryDte = Math.min(...dtes);
  const today = new Date();
  const expiryMs = today.getTime() + primaryDte * 86_400_000;
  const expiry = new Date(expiryMs).toISOString().slice(0, 10);
  const href = `/research/risk-graph?${legsToUrlParams({
    ticker: anomaly.ticker,
    strategy: "iv-anomaly",
    expiry,
    legs: anomaly.legs.map((l) => ({
      side: l.side,
      type: l.type,
      strike: l.strike,
    })),
  })}`;
  return (
    <Link
      href={href}
      className="inline-block rounded border border-amber-500/40 bg-amber-500/[0.08] px-2.5 py-0.5 text-[10px] uppercase tracking-widest text-amber-300 hover:bg-amber-500/15 transition-colors ml-1"
      title={`Open Risk Graph with this ${anomaly.legs.length}-leg structure pre-loaded`}
    >
      Build →
    </Link>
  );
}

function directionTone(d: "high" | "low"): string {
  return d === "high"
    ? "border-rose-500/40 text-rose-300 bg-rose-500/[0.08]"
    : "border-sky-500/40 text-sky-300 bg-sky-500/[0.08]";
}

export default async function OptionsEdgeScanView({ scan, archive }: Props) {
  const anomalies = (scan.anomalies as OptionsEdgeAnomaly[]) ?? [];

  // Lift the routine-written "Anomalies" section out of the summary →
  // render it in the highlighted hero box up top, and render the
  // remaining narrative (regime context, honorable mentions, risks)
  // below without it. Falls back to plain prose if the routine didn't
  // emit the section heading (older posts before the prompt update).
  let anomaliesHtml: string | null = null;
  let narrativeHtml: string | null = null;
  if (scan.summary) {
    const { section, rest } = extractSection(scan.summary, "anomalies");
    if (section) {
      // Strip the section's own heading line — the box supplies its header.
      const sectionBody = section.replace(/^\s*#{1,6}\s+[^\n]*\n+/, "");
      anomaliesHtml = await renderMarkdown(sectionBody, []);
      narrativeHtml = await renderMarkdown(rest, []);
    } else {
      narrativeHtml = await renderMarkdown(scan.summary, []);
    }
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      <OptionsSubNav active="edge" />
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[10px] uppercase tracking-widest text-amber-400">
            Options Edge · Weekly IV anomaly scan
          </div>
          <Link
            href="/learn/options-edge"
            className="text-xs text-white/55 hover:text-white hover:underline"
          >
            Help · how to read this →
          </Link>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{scan.title}</h1>
        <p className="text-sm text-white/55">
          Scan date · {fmtScanDate(scan.scanDay)} ·{" "}
          {scan.universeSize} tickers scanned · {anomalies.length}{" "}
          {anomalies.length === 1 ? "anomaly" : "anomalies"} surfaced
        </p>
      </header>

      {/* ANOMALIES — hero box. Renders the routine-written "Anomalies"
          section (lifted from the summary) right under the headline so a
          reader can scan-and-go. The section is stripped from the
          narrative below so it isn't duplicated. Mirrors the daily
          analysis "Top Recommendations" box for visual consistency. */}
      {anomaliesHtml && (
        <section
          aria-label="Anomalies"
          className="rounded-xl border-2 border-emerald-500/50 bg-gradient-to-br from-emerald-500/[0.10] to-emerald-500/[0.02] shadow-lg shadow-emerald-900/10 p-4 sm:p-5 space-y-3"
        >
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
            <span aria-hidden="true">★</span> Anomalies
          </h2>
          <div
            className="prose prose-neutral dark:prose-invert prose-sm max-w-none dte-post"
            dangerouslySetInnerHTML={{ __html: anomaliesHtml }}
          />
        </section>
      )}

      {narrativeHtml && (
        <section
          className="prose prose-neutral dark:prose-invert max-w-none dte-post"
          dangerouslySetInnerHTML={{ __html: narrativeHtml }}
        />
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white/65">
          Ranked anomalies
        </h2>
        {anomalies.length === 0 ? (
          <p className="text-sm text-white/55 italic">
            No anomalies cleared the |z| ≥ 2.0 threshold this scan. The
            volatility surface across the universe is sitting within its
            1-year norms.
          </p>
        ) : (
          <ul className="space-y-3">
            {anomalies.map((a, i) => (
              <li
                key={`${a.ticker}-${a.metric}-${i}`}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3"
              >
                {/* Top row: ticker + metric chip + direction + z-score */}
                <div className="flex items-baseline gap-3 flex-wrap">
                  <Link
                    href={`/tickers/${a.ticker}`}
                    className="font-mono text-xl font-bold tracking-tight hover:underline"
                  >
                    {a.ticker}
                  </Link>
                  <span
                    className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${METRIC_TONE[a.metric]}`}
                  >
                    {METRIC_LABEL[a.metric]}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${directionTone(a.direction)}`}
                  >
                    {directionLabel(a.direction)}
                  </span>
                  <span className="ml-auto font-mono text-sm text-white/65">
                    z = <span className="font-bold text-white/90">{fmtZ(a.zScore)}</span>{" "}
                    · p<sub>{fmtPct(a.percentileRank)}</sub>
                  </span>
                </div>

                {/* Strategy + thesis */}
                <div>
                  <div className="text-[11px] uppercase tracking-widest text-emerald-400 mb-1">
                    Suggested
                  </div>
                  <div className="text-sm font-semibold text-white/90">
                    {a.suggestedStrategy}
                  </div>

                  {/* Concrete-strike chips. Computed deterministically from the
                      surface (delta-target inversion → snapped to grid). Buy
                      legs render emerald, sell legs render rose, matching the
                      bid/ask intuition. Hidden when no legs (older posts or
                      missing surface data). */}
                  {a.legs && a.legs.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {a.legs.map((leg, j) => (
                        <span
                          key={`${leg.side}-${leg.type}-${leg.strike}-${leg.dte}-${j}`}
                          className={[
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-mono",
                            leg.side === "buy"
                              ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/[0.08]"
                              : "border-rose-500/40 text-rose-300 bg-rose-500/[0.08]",
                          ].join(" ")}
                        >
                          <span className="uppercase tracking-wider font-semibold">
                            {leg.side === "buy" ? "Buy" : "Sell"}
                          </span>
                          <span>
                            {fmtUsd(leg.strike)}
                            {leg.type === "call" ? "C" : "P"}
                          </span>
                          <span className="text-white/40">·</span>
                          <span className="text-white/55">{leg.dte}d</span>
                        </span>
                      ))}
                      <OptionsEdgeBuildButton anomaly={a} />
                    </div>
                  )}

                  <p className="text-sm text-white/65 leading-relaxed mt-2">
                    {a.thesis}
                  </p>
                </div>

                {/* Surface mini-table */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                  <div className="rounded border border-white/10 bg-white/[0.02] px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-widest text-white/45">
                      Underlying
                    </div>
                    <div className="font-mono text-white/85 mt-0.5">
                      {fmtUsd(a.surface.underlyingPrice)}
                    </div>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.02] px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-widest text-white/45">
                      ATM IV 30d
                    </div>
                    <div className="font-mono text-white/85 mt-0.5">
                      {fmtIv(a.surface.atmIv30d)}
                    </div>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.02] px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-widest text-white/45">
                      25Δ Put
                    </div>
                    <div className="font-mono text-white/85 mt-0.5">
                      {fmtIv(a.surface.put25dIv30d)}
                    </div>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.02] px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-widest text-white/45">
                      25Δ Call
                    </div>
                    <div className="font-mono text-white/85 mt-0.5">
                      {fmtIv(a.surface.call25dIv30d)}
                    </div>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.02] px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-widest text-white/45">
                      HV 30d
                    </div>
                    <div className="font-mono text-white/85 mt-0.5">
                      {fmtIv(a.surface.hv30d)}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {archive.length > 0 && (
        <section className="border-t border-white/10 pt-6">
          <h2 className="text-sm font-bold uppercase tracking-widest text-white/65 mb-3">
            Recent scans
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {archive.slice(0, 26).map((a) => (
              <li key={a.scanDay}>
                <Link
                  href={`/research/options-edge/${a.scanDay}`}
                  className="block rounded border border-white/10 hover:border-amber-500/40 hover:bg-white/[0.03] px-3 py-2 text-xs transition-colors"
                >
                  <span className="font-mono text-white/55">{a.scanDay}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
