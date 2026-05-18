/**
 * /calendar/economic — upcoming-week macro events that may impact US asset
 * prices. Refreshed weekly via the Sunday cron.
 *
 * Default view: this week's events (Mon → Sun, NY tz), sorted by event time.
 * Past events from the current week show with `actual` populated (green/rose
 * relative to estimate). Future events show date/time + estimate/prior.
 *
 * Filters:
 *   - ?week=YYYY-MM-DD : pick a different week (Monday). Defaults to current.
 *   - ?importance=high|medium|low : filter floor.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, gte, lte, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { economicEvents, type EconImportance } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import ResearchTabs from "@/components/ResearchTabs";

export const dynamic = "force-dynamic";

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
const IMPORTANCE_ORDER: Record<EconImportance, number> = { high: 3, medium: 2, low: 1 };

/** Find the Monday on or before the given date (UTC). */
function mondayOf(date: Date): string {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const dow = d.getUTCDay();
  const offset = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function shiftWeek(weekOf: string, deltaDays: number): string {
  const d = new Date(`${weekOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function importancePill(level: EconImportance): string {
  if (level === "high")
    return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40";
  if (level === "medium")
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40";
  return "bg-black/5 dark:bg-white/10 text-black/55 dark:text-white/55 border-black/10 dark:border-white/10";
}

function countryFlag(cc: string): string {
  // Simple ASCII fallback — actual flag emojis would require Twemoji on
  // older browsers. Keep it text-based for reliability.
  switch (cc.toUpperCase()) {
    case "US": return "🇺🇸";
    case "EU": return "🇪🇺";
    case "GB": return "🇬🇧";
    case "JP": return "🇯🇵";
    case "CN": return "🇨🇳";
    default: return cc.toUpperCase();
  }
}

function formatNum(v: string | null, unit: string | null): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  // Trim trailing zeros after decimal but keep at most 2 sig digits
  const formatted = Math.abs(n) >= 100 ? n.toLocaleString("en-US", { maximumFractionDigits: 1 }) : n.toFixed(2).replace(/\.?0+$/, "");
  return unit ? `${formatted}${unit}` : formatted;
}

function actualVsEstimateClass(actual: string | null, estimate: string | null): string {
  if (actual == null || estimate == null) return "";
  const a = Number(actual);
  const e = Number(estimate);
  if (!Number.isFinite(a) || !Number.isFinite(e)) return "";
  if (Math.abs(a - e) < 0.0001) return "text-black/55 dark:text-white/55";
  // Higher-than-expected = green (typically risk-on for growth, risk-off for inflation —
  // we don't disambiguate here; the impact_text narrative does that work).
  return a > e
    ? "text-emerald-600 dark:text-emerald-400 font-semibold"
    : "text-rose-600 dark:text-rose-400 font-semibold";
}

function fmtTime(d: Date): string {
  // E.g. "Mon May 12 · 8:30 AM ET"
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  return d.toLocaleString("en-US", opts) + " ET";
}

function ImportanceFilterChip({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
        active
          ? "bg-black text-white dark:bg-white dark:text-black border-black dark:border-white"
          : "bg-transparent border-black/15 dark:border-white/15 text-black/65 dark:text-white/65 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
      }`}
    >
      {label}
    </Link>
  );
}

export default async function EconomicCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; importance?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/calendar/economic");

  const sp = await searchParams;
  const minImp: EconImportance | null =
    sp.importance === "high" || sp.importance === "medium" || sp.importance === "low"
      ? (sp.importance as EconImportance)
      : null;

  // Default-week logic: if the user explicitly passed ?week=YYYY-MM-DD, use
  // that. Otherwise, default to the week containing the next upcoming
  // event in the DB (so on Sunday — when the routine publishes next
  // week's events — the user lands on next week, not this almost-finished
  // one). Fall back to the calendar's current Monday if there are no
  // upcoming events at all.
  let weekOf: string;
  if (sp.week && WEEK_RE.test(sp.week)) {
    weekOf = sp.week;
  } else {
    const [nextUpcoming] = await db
      .select({ eventTime: economicEvents.eventTime })
      .from(economicEvents)
      .where(gte(economicEvents.eventTime, new Date()))
      .orderBy(asc(economicEvents.eventTime))
      .limit(1);
    weekOf = nextUpcoming ? mondayOf(nextUpcoming.eventTime) : mondayOf(new Date());
  }

  const start = new Date(`${weekOf}T00:00:00Z`);
  const end = new Date(`${weekOf}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 7);

  let rows = await db
    .select()
    .from(economicEvents)
    .where(
      and(
        gte(economicEvents.eventTime, start),
        lte(economicEvents.eventTime, end),
      ),
    )
    .orderBy(asc(economicEvents.eventTime));

  if (minImp) {
    const floor = IMPORTANCE_ORDER[minImp];
    rows = rows.filter((r) => IMPORTANCE_ORDER[r.importance] >= floor);
  }

  // Group rows by NY-tz date for day-section headers.
  const dayBuckets = new Map<string, typeof rows>();
  for (const r of rows) {
    const dayKey = r.eventTime.toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    if (!dayBuckets.has(dayKey)) dayBuckets.set(dayKey, []);
    dayBuckets.get(dayKey)!.push(r);
  }

  const prevWeek = shiftWeek(weekOf, -7);
  const nextWeek = shiftWeek(weekOf, +7);
  const thisWeek = mondayOf(new Date());
  const totalEvents = rows.length;
  const highCount = rows.filter((r) => r.importance === "high").length;
  const mediumCount = rows.filter((r) => r.importance === "medium").length;

  const buildHref = (override: { week?: string; importance?: string | null }) => {
    const params = new URLSearchParams();
    const merged = { week: weekOf, importance: minImp, ...override };
    if (merged.week && merged.week !== thisWeek) params.set("week", merged.week);
    if (merged.importance) params.set("importance", merged.importance);
    const s = params.toString();
    return `/calendar/economic${s ? `?${s}` : ""}`;
  };

  const weekLabel = (() => {
    const s = new Date(`${weekOf}T00:00:00Z`);
    const e = new Date(s);
    e.setUTCDate(e.getUTCDate() + 6);
    return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  })();

  return (
    <>
      <SiteHeader />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <ResearchTabs active="economic" />

        {/* Header + week navigation */}
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">Economic Calendar</h1>
            <p className="text-xs text-black/55 dark:text-white/55">
              Week of {weekLabel} · {totalEvents} event{totalEvents === 1 ? "" : "s"}
              {highCount > 0 && ` · ${highCount} high-impact`}
              {mediumCount > 0 && `, ${mediumCount} medium`}
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            <Link
              href={buildHref({ week: prevWeek })}
              className="px-3 py-1.5 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
            >
              ← Prev week
            </Link>
            <Link
              href={buildHref({ week: thisWeek })}
              className="px-3 py-1.5 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
            >
              This week
            </Link>
            <Link
              href={buildHref({ week: nextWeek })}
              className="px-3 py-1.5 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
            >
              Next week →
            </Link>
          </div>
        </div>

        {/* Importance filter */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-black/50 dark:text-white/50 mr-1">
            Importance
          </span>
          <ImportanceFilterChip label="all" active={!minImp} href={buildHref({ importance: null })} />
          <ImportanceFilterChip label="high" active={minImp === "high"} href={buildHref({ importance: "high" })} />
          <ImportanceFilterChip label="medium+" active={minImp === "medium"} href={buildHref({ importance: "medium" })} />
        </div>

        {/* Event sections by day */}
        {rows.length === 0 ? (
          <div className="rounded-lg border border-black/10 dark:border-white/10 p-6 text-sm text-black/60 dark:text-white/60 text-center">
            No events for this week. The calendar refreshes Sunday evening — if it&apos;s
            Saturday, the next-week view may not be populated yet.
          </div>
        ) : (
          <div className="space-y-6">
            {Array.from(dayBuckets.entries()).map(([dayKey, dayRows]) => (
              <section key={dayKey} className="space-y-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-black/60 dark:text-white/60 sticky top-0 bg-white/80 dark:bg-black/80 backdrop-blur py-1 z-10">
                  {dayKey}
                </h2>
                <ul className="space-y-2">
                  {dayRows.map((r) => {
                    const past = r.eventTime.getTime() < Date.now();
                    return (
                      <li
                        key={r.id}
                        className={`rounded-lg border p-3 space-y-2 ${
                          past
                            ? "border-black/10 dark:border-white/10 opacity-80"
                            : "border-black/15 dark:border-white/15"
                        }`}
                      >
                        {/* Top row: time + country + importance + title */}
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-xs font-mono text-black/55 dark:text-white/55 shrink-0">
                            {fmtTime(r.eventTime)}
                          </span>
                          <span className="text-base shrink-0" title={r.country ?? ""}>
                            {countryFlag(r.country ?? "")}
                          </span>
                          <span
                            className={`shrink-0 inline-block px-2 py-0.5 text-[10px] font-semibold rounded border ${importancePill(r.importance)}`}
                          >
                            {r.importance}
                          </span>
                          <span className="font-semibold text-sm">{r.title}</span>
                          {past && (
                            <span className="text-[10px] uppercase tracking-wider text-black/40 dark:text-white/40">
                              ✓ printed
                            </span>
                          )}
                        </div>

                        {/* Number row: actual / estimate / prior */}
                        {(r.actual || r.estimate || r.prior) && (
                          <div className="flex gap-4 text-xs font-mono">
                            <span>
                              <span className="text-black/45 dark:text-white/45">Actual: </span>
                              <span className={actualVsEstimateClass(r.actual, r.estimate)}>
                                {formatNum(r.actual, r.unit)}
                              </span>
                            </span>
                            <span>
                              <span className="text-black/45 dark:text-white/45">Est: </span>
                              {formatNum(r.estimate, r.unit)}
                            </span>
                            <span>
                              <span className="text-black/45 dark:text-white/45">Prior: </span>
                              {formatNum(r.prior, r.unit)}
                            </span>
                          </div>
                        )}

                        {/* Description: what the event measures */}
                        {r.description && (
                          <p className="text-sm text-black/75 dark:text-white/75 leading-relaxed">
                            {r.description}
                          </p>
                        )}

                        {/* Impact narrative: regime-aware commentary */}
                        {r.impactText && (
                          <div className="border-l-2 border-emerald-500/40 pl-3 text-sm text-black/70 dark:text-white/70 leading-relaxed italic">
                            {r.impactText}
                          </div>
                        )}

                        {/* Asset tags */}
                        {r.assetTags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {r.assetTags.map((t) => (
                              <span
                                key={t}
                                className="inline-block px-1.5 py-0.5 text-[10px] font-mono rounded border border-black/10 dark:border-white/15 text-black/55 dark:text-white/55"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        <p className="text-[11px] text-black/40 dark:text-white/40 pt-4 border-t border-black/5 dark:border-white/10">
          Sourced from Finnhub. Refreshed weekly Sunday 9 PM ET. Times shown in
          America/New_York. &quot;Potential impact&quot; commentary, where present, is
          regime-aware narrative produced by the weekly research routine.
        </p>
      </main>
    </>
  );
}
