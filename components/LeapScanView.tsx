import Link from "next/link";
import { renderMarkdown } from "@/lib/markdown";
import type { LeapScan, LeapPickSummary } from "@/lib/db/schema";

/**
 * Renders one published Cheap LEAPs scan.
 *
 *   1. Header — title + scan date + count of picks
 *   2. Auto-written prose summary
 *   3. Ranked pick cards — ticker · strike · expiry · premium · scores
 *      · fundamentals chips
 *   4. Footer link to archive
 */

interface Props {
  scan: LeapScan;
  archive: Array<{ scanDay: string }>;
}

function fmtUsd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}
function fmtStrike(v: number): string {
  return `$${v.toFixed(v >= 100 ? 0 : 2)}`;
}
function fmtPct(v: number | null, decimals = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(decimals)}%`;
}
function fmtScore(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(0);
}
function fmtBigDollars(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
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
function fmtExpiry(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function scoreTone(v: number | null): string {
  if (v == null) return "border-white/15 text-white/55 bg-white/[0.03]";
  if (v >= 75) return "border-emerald-500/40 text-emerald-300 bg-emerald-500/[0.08]";
  if (v >= 50) return "border-amber-500/40 text-amber-300 bg-amber-500/[0.08]";
  return "border-rose-500/40 text-rose-300 bg-rose-500/[0.08]";
}

export default async function LeapScanView({ scan, archive }: Props) {
  const summaryHtml = scan.summary
    ? await renderMarkdown(scan.summary, [])
    : null;
  const picks = (scan.picks as LeapPickSummary[]) ?? [];

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      <OptionsSubNavSlot />
      <header className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-amber-400">
          Cheap LEAPs · Weekly low-IV + quality scan
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{scan.title}</h1>
        <p className="text-sm text-white/55">
          Scan date · {fmtScanDate(scan.scanDay)} · {scan.universeSize} tickers
          scanned · {picks.length} pick{picks.length === 1 ? "" : "s"} cleared
          the bar
        </p>
      </header>

      {summaryHtml && (
        <section
          className="prose prose-neutral dark:prose-invert max-w-none dte-post"
          dangerouslySetInnerHTML={{ __html: summaryHtml }}
        />
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white/65">
          Ranked picks
        </h2>
        {picks.length === 0 ? (
          <p className="text-sm text-white/55 italic">
            No tickers cleared the cheap-LEAPs bar this week. Either vol
            is bid across the universe or the fundamental/setup filters
            didn&apos;t align with the IV picture.
          </p>
        ) : (
          <ul className="space-y-3">
            {picks.map((p, i) => {
              const f = p.fundamentals as Record<string, unknown>;
              const reasons = (f.qualityReasons as string[] | undefined) ?? [];
              const setup = f.setup as
                | {
                    pullbackPct: number | null;
                    above200dma: boolean | null;
                    high52w: number | null;
                  }
                | undefined;
              return (
                <li
                  key={`${p.contractTicker}-${i}`}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3"
                >
                  {/* Top row */}
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <Link
                      href={`/tickers/${p.ticker}`}
                      className="font-mono text-xl font-bold tracking-tight hover:underline"
                    >
                      {p.ticker}
                    </Link>
                    <span className="font-mono text-sm text-white/85">
                      {fmtStrike(p.strike)}C{" "}
                      <span className="text-white/45">
                        · {fmtExpiry(p.expirationDate)} ({p.dteDays}d)
                      </span>
                    </span>
                    <span className="ml-auto font-mono text-sm">
                      <span className="text-white/55">composite</span>{" "}
                      <span className="font-bold text-amber-300">
                        {p.compositeScore.toFixed(0)}
                      </span>
                    </span>
                  </div>

                  {/* Score chips */}
                  <div className="flex flex-wrap gap-1.5">
                    <span
                      className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${scoreTone(p.ivRank != null ? 100 - p.ivRank : null)}`}
                    >
                      IV rank {fmtScore(p.ivRank)}
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${scoreTone(p.qualityScore)}`}
                    >
                      Quality {fmtScore(p.qualityScore)}
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${scoreTone(p.setupScore)}`}
                    >
                      Setup {fmtScore(p.setupScore)}
                    </span>
                  </div>

                  {/* Contract details */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    <Cell label="Underlying" value={fmtUsd(p.underlyingPrice)} />
                    <Cell label="Premium mid" value={fmtUsd(p.premiumMid)} />
                    <Cell
                      label="Bid / Ask"
                      value={`${fmtUsd(p.premiumBid)} / ${fmtUsd(p.premiumAsk)}`}
                    />
                    <Cell
                      label="IV"
                      value={
                        p.iv != null ? `${(p.iv * 100).toFixed(0)}%` : "—"
                      }
                    />
                    <Cell
                      label="OI"
                      value={p.openInterest?.toLocaleString() ?? "—"}
                    />
                  </div>

                  {/* Fundamentals + setup row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <Cell
                      label="Revenue YoY"
                      value={fmtPct(f.revenueYoyPct as number | null)}
                    />
                    <Cell
                      label="Gross margin"
                      value={fmtPct(f.grossMarginPct as number | null, 0)}
                    />
                    <Cell
                      label="Op income TTM"
                      value={fmtBigDollars(f.operatingIncomeTtm as number | null)}
                    />
                    <Cell
                      label="From 52w high"
                      value={fmtPct(setup?.pullbackPct ?? null, 1)}
                    />
                  </div>

                  {/* Reasons line */}
                  {reasons.length > 0 && (
                    <p className="text-xs text-white/55 leading-relaxed">
                      <span className="text-white/45 uppercase tracking-widest text-[10px]">
                        Why:
                      </span>{" "}
                      {reasons.join(" · ")}
                      {setup?.above200dma === false && " · below 200dma (caution)"}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {archive.length > 0 && (
        <section className="border-t border-white/10 pt-6">
          <h2 className="text-sm font-bold uppercase tracking-widest text-white/65 mb-3">
            Recent scans
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {archive.slice(0, 12).map((a) => (
              <li key={a.scanDay}>
                <Link
                  href={`/research/leaps/${a.scanDay}`}
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

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.02] px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-white/45">
        {label}
      </div>
      <div className="font-mono text-white/85 mt-0.5">{value}</div>
    </div>
  );
}

// Local import to keep this file self-contained vs. circular imports.
import OptionsSubNav from "@/components/OptionsSubNav";
function OptionsSubNavSlot() {
  return <OptionsSubNav active="leaps" />;
}
