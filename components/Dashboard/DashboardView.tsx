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

/** Stable Olivia poster image for the dashboard video card. We intentionally
 *  use the same Higgsfield render across every briefing instead of trying
 *  to capture+persist the per-video Soul URL — brand consistency, no
 *  per-row plumbing, no clobber-from-attach bugs. Swap this constant to
 *  change the hero image; it's the single source of truth. */
const DASHBOARD_HERO_POSTER =
  "https://d8j0ntlcm91z4.cloudfront.net/user_3Dr7a4UQeVdIhvZqwokhbnlVyPs/hf_20260621_170829_d06186ba-d120-4600-8107-6c3e2f756807.png";

export default function DashboardView({ data }: { data: DashboardData }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-4">
      <header>
        <p className="text-sm text-white/55 text-center">
          Premium Content — Your hub for daily analysis, weekly updates, and curated picks.
        </p>
      </header>

      <MarketTape data={data.tape} />

      <ContentGrid data={data} />
      <CryptoCard data={data} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Market tape — VIX / VIX3M / ratio / slope / SKEW / term structure / DXY
// ---------------------------------------------------------------------------

function MarketTape({ data }: { data: DashboardData["tape"] }) {
  if (data.metrics.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline justify-center gap-x-6 gap-y-2 text-[12px] py-1">
      {data.metrics.map((m) => {
        const toneClass =
          m.tone === "pos"
            ? "text-emerald-300"
            : m.tone === "neg"
              ? "text-red-300"
              : m.tone === "warn"
                ? "text-amber-300"
                : "text-white/85";
        return (
          <span key={m.label} className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
            <span className="uppercase tracking-wider text-white/45 font-semibold text-[10px]">
              {m.label}
            </span>
            <span className={`font-mono font-semibold ${toneClass}`}>{m.value}</span>
            {m.hint && (
              <span className="text-white/45 text-[11px] font-mono">{m.hint}</span>
            )}
          </span>
        );
      })}
    </div>
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
        className="block relative aspect-[4/3] rounded-md overflow-hidden bg-gradient-to-b from-zinc-900 to-black group ring-1 ring-white/10"
        aria-label={`Play ${kindLabel}`}
      >
        {/* Always render the stable poster constant — we intentionally
         *  ignore hero.thumbnailUrl (the per-video Higgsfield URL) for brand
         *  consistency. Object-cover anchored 25% from top lands the face
         *  behind the bottom-right play button. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={DASHBOARD_HERO_POSTER}
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-[center_25%] opacity-95 group-hover:opacity-100 transition-opacity"
        />

        <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent pointer-events-none" />

        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/75 font-semibold px-2 py-1 rounded bg-black/55 ring-1 ring-white/15">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          {kindLabel}
        </span>
        <span className="absolute bottom-3 left-3 right-3 text-white text-sm font-medium drop-shadow line-clamp-2">
          {hero.caption ?? "Tap to play"}
        </span>
        <span className="absolute bottom-3 right-3 w-11 h-11 rounded-full bg-white/95 text-black flex items-center justify-center group-hover:scale-110 transition-transform shadow-2xl">
          <PlayIcon />
        </span>
      </Link>

      <div className="flex items-center justify-between gap-3 mt-3">
        <div className="flex flex-wrap gap-1.5 min-w-0">
          {hero.tickers.slice(0, 6).map((t) => (
            <span
              key={t}
              className="px-2 py-0.5 text-[11px] font-mono rounded bg-white/[0.06] text-white/70"
            >
              {t}
            </span>
          ))}
        </div>
        <a
          href="https://www.youtube.com/@OliviaTrades0DTE/shorts"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] text-white/55 hover:text-white whitespace-nowrap transition-colors group/yt"
          aria-label="OliviaTrades YouTube Shorts channel"
        >
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4 fill-[#FF0000] opacity-90 group-hover/yt:opacity-100"
            aria-hidden="true"
          >
            <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z" />
          </svg>
          <span>Olivia Shorts</span>
        </a>
      </div>
    </article>
  );
}

function MarketPulseCard({ data }: { data: DashboardData }) {
  const { nextEconEvents, preMarketPicks } = data.pulse;
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
          <dt className="text-white/55 text-[12px] uppercase tracking-wider mb-1.5 flex items-baseline justify-between gap-2">
            <span>Pre-market picks</span>
            {preMarketPicks && (
              <span className="text-white/40 text-[10px] normal-case tracking-normal">
                {preMarketPicks.tradingDay}
              </span>
            )}
          </dt>
          {preMarketPicks && preMarketPicks.picks.length > 0 ? (
            <ul className="space-y-1">
              {preMarketPicks.picks.map((p, i) => (
                <li key={i}>
                  <Link
                    href="/today"
                    className="flex items-baseline justify-between gap-2 text-[13px] hover:bg-white/[0.03] -mx-1 px-1 py-0.5 rounded transition-colors"
                  >
                    <span className="font-mono font-bold text-white/85">{p.ticker}</span>
                    <span className="font-mono text-white/55 truncate">
                      {p.direction === "long" ? "long" : p.direction === "short" ? "short" : ""}{" "}
                      {p.strike ?? ""}
                      {p.strike && (p.direction === "long" || p.direction === "short") ? " " : ""}
                      {p.expiry ? `· ${p.expiry}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <dd className="text-white/40 text-xs italic">No premarket scan yet.</dd>
          )}
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
  const longCall = top?.tradeIdeas.find((i) => i.strategy === "long_call") ?? null;
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
          {longCall && (
            <div className="text-emerald-300 font-mono text-sm pt-1 border-t border-white/[0.08]">
              {top.ticker} · {longCall.label}
            </div>
          )}
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
