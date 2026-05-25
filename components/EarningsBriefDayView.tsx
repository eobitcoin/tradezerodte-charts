import Link from "next/link";
import type { PublicWeeklyEarningsBrief } from "@/lib/briefings-public";

interface Props {
  brief: PublicWeeklyEarningsBrief;
  /** Other available week anchors (Sundays, most-recent first). */
  otherWeeks: string[];
  /** Tab bar — links back to /morning-brief. */
  tabBar: React.ReactNode;
}

function fmtWeekRange(sundayAnchor: string): string {
  // weekAnchor is the Sunday-of-the-week. The "trading week" runs Mon→Fri
  // following that Sunday. Render as a range — collapsing the redundant
  // month when both ends fall in the same calendar month.
  //   same-month  → "May 25 — 29, 2026"
  //   cross-month → "May 25 — Jun 1, 2026"
  // We render the year as a separate suffix so the en-US Intl formatter
  // doesn't fall back to "2026 (day: 29)" when asked for just day+year.
  const start = new Date(`${sundayAnchor}T12:00:00Z`);
  const mon = new Date(start);
  mon.setUTCDate(start.getUTCDate() + 1);
  const fri = new Date(start);
  fri.setUTCDate(start.getUTCDate() + 5);
  const sameMonth = mon.getUTCMonth() === fri.getUTCMonth();
  const monLabel = mon.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const friLabel = sameMonth
    ? String(fri.getUTCDate())
    : fri.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
  return `${monLabel} — ${friLabel}, ${fri.getUTCFullYear()}`;
}

function fmtShort(anchor: string): string {
  const sun = new Date(`${anchor}T12:00:00Z`);
  const mon = new Date(sun);
  mon.setUTCDate(sun.getUTCDate() + 1);
  return `Week of ${mon.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })}`;
}

/**
 * Public layout for the Sunday Weekly Earnings Brief — a ~50s video covering
 * the coming week's important earnings + unusual IV setups. Parallel to
 * `BriefDayView` (daily) but with no "calls" panel: the weekly script
 * narrates setups inline rather than referencing a structured list.
 */
export default function EarningsBriefDayView({ brief, otherWeeks, tabBar }: Props) {
  return (
    <main className="flex-1 max-w-5xl mx-auto px-6 py-10 lg:py-14 font-sans w-full">
      {tabBar}

      {/* OLIVIA INTRO */}
      <header className="space-y-3 mb-8 max-w-3xl">
        <div className="text-[10px] uppercase tracking-widest text-red-400">
          Earnings Brief · weekly · {fmtWeekRange(brief.weekAnchor)}
        </div>
        <h1 className="text-3xl lg:text-4xl font-bold tracking-tight leading-[1.1]">
          The week ahead in earnings.
        </h1>
        <div className="space-y-2 text-sm lg:text-base text-white/75 leading-relaxed">
          <p>
            Every Sunday morning, Olivia walks through the coming week&apos;s
            most important earnings prints and flags the names where the
            options market is pricing something unusual. Setups, levels, what
            to watch &mdash; in under a minute.
          </p>
          <p className="text-white/85 italic font-semibold">
            Trade the Edge. Respect the Risk.
          </p>
        </div>
      </header>

      {/* VIDEO + TICKERS PANEL */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start mb-12">
        <div className="lg:col-span-3 max-w-md mx-auto lg:max-w-none w-full">
          <div className="rounded-2xl overflow-hidden border border-white/10 bg-black shadow-2xl shadow-black/60">
            <video
              controls
              playsInline
              preload="metadata"
              poster={brief.thumbnailUrl ?? undefined}
              src={brief.videoUrl}
              className="w-full aspect-[9/16] object-cover"
            >
              Your browser doesn&apos;t support video playback.{" "}
              <a href={brief.videoUrl} className="underline">
                Download the MP4
              </a>
              .
            </video>
          </div>
        </div>

        {/* TICKERS COVERED — chips list, in narration order. Parallel to the
            daily brief's "Today's Top 3" panel but plain symbols (the weekly
            covers IV/earnings setups rather than directional 0DTE calls). */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xs uppercase tracking-widest text-white/55">
            Tickers covered
          </h2>
          {brief.tickers.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {brief.tickers.map((t) => (
                <li key={t}>
                  <span className="inline-flex items-center px-3 py-1.5 rounded-md border border-white/15 bg-white/[0.04] font-bold tracking-tight text-base">
                    ${t}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-white/45 italic">
              No specific names flagged this week.
            </p>
          )}
        </div>
      </div>

      {/* CTA */}
      <aside className="rounded-2xl border border-red-500/40 bg-gradient-to-br from-red-500/[0.08] to-transparent p-6 lg:p-8 space-y-3 max-w-3xl">
        <h2 className="text-xl lg:text-2xl font-bold tracking-tight">
          The weekly brief is the headline. The earnings book is on the inside.
        </h2>
        <p className="text-sm text-white/65 max-w-prose">
          The Sunday clip names the prints worth watching. Members get the
          full earnings calendar with IV ranks, historical move expectations,
          straddle pricing, and the post-print levels we trade off of.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link
            href="/welcome#waitlist"
            className="inline-block px-5 py-3 rounded-md bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold uppercase tracking-[0.22em] shadow-lg shadow-red-900/30 transition-colors"
          >
            Request an Invitation
          </Link>
        </div>
      </aside>

      {/* ARCHIVE — other weeks */}
      {otherWeeks.length > 0 && (
        <section className="mt-12 pt-8 border-t border-white/10">
          <h2 className="text-sm font-bold tracking-tight uppercase text-white/55 mb-4">
            Recent weeks
          </h2>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {otherWeeks.slice(0, 12).map((w) => (
              <li key={w}>
                <Link
                  href={`/morning-brief?kind=earnings&week=${w}`}
                  className="block rounded-md border border-white/10 hover:border-red-500/40 hover:bg-white/[0.03] px-3 py-2 text-xs transition-all"
                >
                  <span className="font-mono text-white/55">{w}</span>
                  <span className="ml-2 text-white/75">{fmtShort(w)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
