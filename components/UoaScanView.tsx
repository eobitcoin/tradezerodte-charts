import Link from "next/link";
import { renderMarkdown } from "@/lib/markdown";
import OptionsSubNav from "@/components/OptionsSubNav";
import type {
  UoaScan,
  UoaPrintSummary,
  UoaClassification,
} from "@/lib/db/schema";
import type { TodaySoFarTotals } from "@/lib/uoa";

/**
 * Renders one published Unusual Activity scan.
 *
 *   1. Header — title + scan date + classification breakdown line
 *   2. Routine-/auto-written prose summary
 *   3. Ranked print cards — ticker · strike · DTE · classification ·
 *      premium · sweep badge · aggressor + OI multiplier
 *   4. Footer link to the archive
 *
 * Used by both /research/unusual-activity (latest) and
 * /research/unusual-activity/[scanDay] (specific scan).
 */

interface Props {
  scan: UoaScan;
  archive: Array<{ scanDay: string }>;
  /** Recently-printed prints from the last hour, populated by the
   *  5-min intraday cron. Renders as a "Latest intraday" section
   *  above the day's ranked prints. */
  latestPrints?: UoaPrintSummary[];
  /** Running totals for today (ET). Surfaces under the Latest
   *  Intraday banner so users see live flow even when the page header
   *  is showing yesterday's EOD-locked summary. Null when there are
   *  no qualifying prints yet today. */
  todaySoFar?: TodaySoFarTotals | null;
}

const CLASS_LABEL: Record<UoaClassification, string> = {
  bullish_call_buy: "Bullish call buy",
  bearish_put_buy: "Bearish put buy",
  call_sell: "Call sell",
  put_sell: "Put sell",
  ambiguous: "Ambiguous",
};

const CLASS_TONE: Record<UoaClassification, string> = {
  bullish_call_buy: "border-emerald-500/40 text-emerald-300 bg-emerald-500/[0.08]",
  bearish_put_buy: "border-rose-500/40 text-rose-300 bg-rose-500/[0.08]",
  call_sell: "border-amber-500/40 text-amber-300 bg-amber-500/[0.08]",
  put_sell: "border-cyan-500/40 text-cyan-300 bg-cyan-500/[0.08]",
  ambiguous: "border-white/20 text-white/55 bg-white/[0.04]",
};

function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 10_000) return `$${(v / 1000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}
function fmtStrike(v: number): string {
  return `$${v.toFixed(v >= 100 ? 0 : 2)}`;
}
function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
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
function fmtPrintTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function dteFromExpiry(expiry: string, asOf: string): number {
  const e = new Date(`${expiry}T00:00:00Z`).getTime();
  const a = new Date(`${asOf}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((e - a) / 86_400_000));
}

export default async function UoaScanView({ scan, archive, latestPrints, todaySoFar }: Props) {
  const summaryHtml = scan.summary
    ? await renderMarkdown(scan.summary, [])
    : null;
  const prints = (scan.prints as UoaPrintSummary[]) ?? [];
  const meta = (scan.meta as Record<string, unknown>) ?? {};
  const counts =
    (meta.classificationCounts as Record<UoaClassification, number> | undefined) ?? null;
  const totalPrints = (meta.totalPrints as number | undefined) ?? prints.length;
  const latest = latestPrints ?? [];

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      <OptionsSubNav active="unusual" />
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[10px] uppercase tracking-widest text-amber-400">
            Unusual Activity · End-of-day smart-money flow
          </div>
          <Link
            href="/learn/unusual-activity"
            className="text-xs text-white/55 hover:text-white hover:underline"
          >
            Help · how to read this →
          </Link>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{scan.title}</h1>
        <p className="text-sm text-white/55">
          Scan date · {fmtScanDate(scan.scanDay)} · {scan.universeSize} tickers
          scanned · {totalPrints} print{totalPrints === 1 ? "" : "s"} cleared the
          filter
        </p>
        {counts && (
          <div className="flex flex-wrap gap-2 pt-1">
            {(Object.keys(CLASS_LABEL) as UoaClassification[])
              .filter((k) => k !== "ambiguous" && counts[k] > 0)
              .map((k) => (
                <span
                  key={k}
                  className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${CLASS_TONE[k]}`}
                >
                  {counts[k]} {CLASS_LABEL[k]}
                </span>
              ))}
          </div>
        )}
      </header>

      {summaryHtml && (
        <section
          className="prose prose-neutral dark:prose-invert max-w-none dte-post"
          dangerouslySetInnerHTML={{ __html: summaryHtml }}
        />
      )}

      {/* LATEST INTRADAY — refreshed by the 5-min cron. Only renders
          when there's actually been a print in the last hour (typical
          during RTH). The amber pulsing dot signals "live". */}
      {latest.length > 0 && (
        <section className="space-y-3 rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.06] to-amber-500/[0.02] p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-amber-300">
            <span
              aria-hidden="true"
              className="inline-block size-2 rounded-full bg-amber-400 animate-pulse"
            />
            Latest intraday
            <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-white/55">
              · last hour · refreshed every 5 min
            </span>
          </h2>
          <ul className="space-y-3">
            {latest.map((p, i) => (
              <PrintCard key={`latest-${p.contractTicker}-${p.printTs}-${i}`} print={p} asOf={scan.scanDay} />
            ))}
          </ul>
        </section>
      )}

      {/* TODAY SO FAR — running counts from uoa_prints (ET-anchored
          today), updated every 5 min by the intraday cron. Only renders
          when today is NEWER than the EOD-locked scan.scanDay (i.e.
          we're mid-day, EOD hasn't fired yet) AND there's at least one
          qualifying print on the day. */}
      {todaySoFar &&
        todaySoFar.totalPrints > 0 &&
        todaySoFar.scanDay > scan.scanDay && (
          <TodaySoFarBox totals={todaySoFar} />
        )}

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white/65">
          Ranked prints
        </h2>
        {prints.length === 0 ? (
          <p className="text-sm text-white/55 italic">
            No prints cleared the bar today. The watchlist tape was quiet — no
            $50k+ aggressive prints with OI mult ≥ 3×.
          </p>
        ) : (
          <ul className="space-y-3">
            {prints.map((p, i) => (
              <PrintCard key={`${p.contractTicker}-${p.printTs}-${i}`} print={p} asOf={scan.scanDay} />
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
            {archive.slice(0, 12).map((a) => (
              <li key={a.scanDay}>
                <Link
                  href={`/research/unusual-activity/${a.scanDay}`}
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

/** One print card — used for both the Ranked prints list and the
 *  Latest intraday banner. Identical layout in both contexts; the
 *  surrounding section provides the visual differentiation. */
function PrintCard({
  print: p,
  asOf,
}: {
  print: UoaPrintSummary;
  asOf: string;
}) {
  const dte = dteFromExpiry(p.expirationDate, asOf);
  const sideLabel = p.side === "buy" ? "BOT" : "SLD";
  const sideTone =
    p.side === "buy"
      ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/[0.08]"
      : "border-rose-500/40 text-rose-300 bg-rose-500/[0.08]";
  return (
    <li className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <Link
          href={`/tickers/${p.underlying}`}
          className="font-mono text-xl font-bold tracking-tight hover:underline"
        >
          {p.underlying}
        </Link>
        <span className="font-mono text-sm text-white/85">
          {fmtStrike(p.strike)}
          {p.contractType === "call" ? "C" : "P"}{" "}
          <span className="text-white/45">· {dte}d</span>
        </span>
        <span
          className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${sideTone}`}
        >
          {sideLabel}
        </span>
        <span
          className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${CLASS_TONE[p.classification]}`}
        >
          {CLASS_LABEL[p.classification]}
        </span>
        {p.isSweep && (
          <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border border-violet-500/40 text-violet-300 bg-violet-500/[0.08]">
            Sweep
          </span>
        )}
        <span className="ml-auto font-mono text-sm">
          <span className="text-white/55">premium</span>{" "}
          <span className="font-bold text-white/95">{fmtUsd(p.premiumUsd)}</span>
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
        <Cell label="Size" value={`${p.size.toLocaleString()}`} />
        <Cell label="Price" value={`$${p.price.toFixed(2)}`} />
        <Cell
          label="OI mult"
          value={p.oiMultiplier != null ? `${p.oiMultiplier.toFixed(1)}×` : "—"}
        />
        <Cell label="Strike vs spot" value={fmtPct(p.pctFromSpot)} />
        <Cell label="Tape time" value={fmtPrintTime(p.printTs)} />
      </div>
    </li>
  );
}

/**
 * Running-totals box for "today so far" — surfaces between the LATEST
 * INTRADAY banner and the (EOD-locked) ranked-prints section. Lives in
 * the gap between fresh-flow alerts and the persisted day summary,
 * showing live-evolving counts of bullish/bearish/call/put classification
 * across all of today's qualifying prints.
 *
 * Only renders when `todaySoFar.scanDay > scan.scanDay`, i.e. we're
 * mid-day on a fresh calendar day and the EOD cron hasn't fired yet.
 * After EOD, the header date catches up and this box gracefully
 * disappears (its data is now part of the header summary).
 */
function TodaySoFarBox({ totals }: { totals: TodaySoFarTotals }) {
  const formattedDate = new Date(
    `${totals.scanDay}T12:00:00Z`,
  ).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const latestMinAgo = totals.latestPrintAt
    ? Math.max(
        0,
        Math.round(
          (Date.now() - new Date(totals.latestPrintAt).getTime()) / 60_000,
        ),
      )
    : null;
  return (
    <section className="space-y-3 rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.06] to-emerald-500/[0.02] p-4">
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-emerald-300">
        <span
          aria-hidden="true"
          className="inline-block size-2 rounded-full bg-emerald-400 animate-pulse"
        />
        Today so far · {formattedDate}
        <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-white/55">
          · live · EOD summary pending until 4:15 PM ET
        </span>
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Cell
          label="Qualifying prints"
          value={totals.totalPrints.toLocaleString()}
        />
        <Cell
          label="Total premium"
          value={fmtUsd(totals.totalPremiumUsd)}
        />
        <Cell
          label="Tickers touched"
          value={totals.tickersTouched.toLocaleString()}
        />
        <Cell
          label="Last print"
          value={
            latestMinAgo != null
              ? latestMinAgo === 0
                ? "just now"
                : `${latestMinAgo}m ago`
              : "—"
          }
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(CLASS_LABEL) as UoaClassification[])
          .filter(
            (k) => k !== "ambiguous" && (totals.classificationCounts[k] ?? 0) > 0,
          )
          .map((k) => (
            <span
              key={k}
              className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${CLASS_TONE[k]}`}
            >
              {totals.classificationCounts[k]} {CLASS_LABEL[k]}
            </span>
          ))}
      </div>
    </section>
  );
}
