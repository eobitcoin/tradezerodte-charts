/**
 * Layout for the OliviaTrades Research logged-in dashboard. Plain server
 * component; everything below is presentational and reads from a single
 * pre-loaded DashboardData payload.
 *
 * Sections:
 *   - Hero row: video card (left) + stacked Market Pulse + Options Edge (right)
 *   - Snippets row: Earnings / Short Interest / Sector Flow (3 cards)
 *   - Activity feed: Twitter-style timeline of recent cross-surface events
 */
import Link from "next/link";
import type { DashboardData, DashboardEconEvent } from "@/lib/dashboard-data";
import type { CryptoTrade } from "@/lib/db/schema";
import { relativeTime } from "@/lib/dashboard-data";

function fmtScoreBadge(score: number): string {
  if (score >= 75) return "bg-red-500/20 text-red-300 ring-1 ring-red-500/40";
  if (score >= 60) return "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40";
  if (score >= 45) return "bg-yellow-500/15 text-yellow-300 ring-1 ring-yellow-500/30";
  return "bg-white/10 text-white/60";
}

/** Brand widget-title style — amber, uppercase, tracked. Used on every card. */
const TITLE_CLASS =
  "text-[11px] uppercase tracking-[0.18em] text-amber-300 font-semibold";

const CARD_CLASS =
  "rounded-lg ring-1 ring-white/10 bg-white/[0.02] p-4";

export default function DashboardView({ data }: { data: DashboardData }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-4">
      <header>
        <p className="text-sm text-white/55">
          Premium Content — Your hub for daily analysis, weekly updates, and curated picks.
        </p>
      </header>

      <ContentGrid data={data} />
      <CryptoCard data={data} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Single three-column grid:
//   Col 1: Latest Video → Earnings This Week
//   Col 2: Market Pulse → Options Edge → Top Short Squeeze
//   Col 3: Recent Updates (full height)
// ---------------------------------------------------------------------------

function ContentGrid({ data }: { data: DashboardData }) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 items-start">
      <div className="flex flex-col gap-3">
        <VideoCard data={data} />
        <EarningsCard data={data} />
      </div>
      <div className="flex flex-col gap-3">
        <MarketPulseCard data={data} />
        <OptionsEdgeCard data={data} />
        <SqueezeCard data={data} />
      </div>
      <ActivityFeed events={data.feed} />
    </section>
  );
}

function VideoCard({ data }: { data: DashboardData }) {
  const hero = data.hero;
  if (!hero) {
    return (
      <article className={CARD_CLASS}>
        <div className={TITLE_CLASS + " mb-3"}>Latest video</div>
        <div className="aspect-video rounded bg-black flex items-center justify-center text-sm text-white/40">
          No video published yet
        </div>
      </article>
    );
  }

  const kindLabel =
    hero.kind === "weekly_earnings" ? "Weekly Earnings Brief" : "Daily 0DTE Briefing";

  return (
    <article className={CARD_CLASS + " flex flex-col"}>
      <div className="flex items-center justify-between mb-3">
        <span className={TITLE_CLASS}>Latest video</span>
        <span className="text-[11px] text-white/50">{hero.anchorDate}</span>
      </div>

      <Link
        href={hero.videoHref}
        className="block relative aspect-video rounded-md overflow-hidden bg-gradient-to-b from-zinc-900 to-black group ring-1 ring-white/10"
        aria-label={`Play ${kindLabel}`}
      >
        {hero.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hero.thumbnailUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover object-top opacity-95 group-hover:opacity-100 transition-opacity"
          />
        ) : (
          <OliviaPosterFallback />
        )}

        <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent pointer-events-none" />

        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/75 font-semibold px-2 py-1 rounded bg-black/55 ring-1 ring-white/15">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          {kindLabel}
        </span>
        <span className="absolute bottom-3 left-3 right-3 text-white text-sm font-medium drop-shadow line-clamp-2">
          {hero.caption ?? "Tap to play"}
        </span>
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-11 h-11 rounded-full bg-white/95 text-black flex items-center justify-center group-hover:scale-110 transition-transform shadow-2xl">
            <PlayIcon />
          </span>
        </span>
      </Link>

      {hero.tickers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {hero.tickers.slice(0, 6).map((t) => (
            <span
              key={t}
              className="px-2 py-0.5 text-[11px] font-mono rounded bg-white/[0.06] text-white/70"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function OliviaPosterFallback() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40">
      <svg
        viewBox="0 0 64 64"
        className="w-20 h-20 mb-2 text-amber-400/60"
        fill="currentColor"
        aria-hidden="true"
      >
        <circle cx="32" cy="22" r="11" />
        <path d="M10 60 C 10 44, 20 36, 32 36 S 54 44, 54 60 Z" />
      </svg>
      <span className="text-[10px] uppercase tracking-[0.3em] text-amber-300/70">OliviaTrades</span>
    </div>
  );
}

function MarketPulseCard({ data }: { data: DashboardData }) {
  const { nextEconEvents, topTradeIdea } = data.pulse;
  return (
    <article className={CARD_CLASS + " flex flex-col"}>
      <div className="mb-3">
        <Link href="/calendar/economic" className={TITLE_CLASS + " hover:opacity-80 transition-opacity"}>
          Market pulse
        </Link>
      </div>
      <dl className="space-y-2.5 text-sm flex-1">
        <div>
          <dt className="text-white/55 text-[12px] uppercase tracking-wider mb-1.5">
            Next on the calendar
          </dt>
          {nextEconEvents.length === 0 ? (
            <dd className="text-white/40 text-xs italic">No upcoming events tracked.</dd>
          ) : (
            <ul className="space-y-1.5">
              {nextEconEvents.slice(0, 2).map((e, i) => (
                <li key={i}>
                  <EconRow event={e} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="pt-2 border-t border-white/[0.08]">
          <dt className="text-white/55 text-[12px] uppercase tracking-wider mb-1.5">
            Top trade idea
          </dt>
          <dd>
            {topTradeIdea ? (
              <Link
                href={topTradeIdea.href}
                className="text-emerald-300 hover:underline font-mono text-sm"
              >
                {topTradeIdea.ticker} · {topTradeIdea.label}
              </Link>
            ) : (
              <span className="text-white/40 text-xs italic">No live ideas yet.</span>
            )}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function EconRow({ event }: { event: DashboardEconEvent }) {
  const when = new Date(event.when);
  const dayLabel = when.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
  const timeLabel = when.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
  const dot =
    event.importance === "high"
      ? "bg-red-400"
      : event.importance === "medium"
        ? "bg-amber-400"
        : "bg-white/30";
  return (
    <div className="flex items-baseline gap-2 text-[13px]">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot} mt-1`} aria-hidden="true" />
      <span className="flex-1 truncate text-white/85">
        {event.title}
        {event.country && <span className="text-white/40"> · {event.country}</span>}
      </span>
      <span className="font-mono text-[11px] text-white/55 whitespace-nowrap">
        {dayLabel} {timeLabel}
      </span>
    </div>
  );
}

function OptionsEdgeCard({ data }: { data: DashboardData }) {
  const oe = data.optionsEdge;
  return (
    <Link
      href="/research/options-edge"
      className={CARD_CLASS + " block hover:bg-white/[0.04] transition-colors"}
    >
      <div className="mb-3">
        <div className={TITLE_CLASS}>Options Anomalies</div>
        <div className="text-[11px] text-white/50 mt-0.5">{oe?.scanDay ?? "—"}</div>
      </div>
      {oe && oe.top.length > 0 ? (
        <>
          <div className="text-xs text-white/55 mb-2">
            {oe.totalAnomalies} anomalies flagged this run
          </div>
          <ul className="space-y-1.5">
            {oe.top.map((a) => (
              <li key={`${a.ticker}-${a.metric}`} className="flex items-baseline gap-2 text-[13px]">
                <span className="font-mono font-bold text-white/85 min-w-[44px]">{a.ticker}</span>
                <span className="text-white/55 text-[12px] flex-1 truncate">
                  {formatMetric(a.metric)} {a.direction === "high" ? "high" : "low"}
                </span>
                <span
                  className={`font-mono text-[11px] font-semibold ${
                    a.direction === "high" ? "text-red-300" : "text-emerald-300"
                  }`}
                >
                  z={a.zScore.toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="text-sm text-white/40 italic">
          No anomalies flagged in the latest scan.
        </div>
      )}
    </Link>
  );
}

function formatMetric(m: string): string {
  return (
    {
      atm_iv_rank: "ATM IV rank",
      skew_z: "Skew",
      term_z: "Term slope",
      iv_hv_ratio: "IV / HV",
    }[m] ?? m
  );
}

// ---------------------------------------------------------------------------
// Surface cards — used by the ContentGrid above
// ---------------------------------------------------------------------------

function EarningsCard({ data }: { data: DashboardData }) {
  const e = data.earnings;
  return (
    <Link
      href="/research/earnings"
      className={CARD_CLASS + " block hover:bg-white/[0.04] transition-colors"}
    >
      <CardHeader label="Earnings this week" icon="calendar-event" />
      {e ? (
        <>
          <div className="text-2xl font-semibold leading-tight">{e.totalStocks} reports</div>
          <div className="text-xs text-white/55 mb-3">
            {e.flaggedCount > 0 ? `${e.flaggedCount} flagged asymmetric` : "no asymmetric flags"}
          </div>
          <ul className="text-xs space-y-1">
            {e.upcoming.map((u) => (
              <li key={u.ticker} className="flex justify-between">
                <span className="font-mono">{u.ticker}</span>
                <span className="text-white/50">
                  {u.date} · {u.time}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyMsg>No earnings scan yet</EmptyMsg>
      )}
    </Link>
  );
}

function SqueezeCard({ data }: { data: DashboardData }) {
  const top = data.squeeze?.top ?? null;
  return (
    <Link
      href="/research/squeeze"
      className={CARD_CLASS + " block hover:bg-white/[0.04] transition-colors"}
    >
      <CardHeader label="Top short squeeze" icon="flame" />
      {top ? (
        <>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-mono font-semibold">{top.ticker}</span>
            <span
              className={`text-xs font-mono font-semibold px-2 py-0.5 rounded ${fmtScoreBadge(top.score)}`}
            >
              {top.score.toFixed(0)}
            </span>
          </div>
          <div className="text-xs text-white/55 mb-3 truncate">
            {top.companyName ? `${top.companyName} · ` : ""}
            {top.siPct != null ? `${top.siPct.toFixed(0)}% SI` : "—"} · DTC{" "}
            {top.daysToCover.toFixed(1)}
          </div>
          {top.tradeIdeas.slice(0, 2).map((idea) => (
            <div key={idea.strategy} className="flex justify-between text-xs">
              <span className="text-white/55">
                {idea.strategy === "long_call"
                  ? "Long call"
                  : idea.strategy === "bull_call_spread"
                    ? "Spread"
                    : "Diagonal"}{" "}
                ({idea.dte}d)
              </span>
              <span className="font-mono">
                {idea.netDebit != null ? `debit $${idea.netDebit.toFixed(2)}` : "—"}
              </span>
            </div>
          ))}
        </>
      ) : (
        <EmptyMsg>No squeeze scan yet</EmptyMsg>
      )}
    </Link>
  );
}

function CardHeader({ label, icon }: { label: string; icon: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <i className={`ti ti-${icon} text-sm text-amber-400/80`} aria-hidden="true" />
      <span className={TITLE_CLASS}>{label}</span>
    </div>
  );
}

function EmptyMsg({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-white/40 py-4 text-center italic">{children}</div>;
}

// ---------------------------------------------------------------------------
// Activity feed — Twitter-style timeline
// ---------------------------------------------------------------------------

const SURFACE_TINTS: Record<string, { dot: string; bg: string; text: string }> = {
  "Daily 0DTE Briefing": { dot: "bg-red-400", bg: "bg-red-500/15", text: "text-red-300" },
  "Weekly Earnings Brief": { dot: "bg-amber-400", bg: "bg-amber-500/15", text: "text-amber-300" },
  "Earnings Whiplash": { dot: "bg-amber-400", bg: "bg-amber-500/15", text: "text-amber-300" },
  "Short Interest Squeeze": { dot: "bg-red-400", bg: "bg-red-500/15", text: "text-red-300" },
  "Sector Rotation": { dot: "bg-violet-400", bg: "bg-violet-500/15", text: "text-violet-300" },
  "Options Edge": { dot: "bg-emerald-400", bg: "bg-emerald-500/15", text: "text-emerald-300" },
  LEAPs: { dot: "bg-sky-400", bg: "bg-sky-500/15", text: "text-sky-300" },
};

function tintFor(surface: string) {
  return (
    SURFACE_TINTS[surface] ?? {
      dot: "bg-white/40",
      bg: "bg-white/10",
      text: "text-white/70",
    }
  );
}

function ActivityFeed({ events }: { events: DashboardData["feed"] }) {
  return (
    <section className={CARD_CLASS + " flex flex-col min-h-0"}>
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <span className={TITLE_CLASS}>Recent updates</span>
        <span className="text-[11px] text-white/50">
          {events.length} {events.length === 1 ? "event" : "events"}
        </span>
      </div>
      {events.length === 0 ? (
        <EmptyMsg>No recent activity</EmptyMsg>
      ) : (
        <ul className="flex-1 overflow-y-auto space-y-2 -mr-2 pr-2">
          {events.map((e, i) => {
            const tint = tintFor(e.surface);
            return (
              <li key={`${e.surface}-${i}`}>
                <Link
                  href={e.href}
                  className="flex gap-2.5 -mx-1.5 px-1.5 py-1.5 rounded-md hover:bg-white/[0.04] transition-colors group"
                >
                  <span
                    className={`flex-shrink-0 w-8 h-8 rounded-full ${tint.bg} flex items-center justify-center mt-0.5`}
                  >
                    <i className={`ti ti-${e.icon} ${tint.text} text-[15px]`} aria-hidden="true" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 mb-0.5">
                      <span className={`text-[10px] uppercase tracking-wider font-semibold ${tint.text} truncate`}>
                        {e.surface}
                      </span>
                      <span className="text-[10px] text-white/40 font-mono flex-shrink-0">·</span>
                      <span className="text-[10px] text-white/45 font-mono flex-shrink-0">
                        {relativeTime(e.at)}
                      </span>
                    </div>
                    <div className="text-[11px] text-white/85 leading-snug truncate">
                      {e.title}
                    </div>
                    {e.detail && (
                      <div className="text-[10px] text-white/50 leading-snug truncate">
                        {e.detail}
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Crypto Daily — full-width card with BTC / ETH / SOL trade plans
// ---------------------------------------------------------------------------

function CryptoCard({ data }: { data: DashboardData }) {
  const c = data.crypto;
  return (
    <section className={CARD_CLASS}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <Link
          href="/crypto"
          className={TITLE_CLASS + " hover:opacity-80 transition-opacity"}
        >
          Crypto daily
        </Link>
        <span className="text-[11px] text-white/50">{c?.scanDay ?? "—"}</span>
      </div>
      {c && c.trades.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {c.trades.map((t) => (
            <CryptoTradeRow key={t.ticker} trade={t} />
          ))}
        </div>
      ) : (
        <EmptyMsg>No crypto research yet</EmptyMsg>
      )}
    </section>
  );
}

function CryptoTradeRow({ trade }: { trade: CryptoTrade }) {
  const biasTint =
    trade.bias === "long"
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
      : trade.bias === "short"
        ? "bg-red-500/15 text-red-300 ring-red-500/30"
        : trade.bias === "avoid"
          ? "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30"
          : "bg-white/10 text-white/70 ring-white/20";
  const shortTicker = trade.ticker.replace(/USDT?$|-USD$/i, "");
  return (
    <div className="rounded-md ring-1 ring-white/[0.08] bg-white/[0.02] p-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-mono font-bold text-sm">{shortTicker}</span>
        {trade.bias && (
          <span
            className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ring-1 ${biasTint}`}
          >
            {trade.bias}
          </span>
        )}
      </div>
      <dl className="space-y-1 text-[11px]">
        <CryptoRow label="Entry" value={trade.entry_zone ?? "—"} />
        {trade.entry_trigger && (
          <CryptoRow label="Trigger" value={trade.entry_trigger} />
        )}
        <CryptoRow label="Target 1" value={fmtLevel(trade.target1)} tone="pos" />
        {trade.target2 != null && trade.target2 !== "" && (
          <CryptoRow label="Target 2" value={fmtLevel(trade.target2)} tone="pos" />
        )}
        <CryptoRow label="Stop" value={fmtLevel(trade.stop)} tone="neg" />
      </dl>
      {trade.time_horizon && (
        <div className="text-[10px] text-white/45 mt-2 uppercase tracking-wider">
          {trade.time_horizon}
        </div>
      )}
    </div>
  );
}

function CryptoRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  const valueClass =
    tone === "pos"
      ? "text-emerald-300"
      : tone === "neg"
        ? "text-red-300"
        : "text-white/85";
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-white/55">{label}</dt>
      <dd className={`font-mono ${valueClass}`}>{value}</dd>
    </div>
  );
}

function fmtLevel(v: number | string | undefined | null): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return `$${v.toLocaleString()}`;
  return String(v);
}
