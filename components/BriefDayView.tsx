import Link from "next/link";
import type { PublicBriefingWithCalls } from "@/lib/briefings-public";

interface Props {
  brief: PublicBriefingWithCalls;
  /** Other available dates (most-recent first), used for archive crosslinks.
   *  Pass empty array when there's only one. */
  otherDays: string[];
  /** When true (per-day route), show breadcrumb back to /morning-brief. */
  showBreadcrumb?: boolean;
  /** Optional tab bar rendered above the header. Used by the canonical
   *  daily route (/morning-brief/[date]) so the Daily/Earnings tab pair
   *  is visible after the landing redirects users to the dated URL.
   *  Left unset by archive-only routes that don't need tabs. */
  tabBar?: React.ReactNode;
}

function fmtDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function fmtShort(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function directionLabel(d: string | null): string {
  if (!d) return "—";
  if (d === "call") return "Call";
  if (d === "put") return "Put";
  if (d === "long") return "Long";
  if (d === "short") return "Short";
  if (d === "avoid") return "Avoid";
  return d;
}

function directionTone(d: string | null): string {
  if (d === "call" || d === "long")
    return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
  if (d === "put" || d === "short")
    return "bg-rose-500/10 text-rose-300 border-rose-500/30";
  return "bg-white/[0.04] text-white/65 border-white/15";
}

/**
 * Shared layout for the Brief page. Used by both `/morning-brief` (renders
 * the latest day) and `/morning-brief/[date]` (renders the specified day).
 */
export default function BriefDayView({
  brief,
  otherDays,
  showBreadcrumb = false,
  tabBar,
}: Props) {
  return (
    <main className="flex-1 max-w-5xl mx-auto px-6 py-10 lg:py-14 font-sans w-full">
      {tabBar}
      {showBreadcrumb && (
        <nav className="mb-6 text-xs text-white/45">
          <Link href="/welcome" className="hover:text-white">Home</Link>
          <span className="mx-2">·</span>
          <Link href="/morning-brief" className="hover:text-white">Brief</Link>
          <span className="mx-2">·</span>
          <span className="text-white/65 font-mono">{brief.tradingDay}</span>
        </nav>
      )}

      {/* OLIVIA INTRO — sits right above the picks. */}
      <header className="space-y-3 mb-8 max-w-3xl">
        <div className="text-[10px] uppercase tracking-widest text-red-400">
          Brief · daily · 20 seconds · {fmtDate(brief.tradingDay)}
        </div>
        <h1 className="text-3xl lg:text-4xl font-bold tracking-tight leading-[1.1]">
          Olivia Trades.
        </h1>
        <div className="space-y-2 text-sm lg:text-base text-white/75 leading-relaxed">
          <p>
            Every morning before the bell, Olivia reads the tape and gives you
            the top three 0DTE setups in twenty seconds &mdash; strikes,
            levels, and the reason. Then she&apos;s gone &mdash; coffee in
            hand, on to the next thing.
          </p>
          <p className="text-white/85 italic font-semibold">
            Trade the Edge. Respect the Risk.
          </p>
        </div>
      </header>

      {/* VIDEO + PICKS */}
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

        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xs uppercase tracking-widest text-white/55">
            Today&apos;s Top 3
          </h2>
          {brief.calls.length > 0 ? (
            <ul className="space-y-2">
              {brief.calls.map((c) => (
                <li
                  key={c.ticker}
                  className="flex items-baseline gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
                >
                  <span className="font-bold tracking-tight text-lg">
                    {c.ticker}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${directionTone(c.direction)}`}
                  >
                    {directionLabel(c.direction)}
                  </span>
                  {c.grade && (
                    <span className="ml-auto text-xs text-white/55 font-mono">
                      {c.grade}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-white/45 italic">
              No flagged setups for this session.
            </p>
          )}
        </div>
      </div>

      {/* CTA */}
      <aside className="rounded-2xl border border-red-500/40 bg-gradient-to-br from-red-500/[0.08] to-transparent p-6 lg:p-8 space-y-3 max-w-3xl">
        <h2 className="text-xl lg:text-2xl font-bold tracking-tight">
          Olivia&apos;s the headline. The plan is on the inside.
        </h2>
        <p className="text-sm text-white/65 max-w-prose">
          The 20-second brief covers the top three. Members get the full
          premarket plan, market-open re-grade, day-trade cards, and a running
          scorecard. Same research stack, full detail.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link
            href="/welcome#waitlist"
            className="inline-block px-5 py-3 rounded-md bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold uppercase tracking-[0.22em] shadow-lg shadow-red-900/30 transition-colors"
          >
            Request an Invitation
          </Link>
          <Link
            href={`/explore/daily/${brief.tradingDay}`}
            className="text-xs text-white/65 hover:text-white hover:underline"
          >
            See this day&apos;s public preview &rarr;
          </Link>
        </div>
      </aside>

      {/* ARCHIVE — only when there's more than this one brief */}
      {otherDays.length > 0 && (
        <section className="mt-12 pt-8 border-t border-white/10">
          <h2 className="text-sm font-bold tracking-tight uppercase text-white/55 mb-4">
            Recent briefs
          </h2>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {otherDays.slice(0, 12).map((d) => (
              <li key={d}>
                <Link
                  href={`/morning-brief/${d}`}
                  className="block rounded-md border border-white/10 hover:border-red-500/40 hover:bg-white/[0.03] px-3 py-2 text-xs transition-all"
                >
                  <span className="font-mono text-white/55">{d}</span>
                  <span className="ml-2 text-white/75">{fmtShort(d)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
