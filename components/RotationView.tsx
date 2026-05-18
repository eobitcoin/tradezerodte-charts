import Link from "next/link";
import type {
  SectorRotationPost,
  SectorRotationSector,
  SectorRotationEtf,
  RotationDirection,
} from "@/lib/db/schema";

function fmtPct(x: number | null | undefined, opts?: { signed?: boolean; places?: number }): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const places = opts?.places ?? 2;
  const sign = opts?.signed && x > 0 ? "+" : "";
  return `${sign}${x.toFixed(places)}%`;
}

function fmtUsdBig(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const abs = Math.abs(x);
  if (abs >= 1_000_000_000) return `${x < 0 ? "−" : ""}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${x < 0 ? "−" : ""}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${x < 0 ? "−" : ""}$${(abs / 1_000).toFixed(0)}K`;
  return `${x < 0 ? "−" : ""}$${abs.toLocaleString()}`;
}

function directionLabel(d: RotationDirection): { label: string; tone: "good" | "bad" | "neutral" } {
  if (d === "turning_positive") return { label: "Turning positive ↗", tone: "good" };
  if (d === "turning_negative") return { label: "Turning negative ↘", tone: "bad" };
  if (d === "stable_positive") return { label: "Stable positive", tone: "neutral" };
  return { label: "Stable negative", tone: "neutral" };
}

function toneClass(tone: "good" | "bad" | "neutral"): string {
  if (tone === "good") return "text-emerald-600 dark:text-emerald-400";
  if (tone === "bad") return "text-rose-500";
  return "text-black/55 dark:text-white/55";
}

export default function RotationView({ post }: { post: SectorRotationPost }) {
  const scanLabel = new Date(`${post.scanDay}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const rotating = post.sectors.filter((s) => s.isRotating);
  const stable = post.sectors.filter((s) => !s.isRotating);

  return (
    <article className="space-y-6">
      {/* Header */}
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="text-[10px] uppercase tracking-widest text-sky-600 dark:text-sky-400">
            Sector Rotation Detector · Weekly Scan
          </div>
          <Link
            href="/learn/sector-rotation"
            className="text-xs text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:underline"
          >
            Help · how to read this →
          </Link>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {rotating.length} {rotating.length === 1 ? "sector is" : "sectors are"} rotating ·{" "}
          {stable.length} stable
        </h1>
        <div className="text-xs text-black/55 dark:text-white/55">
          Scan day: {scanLabel}
          {post.runAt && (
            <>
              {" · Run at "}
              {new Date(post.runAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </>
          )}
        </div>
      </header>

      {/* Executive summary */}
      {post.summary && (
        <section className="prose prose-neutral dark:prose-invert max-w-none text-sm">
          {post.summary.split(/\n{2,}/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      )}

      {/* Rotating sectors */}
      {rotating.length > 0 && (
        <section className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-sky-600 dark:text-sky-400">
            Rotation in progress · capital is moving here first
          </div>
          {rotating.map((s) => (
            <SectorCard key={s.sectorEtf} sector={s} highlight />
          ))}
        </section>
      )}

      {/* Stable sectors — collapsible context */}
      {stable.length > 0 && (
        <section className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
            Other sectors · for context, no rotation flagged
          </div>
          <div className="rounded-lg border border-black/10 dark:border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55 bg-black/[0.02] dark:bg-white/[0.02]">
                <tr>
                  <th className="text-left px-4 py-2">Sector</th>
                  <th className="text-left px-4 py-2">ETF</th>
                  <th className="text-right px-4 py-2">30d return</th>
                  <th className="text-right px-4 py-2">vs SPY</th>
                  <th className="text-right px-4 py-2">RS · prior yr</th>
                  <th className="text-left px-4 py-2">Direction</th>
                </tr>
              </thead>
              <tbody>
                {stable.map((s) => {
                  const d = directionLabel(s.rotationDirection);
                  return (
                    <tr key={s.sectorEtf} className="border-t border-black/5 dark:border-white/5">
                      <td className="px-4 py-2">{s.sectorName}</td>
                      <td className="px-4 py-2 font-mono text-xs">{s.sectorEtf}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmtPct(s.last30DayReturnPct, { signed: true })}</td>
                      <td className={`px-4 py-2 text-right font-mono ${toneClass(s.relativeStrength != null && s.relativeStrength > 0 ? "good" : s.relativeStrength != null && s.relativeStrength < 0 ? "bad" : "neutral")}`}>
                        {fmtPct(s.relativeStrength, { signed: true })}
                      </td>
                      <td className={`px-4 py-2 text-right font-mono ${toneClass(s.relativeStrengthPriorYear != null && s.relativeStrengthPriorYear > 0 ? "good" : s.relativeStrengthPriorYear != null && s.relativeStrengthPriorYear < 0 ? "bad" : "neutral")}`}>
                        {fmtPct(s.relativeStrengthPriorYear, { signed: true })}
                      </td>
                      <td className={`px-4 py-2 text-xs ${toneClass(d.tone)}`}>{d.label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {post.sectors.length === 0 && (
        <div className="rounded-lg border border-black/10 dark:border-white/10 p-6 text-sm text-black/60 dark:text-white/60">
          No sectors qualified this scan. See methodology below.
        </div>
      )}

      {/* Methodology */}
      {post.methodology && (
        <section className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
            How this scan was built
          </div>
          <p className="text-xs text-black/70 dark:text-white/70 leading-relaxed">
            {post.methodology}
          </p>
        </section>
      )}

      {/* Disclaimer */}
      <footer className="text-[11px] text-black/45 dark:text-white/45 leading-relaxed border-t border-black/5 dark:border-white/5 pt-4">
        Relative strength = sector ETF 30-day return − SPY 30-day return for the same window.
        Rotation = the sign of relative strength has flipped vs the same calendar window one year
        ago. &ldquo;Money flow&rdquo; for ETFs is a 10-day proxy from price × volume (true
        creation/redemption flow is not publicly available real-time); the proxy correlates with
        institutional accumulation but is not authoritative. Past relative-strength flips don&apos;t
        guarantee future leadership; many flips reverse within a quarter. Not investment advice.
      </footer>
    </article>
  );
}

function SectorCard({ sector, highlight }: { sector: SectorRotationSector; highlight?: boolean }) {
  const d = directionLabel(sector.rotationDirection);
  const cls = highlight
    ? "border-sky-500/40 bg-sky-500/[0.03]"
    : "border-black/10 dark:border-white/10";

  return (
    <div className={`rounded-lg border ${cls} overflow-hidden`}>
      {/* Top bar */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 bg-black/[0.02] dark:bg-white/[0.02] border-b border-black/10 dark:border-white/10">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-bold tracking-tight">{sector.sectorName}</h2>
          <span className="font-mono text-sm text-black/65 dark:text-white/65">
            {sector.sectorEtf}
          </span>
        </div>
        <span
          className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded ${
            d.tone === "good"
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              : d.tone === "bad"
                ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                : "bg-black/[0.05] dark:bg-white/[0.05] text-black/55 dark:text-white/55"
          }`}
        >
          {d.label}
        </span>
      </div>

      {/* Relative strength comparison */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 px-4 py-3 text-sm">
        <Metric
          label="Last 30d return"
          value={fmtPct(sector.last30DayReturnPct, { signed: true })}
          suffix={
            <span className="text-[10px] text-black/45 dark:text-white/45">
              SPY {fmtPct(sector.spy30DayReturnPct, { signed: true })}
            </span>
          }
        />
        <Metric
          label="RS · now"
          value={fmtPct(sector.relativeStrength, { signed: true })}
          tone={
            sector.relativeStrength != null && sector.relativeStrength > 0
              ? "good"
              : sector.relativeStrength != null && sector.relativeStrength < 0
                ? "bad"
                : undefined
          }
        />
        <Metric
          label="RS · 1 yr ago"
          value={fmtPct(sector.relativeStrengthPriorYear, { signed: true })}
          tone={
            sector.relativeStrengthPriorYear != null && sector.relativeStrengthPriorYear > 0
              ? "good"
              : sector.relativeStrengthPriorYear != null && sector.relativeStrengthPriorYear < 0
                ? "bad"
                : undefined
          }
        />
        <Metric
          label="Rotation magnitude"
          value={fmtPct(sector.rotationMagnitudePct, { places: 1 })}
          suffix={<span className="text-[10px] text-black/45 dark:text-white/45">|RS now − RS prior|</span>}
        />
      </div>

      {/* Top ETFs by money flow */}
      {sector.topEtfs.length > 0 && (
        <div className="px-4 py-3 border-t border-black/5 dark:border-white/5">
          <div className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55 mb-2">
            Top {sector.topEtfs.length} ETFs · ranked by 10-day net money flow
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="text-black/55 dark:text-white/55 uppercase tracking-widest text-[10px]">
                <tr className="text-left">
                  <th className="py-1">#</th>
                  <th className="py-1">Ticker</th>
                  <th className="py-1">Name</th>
                  <th className="py-1 text-right">AUM</th>
                  <th className="py-1 text-right">$ vol/day</th>
                  <th className="py-1 text-right">10d flow</th>
                  <th className="py-1 text-right">30d ret</th>
                </tr>
              </thead>
              <tbody>
                {sector.topEtfs.map((e) => (
                  <EtfRow key={e.ticker} etf={e} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Thesis */}
      <div className="px-4 py-3 border-t border-black/5 dark:border-white/5">
        <div className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55 mb-2">
          Thesis
        </div>
        <p className="text-sm leading-relaxed">{sector.thesis}</p>
      </div>

      {/* Risks */}
      {sector.risks && (
        <div className="px-4 py-3 border-t border-black/5 dark:border-white/5 bg-rose-500/[0.02]">
          <div className="text-[10px] uppercase tracking-widest text-rose-500/80 mb-2">Risks</div>
          <p className="text-sm leading-relaxed text-black/75 dark:text-white/75">{sector.risks}</p>
        </div>
      )}
    </div>
  );
}

function EtfRow({ etf }: { etf: SectorRotationEtf }) {
  const flowTone =
    etf.moneyFlowUsd != null && etf.moneyFlowUsd > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : etf.moneyFlowUsd != null && etf.moneyFlowUsd < 0
        ? "text-rose-500"
        : "";
  const retTone =
    etf.thirtyDayReturnPct != null && etf.thirtyDayReturnPct > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : etf.thirtyDayReturnPct != null && etf.thirtyDayReturnPct < 0
        ? "text-rose-500"
        : "";
  return (
    <tr className="border-t border-black/5 dark:border-white/5">
      <td className="py-1.5 pr-2 text-black/45 dark:text-white/45">#{etf.moneyFlowRank}</td>
      <td className="py-1.5 pr-2 font-semibold">{etf.ticker}</td>
      <td className="py-1.5 pr-2 font-sans">{etf.name}</td>
      <td className="py-1.5 pr-2 text-right">
        {etf.aumUsdB != null ? `$${etf.aumUsdB.toFixed(1)}B` : "—"}
      </td>
      <td className="py-1.5 pr-2 text-right">{fmtUsdBig(etf.avgDailyDollarVolumeUsd)}</td>
      <td className={`py-1.5 pr-2 text-right ${flowTone}`}>{fmtUsdBig(etf.moneyFlowUsd)}</td>
      <td className={`py-1.5 pr-2 text-right ${retTone}`}>
        {fmtPct(etf.thirtyDayReturnPct, { signed: true, places: 1 })}
      </td>
    </tr>
  );
}

function Metric({
  label,
  value,
  suffix,
  tone,
}: {
  label: string;
  value: string;
  suffix?: React.ReactNode;
  tone?: "good" | "bad";
}) {
  const valueTone =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "bad"
        ? "text-rose-500"
        : "";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45">
        {label}
      </span>
      <span className={["text-base font-mono", valueTone].join(" ")}>
        {value}
        {suffix && <span className="ml-2 text-xs">{suffix}</span>}
      </span>
    </div>
  );
}
