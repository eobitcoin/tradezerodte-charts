/**
 * Layout for the Olivia Trades logged-in dashboard. Plain server component;
 * everything below is presentational and reads from a single pre-loaded
 * DashboardData payload.
 *
 * Sections:
 *   - Hero row: video card (60%) + market pulse card (40%)
 *   - Snippets row: Earnings / Short Interest / Sector Flow
 *   - Activity feed: last 8 cross-surface events
 */
import Link from "next/link";
import type { DashboardData } from "@/lib/dashboard-data";
import { relativeTime } from "@/lib/dashboard-data";

function fmtPct(v: number | null | undefined, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = signed && v > 0 ? "+" : "";
  return `${s}${v.toFixed(1)}%`;
}
function fmtShares(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}
function fmtScoreBadge(score: number): string {
  if (score >= 75) return "bg-red-500/20 text-red-700 dark:text-red-300";
  if (score >= 60) return "bg-amber-500/20 text-amber-700 dark:text-amber-300";
  if (score >= 45) return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300";
  return "bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60";
}

export default function DashboardView({ data }: { data: DashboardData }) {
  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Today&apos;s view across the research suite. Jump to a tab above, or pick from the
          highlights below.
        </p>
      </header>

      <HeroRow data={data} />
      <SnippetsRow data={data} />
      <ActivityFeed events={data.feed} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Hero row — video on the left, market pulse on the right.
// ---------------------------------------------------------------------------

function HeroRow({ data }: { data: DashboardData }) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
      <VideoCard data={data} />
      <MarketPulseCard data={data} />
    </section>
  );
}

function VideoCard({ data }: { data: DashboardData }) {
  const hero = data.hero;
  if (!hero) {
    return (
      <article className="rounded-lg ring-1 ring-black/10 dark:ring-white/10 p-4 bg-white dark:bg-white/[0.02]">
        <div className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45 mb-3">
          Latest video
        </div>
        <div className="aspect-video rounded bg-black/[0.04] dark:bg-white/[0.04] flex items-center justify-center text-sm text-black/40 dark:text-white/40">
          No video published yet
        </div>
      </article>
    );
  }

  const kindLabel = hero.kind === "weekly_earnings" ? "Weekly Earnings Brief" : "Daily 0DTE Briefing";

  return (
    <article className="rounded-lg ring-1 ring-black/10 dark:ring-white/10 p-4 bg-white dark:bg-white/[0.02]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45">
          Latest video
        </span>
        <span className="text-[11px] text-black/50 dark:text-white/50">{hero.anchorDate}</span>
      </div>

      <Link
        href={hero.videoHref}
        className="block relative aspect-video rounded-md overflow-hidden bg-black group"
        aria-label={`Play ${kindLabel}`}
      >
        {hero.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hero.thumbnailUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-95 group-hover:opacity-100 transition-opacity"
          />
        ) : null}
        <span className="absolute top-2 left-3 text-[10px] uppercase tracking-widest text-white/70">
          {kindLabel}
        </span>
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-14 h-14 rounded-full bg-white/95 text-black flex items-center justify-center group-hover:scale-105 transition-transform">
            <PlayIcon />
          </span>
        </span>
      </Link>

      {hero.caption && (
        <p className="text-sm mt-3 text-black/80 dark:text-white/85 leading-snug line-clamp-2">
          {hero.caption}
        </p>
      )}

      {hero.tickers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {hero.tickers.slice(0, 6).map((t) => (
            <span
              key={t}
              className="px-2 py-0.5 text-[11px] font-mono rounded bg-black/[0.04] dark:bg-white/[0.06] text-black/70 dark:text-white/70"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function MarketPulseCard({ data }: { data: DashboardData }) {
  const { gex, topTradeIdea } = data.pulse;
  return (
    <article className="rounded-lg ring-1 ring-black/10 dark:ring-white/10 p-4 bg-white dark:bg-white/[0.02] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45">
          Market pulse
        </span>
        <span className="text-[11px] text-black/50 dark:text-white/50">
          {gex?.asOf ? relativeTime(gex.asOf) : "—"}
        </span>
      </div>
      <dl className="space-y-2.5 text-sm flex-1">
        <Row
          label="SPY spot"
          value={gex?.spot != null ? `$${gex.spot.toFixed(2)}` : "—"}
        />
        <Row
          label="GEX flip"
          value={
            gex?.flipStrike != null && gex?.flipPct != null
              ? `${gex.flipStrike.toFixed(0)} (${fmtPct(gex.flipPct, true)})`
              : "—"
          }
        />
        <Row
          label="Net dealer gamma"
          value={
            gex?.totalGex != null
              ? `${gex.totalGex >= 0 ? "+" : ""}${gex.totalGex.toFixed(1)}B`
              : "—"
          }
          tone={gex?.totalGex != null ? (gex.totalGex >= 0 ? "pos" : "neg") : undefined}
        />
        <Row
          label="Top trade idea"
          value={
            topTradeIdea ? (
              <Link
                href={topTradeIdea.href}
                className="text-emerald-700 dark:text-emerald-400 hover:underline font-mono text-sm"
              >
                {topTradeIdea.ticker} · {topTradeIdea.label}
              </Link>
            ) : (
              "—"
            )
          }
        />
      </dl>
      <Link
        href="/today"
        className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline mt-3 inline-block"
      >
        Open Today →
      </Link>
    </article>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "pos" | "neg";
}) {
  const toneClass =
    tone === "pos"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "neg"
        ? "text-red-600 dark:text-red-400"
        : "";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-black/55 dark:text-white/55 text-[13px]">{label}</dt>
      <dd className={`font-mono text-sm font-semibold ${toneClass}`}>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Snippets row — Earnings / Squeeze / Sector Flow
// ---------------------------------------------------------------------------

function SnippetsRow({ data }: { data: DashboardData }) {
  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <EarningsCard data={data} />
      <SqueezeCard data={data} />
      <SectorFlowCard data={data} />
    </section>
  );
}

function EarningsCard({ data }: { data: DashboardData }) {
  const e = data.earnings;
  return (
    <Link
      href="/research/earnings"
      className="rounded-lg ring-1 ring-black/10 dark:ring-white/10 p-4 bg-white dark:bg-white/[0.02] hover:bg-black/[0.02] dark:hover:bg-white/[0.04] transition-colors block"
    >
      <CardHeader label="Earnings this week" icon="calendar-event" />
      {e ? (
        <>
          <div className="text-2xl font-semibold leading-tight">{e.totalStocks} reports</div>
          <div className="text-xs text-black/55 dark:text-white/55 mb-3">
            {e.flaggedCount > 0 ? `${e.flaggedCount} flagged asymmetric` : "no asymmetric flags"}
          </div>
          <ul className="text-xs space-y-1">
            {e.upcoming.map((u) => (
              <li key={u.ticker} className="flex justify-between">
                <span className="font-mono">{u.ticker}</span>
                <span className="text-black/50 dark:text-white/50">
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
      className="rounded-lg ring-1 ring-black/10 dark:ring-white/10 p-4 bg-white dark:bg-white/[0.02] hover:bg-black/[0.02] dark:hover:bg-white/[0.04] transition-colors block"
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
          <div className="text-xs text-black/55 dark:text-white/55 mb-3">
            {top.companyName ? `${top.companyName} · ` : ""}
            {top.siPct != null ? `${top.siPct.toFixed(0)}% SI` : "—"} · DTC{" "}
            {top.daysToCover.toFixed(1)}
          </div>
          {top.tradeIdeas.slice(0, 2).map((idea) => (
            <div key={idea.strategy} className="flex justify-between text-xs">
              <span className="text-black/55 dark:text-white/55">
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

function SectorFlowCard({ data }: { data: DashboardData }) {
  const sf = data.sectorFlow;
  return (
    <Link
      href="/sector"
      className="rounded-lg ring-1 ring-black/10 dark:ring-white/10 p-4 bg-white dark:bg-white/[0.02] hover:bg-black/[0.02] dark:hover:bg-white/[0.04] transition-colors block"
    >
      <CardHeader label="Sector flow" icon="chart-bubble" />
      {sf?.top ? (
        <>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-mono font-semibold">{sf.top.ticker}</span>
            <span
              className={`text-sm font-semibold ${
                (sf.top.priceChangePct ?? 0) >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {fmtPct(sf.top.priceChangePct, true)}
            </span>
          </div>
          <div className="text-xs text-black/55 dark:text-white/55 mb-3">
            {sf.top.netFlowShares >= 0 ? "Net buying" : "Net selling"} ·{" "}
            {fmtShares(Math.abs(sf.top.netFlowShares))} shares
          </div>
          <div className="flex items-end gap-1 h-9">
            {sf.bars.map((b) => {
              const max = Math.max(...sf.bars.map((x) => Math.abs(x.netFlowShares)), 1);
              const height = Math.max(8, (Math.abs(b.netFlowShares) / max) * 36);
              return (
                <div
                  key={b.ticker}
                  className={`flex-1 rounded-sm ${
                    b.up ? "bg-emerald-600/80" : "bg-red-600/80"
                  }`}
                  style={{ height: `${height}px` }}
                  title={`${b.ticker} ${b.up ? "+" : ""}${fmtShares(b.netFlowShares)}`}
                />
              );
            })}
          </div>
        </>
      ) : (
        <EmptyMsg>No sector flow data yet</EmptyMsg>
      )}
    </Link>
  );
}

function CardHeader({ label, icon }: { label: string; icon: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2 text-black/50 dark:text-white/55">
      <i className={`ti ti-${icon} text-sm`} aria-hidden="true" />
      <span className="text-[10px] uppercase tracking-widest">{label}</span>
    </div>
  );
}

function EmptyMsg({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-sm text-black/40 dark:text-white/40 py-4 text-center">{children}</div>
  );
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

function ActivityFeed({ events }: { events: DashboardData["feed"] }) {
  return (
    <section className="rounded-lg ring-1 ring-black/10 dark:ring-white/10 p-4 bg-white dark:bg-white/[0.02]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45">
          Recent updates
        </span>
        <span className="text-[11px] text-black/50 dark:text-white/50">
          {events.length} {events.length === 1 ? "event" : "events"}
        </span>
      </div>
      {events.length === 0 ? (
        <EmptyMsg>No recent activity</EmptyMsg>
      ) : (
        <ul className="divide-y divide-black/5 dark:divide-white/5">
          {events.map((e, i) => (
            <li key={`${e.surface}-${i}`} className="py-2.5 first:pt-0 last:pb-0">
              <Link
                href={e.href}
                className="flex items-baseline gap-3 text-sm hover:bg-black/[0.02] dark:hover:bg-white/[0.02] rounded -mx-2 px-2 py-1"
              >
                <span className="text-[11px] font-mono text-black/45 dark:text-white/45 min-w-[64px]">
                  {relativeTime(e.at)}
                </span>
                <span className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45 min-w-[140px]">
                  {e.surface}
                </span>
                <span className="flex-1 text-black/80 dark:text-white/85">
                  {e.title}
                  {e.detail && (
                    <span className="text-black/50 dark:text-white/50"> — {e.detail}</span>
                  )}
                </span>
                <i
                  className={`ti ti-${e.icon} text-sm text-black/40 dark:text-white/40`}
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PlayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
