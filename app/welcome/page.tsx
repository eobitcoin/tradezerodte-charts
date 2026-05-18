import type { Metadata } from "next";
import Link from "next/link";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";
import WaitlistForm from "@/components/WaitlistForm";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";

export const metadata: Metadata = {
  title: "0DTE Market Research — Invite-Only Private Research",
  description:
    "Trader-grade daily 0DTE options research, Max Pain & gamma analytics, Polymarket whale tracking, equity radar, crypto coverage, and a regime-aware economic calendar. Apply for an invitation.",
  alternates: { canonical: `${APP_URL}/welcome` },
  openGraph: {
    type: "website",
    url: `${APP_URL}/welcome`,
    title: "0DTE Market Research — Invite-Only Private Research",
    description:
      "Trader-grade daily 0DTE research, Max Pain & GEX analytics, Polymarket whale tracking, equity radar, crypto coverage. Apply for an invitation.",
  },
};

const ORG_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "0DTE Market Research",
  url: APP_URL,
  description:
    "Invite-only private research for 0DTE options traders: daily trade ideas, Max Pain & gamma analytics, per-ticker research reports, equity radar, Polymarket whale tracking, crypto coverage, regime-aware economic calendar.",
  sameAs: [],
};

/** Standard product-screenshot frame. Drop-in for `<img>`. */
function FeatureImage({ src, alt }: { src: string; alt: string }) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="w-full aspect-[16/10] rounded-lg border border-white/10 object-cover object-top shadow-2xl shadow-black/40"
    />
  );
}

/** Placeholder for features that don't have a screenshot yet. */
function FeatureImageSlot({ label }: { label: string }) {
  return (
    <div
      aria-hidden
      className="w-full aspect-[16/10] rounded-lg border border-white/10 relative overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-950 to-black"
    >
      <div
        className="absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(40% 30% at 25% 30%, rgba(220,38,38,0.25) 0%, rgba(0,0,0,0) 60%), radial-gradient(40% 30% at 75% 70%, rgba(245,158,11,0.12) 0%, rgba(0,0,0,0) 60%)",
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-[0.28em] text-white/30 font-mono">
        {label}
      </div>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <div className="min-h-screen bg-black text-white font-serif flex flex-col lining-nums">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_LD) }}
      />
      <PublicHeader />

      {/* HERO ----------------------------------------------------------------- */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(60% 50% at 30% 30%, rgba(220,38,38,0.14) 0%, rgba(0,0,0,0) 60%), radial-gradient(50% 40% at 75% 70%, rgba(245,158,11,0.08) 0%, rgba(0,0,0,0) 60%)",
          }}
        />
        <div className="relative max-w-6xl mx-auto px-6 py-20 lg:py-28 grid lg:grid-cols-[1.1fr_1fr] gap-12 items-center">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <span className="font-sans text-[10px] font-bold tracking-[0.32em] text-red-500 uppercase">
                Invite-Only Private Research
              </span>
              <span className="h-px flex-1 bg-gradient-to-r from-red-500/60 via-red-500/20 to-transparent" />
            </div>
            <h1 className="text-4xl lg:text-5xl xl:text-6xl font-bold tracking-tight leading-[1.05] text-white">
              Daily 0DTE research,{" "}
              <span className="italic text-white/80">private.</span>
            </h1>
            <p className="text-lg lg:text-xl text-white/65 leading-relaxed max-w-2xl font-sans">
              Trader-grade Max Pain &amp; gamma-exposure analytics, Polymarket
              whale tracking, regime-aware economic calendar, multi-timeframe
              equity radar, full crypto coverage — and a daily 0DTE options
              brief that lands before the open.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href="#waitlist"
                className="font-sans inline-block px-5 py-3 rounded-md bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold uppercase tracking-[0.22em] shadow-lg shadow-red-900/30 transition-colors"
              >
                Request an Invitation
              </Link>
              <Link
                href="/learn/0dte-options"
                className="font-sans inline-block px-5 py-3 rounded-md border border-white/20 text-white hover:bg-white/10 text-[11px] font-bold uppercase tracking-[0.22em] transition-colors"
              >
                Learn what we cover →
              </Link>
            </div>
          </div>
          <FeatureImage src="/assets/landing/hero-preview.png" alt="0DTE Market Research today view with daily trade summary" />
        </div>
      </section>

      {/* FEATURES — large cards ---------------------------------------------- */}
      <section id="features" className="border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-20 space-y-12">
          <div className="space-y-3 max-w-2xl">
            <div className="flex items-center gap-3">
              <span className="font-sans text-[10px] font-bold tracking-[0.32em] text-red-500 uppercase">
                What&apos;s Inside
              </span>
              <span className="h-px flex-1 bg-gradient-to-r from-red-500/60 via-red-500/20 to-transparent" />
            </div>
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight">
              Six core tools, one daily workflow.
            </h2>
            <p className="text-base text-white/65 leading-relaxed font-sans">
              Built around the questions a 0DTE trader actually asks every
              morning: what&apos;s the regime, where&apos;s the pin, who&apos;s
              positioning, what&apos;s the macro setup, and what&apos;s on the
              calendar.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-x-12 gap-y-16">
            {/* 1. Daily 0DTE Trade Plan */}
            <div className="space-y-4">
              <FeatureImage src="/assets/landing/Daily0DTEOptionsAnalysis.png" alt="Daily 0DTE Options Analysis trade summary table with grades, entries, targets, stops, time stops" />
              <div className="space-y-2">
                <h3 className="text-xl font-bold tracking-tight">Daily 0DTE Trade Plan</h3>
                <p className="text-sm text-white/65 leading-relaxed font-sans">
                  Letter-graded trade ideas delivered before the open. Each plan
                  ships with strike, entry zone, T1 and T2 targets, hard stop,
                  time stop, and a one-line rationale. The full writeup explains
                  the day&apos;s regime, microstructure context, and the
                  setups behind every grade.
                </p>
              </div>
            </div>

            {/* 2. Per-Ticker Research Reports */}
            <div className="space-y-4">
              <FeatureImage src="/assets/landing/EquityResearchReports.png" alt="Per-ticker long-form equity research report with structure, levels, and projections" />
              <div className="space-y-2">
                <h3 className="text-xl font-bold tracking-tight">Per-Ticker Research Reports</h3>
                <p className="text-sm text-white/65 leading-relaxed font-sans">
                  Long-form analysis on individual tickers, on demand. Harmonic
                  patterns, AB=CD measured moves, key support and resistance
                  with explicit price-action rationale. The sidebar surfaces
                  prior research so you can track how the thesis evolved.
                </p>
              </div>
            </div>

            {/* 3. Max Pain & Gamma Exposure */}
            <div className="space-y-4">
              <FeatureImage src="/assets/landing/EquityMaxPain.png" alt="Max Pain & Gamma Exposure scanner showing TSLA detail with max pain, zero-gamma flip, call wall, put wall, and expiration table" />
              <div className="space-y-2">
                <h3 className="text-xl font-bold tracking-tight">Max Pain &amp; Gamma Exposure</h3>
                <p className="text-sm text-white/65 leading-relaxed font-sans">
                  Daily dealer-positioning snapshot for indices and the
                  watchlist: max-pain strike, zero-gamma flip, call wall, put
                  wall, regime classification (POS/NEG/FLIP), per-expiration
                  Net GEX, and HIGH/MED/LOW alerts on regime changes and wall
                  breaks.
                </p>
              </div>
            </div>

            {/* 4. Equity Radar */}
            <div className="space-y-4">
              <FeatureImage src="/assets/landing/stockRadar.png" alt="Equity Radar showing TradingView buy/sell signals across 4H, Daily, and Weekly timeframes for 18 tickers" />
              <div className="space-y-2">
                <h3 className="text-xl font-bold tracking-tight">Multi-Timeframe Equity Radar</h3>
                <p className="text-sm text-white/65 leading-relaxed font-sans">
                  TradingView buy/sell signals across 4H, Daily, and Weekly
                  timeframes for 18 watchlist tickers. Tickers with all three
                  timeframes aligned float to the top. Signal type, price at
                  signal, and time of arrival captured automatically — no
                  manual chart-checking.
                </p>
              </div>
            </div>

            {/* 5. Polymarket Whale Tracking */}
            <div className="space-y-4">
              <FeatureImage src="/assets/landing/polymarket.png" alt="Polymarket Live Whales feed showing $500+ trades with trader pseudonyms, price, size, and USD value" />
              <div className="space-y-2">
                <h3 className="text-xl font-bold tracking-tight">Polymarket Whale Tracking</h3>
                <p className="text-sm text-white/65 leading-relaxed font-sans">
                  Live firehose of $500+ Polymarket trades, a composite-score
                  leaderboard ranking every wallet by realized PnL and ROI,
                  and convergence signals when multiple high-scoring wallets
                  enter the same position.
                </p>
              </div>
            </div>

            {/* 6. Crypto Coverage */}
            <div className="space-y-4">
              <FeatureImage src="/assets/landing/cryptoResearch.png" alt="Crypto Research page with daily trade plans for BTC, ETH, SOL, BNB" />
              <div className="space-y-2">
                <h3 className="text-xl font-bold tracking-tight">Crypto Coverage</h3>
                <p className="text-sm text-white/65 leading-relaxed font-sans">
                  Daily research with explicit trade plans for top crypto
                  tickers, plus weekly long-form writeups with chart context.
                  Live max-pain &amp; GEX for BTC and ETH options (Deribit-
                  sourced), and a multi-timeframe radar across 14 USDT pairs
                  for momentum confirmation.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECONDARY FEATURES — smaller strip ----------------------------------- */}
      <section className="border-b border-white/10 bg-white/[0.015]">
        <div className="max-w-6xl mx-auto px-6 py-16 space-y-8">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-3">
              <span className="font-sans text-[10px] font-bold tracking-[0.32em] text-red-500 uppercase">
                Also Included
              </span>
              <span className="h-px flex-1 bg-gradient-to-r from-red-500/60 via-red-500/20 to-transparent" />
            </div>
            <h2 className="text-2xl lg:text-3xl font-bold tracking-tight">
              Two more, quietly running in the background.
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-x-10 gap-y-12">
            {/* Trade Calendar */}
            <div className="space-y-3">
              <FeatureImage src="/assets/landing/TopTradesCalendar.png" alt="Trade Calendar showing month-grid view with each day's top-graded tickers" />
              <div className="space-y-1.5">
                <h3 className="text-lg font-semibold tracking-tight">Trade Calendar Archive</h3>
                <p className="text-sm text-white/60 leading-relaxed font-sans">
                  Every day&apos;s research, indexed by trading day. The cell
                  shows the top-graded tickers at a glance; click through to
                  the full post. Reviewing closed days is the
                  highest-leverage habit a 0DTE trader can build.
                </p>
              </div>
            </div>

            {/* Economic Calendar */}
            <div className="space-y-3">
              <FeatureImage src="/assets/landing/economicCalendar.png" alt="Economic Calendar showing weekly US macro events including Fed Chair confirmation vote and CPI YoY with regime-aware impact narratives" />
              <div className="space-y-1.5">
                <h3 className="text-lg font-semibold tracking-tight">Regime-Aware Economic Calendar</h3>
                <p className="text-sm text-white/60 leading-relaxed font-sans">
                  Weekly preview of US macro releases (CPI, NFP, FOMC, retail
                  sales, Treasury auctions) with bespoke impact narratives.
                  Each event includes asset-class exposure tags and the
                  asymmetric reaction profile a hot-vs-cold print implies for
                  SPX, rates, USD, and VIX.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* EXPLORE WHAT'S INSIDE ---------------------------------------------- */}
      <section className="border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-16 space-y-8">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-3">
              <span className="font-sans text-[10px] font-bold tracking-[0.32em] text-red-500 uppercase">
                Explore What&apos;s Inside
              </span>
              <span className="h-px flex-1 bg-gradient-to-r from-red-500/60 via-red-500/20 to-transparent" />
            </div>
            <h2 className="text-2xl lg:text-3xl font-bold tracking-tight">
              See a real scan before you sign up.
            </h2>
            <p className="text-sm text-white/65 leading-relaxed font-sans pt-2">
              Every weekly and daily scan published to members has a public
              preview. The headline pick is fully revealed — full thesis,
              full data. The rest is members-only. Browse live or click through
              the past-scan archive.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <Link
              href="/explore/daily"
              className="block rounded-lg border border-white/10 hover:border-red-500/40 hover:bg-white/[0.03] p-4 space-y-2 transition-all"
            >
              <span className="text-[10px] uppercase tracking-widest text-red-300/80">
                Daily · 0DTE
              </span>
              <h3 className="text-base font-semibold tracking-tight">
                Daily Analysis →
              </h3>
              <p className="text-xs text-white/55 leading-relaxed">
                Premarket 0DTE research, every session. Top setups graded A+ to F. Headline trade fully revealed.
              </p>
            </Link>
            <Link
              href="/explore/institutional"
              className="block rounded-lg border border-white/10 hover:border-emerald-500/40 hover:bg-white/[0.03] p-4 space-y-2 transition-all"
            >
              <span className="text-[10px] uppercase tracking-widest text-emerald-300/80">
                Weekly · 13F
              </span>
              <h3 className="text-base font-semibold tracking-tight">
                Institutional Flow →
              </h3>
              <p className="text-xs text-white/55 leading-relaxed">
                Where Berkshire, Bridgewater, Citadel are quietly accumulating before retail catches on.
              </p>
            </Link>
            <Link
              href="/explore/earnings"
              className="block rounded-lg border border-white/10 hover:border-amber-500/40 hover:bg-white/[0.03] p-4 space-y-2 transition-all"
            >
              <span className="text-[10px] uppercase tracking-widest text-amber-300/80">
                Weekly · Vol
              </span>
              <h3 className="text-base font-semibold tracking-tight">
                Earnings Whiplash Map →
              </h3>
              <p className="text-xs text-white/55 leading-relaxed">
                S&amp;P 500 names where options are priced below historical realized — asymmetric long-vol setups.
              </p>
            </Link>
            <Link
              href="/explore/sector-rotation"
              className="block rounded-lg border border-white/10 hover:border-sky-500/40 hover:bg-white/[0.03] p-4 space-y-2 transition-all"
            >
              <span className="text-[10px] uppercase tracking-widest text-sky-300/80">
                Weekly · Macro
              </span>
              <h3 className="text-base font-semibold tracking-tight">
                Sector Rotation →
              </h3>
              <p className="text-xs text-white/55 leading-relaxed">
                Sectors where relative strength just flipped vs the same window last year. Capital moving early.
              </p>
            </Link>
            <Link
              href="/explore/insider"
              className="block rounded-lg border border-white/10 hover:border-emerald-500/40 hover:bg-white/[0.03] p-4 space-y-2 transition-all"
            >
              <span className="text-[10px] uppercase tracking-widest text-emerald-300/80">
                Daily · Form 4
              </span>
              <h3 className="text-base font-semibold tracking-tight">
                Insider Buys →
              </h3>
              <p className="text-xs text-white/55 leading-relaxed">
                Largest open-market insider buys of the day. CEOs and CFOs putting personal capital in.
              </p>
            </Link>
          </div>

          <div className="pt-2">
            <Link
              href="/explore"
              className="inline-block text-xs text-white/65 hover:text-white hover:underline"
            >
              See all public previews →
            </Link>
          </div>
        </div>
      </section>

      {/* PHILOSOPHY ---------------------------------------------------------- */}
      <section className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-6 py-20 space-y-6">
          <div className="flex items-center gap-3">
            <span className="font-sans text-[10px] font-bold tracking-[0.32em] text-red-500 uppercase">
              The Approach
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-red-500/60 via-red-500/20 to-transparent" />
          </div>
          <h2 className="text-3xl font-bold tracking-tight italic">
            Built by a trader, for traders who size their stops.
          </h2>
          <div className="space-y-4 text-base text-white/70 leading-relaxed font-sans">
            <p>
              0DTE Market Research isn&apos;t a signal service or a copy-trade
              platform. It&apos;s the research stack we use every morning to
              size our own positions — published daily so other serious traders
              can run their own analysis on the same primitives.
            </p>
            <p>
              Every trade plan ships with an explicit hard stop and time stop.
              Every grade comes with a rationale. The Max Pain scanner posts
              alerts when the regime changes, not when noise crosses a
              threshold. And we tell you when a setup is an avoid.
            </p>
            <p className="text-white/55">
              We keep the audience small on purpose. The signals work because
              the room knows what it&apos;s reading.
            </p>
          </div>
        </div>
      </section>

      {/* WAITLIST ------------------------------------------------------------ */}
      <section id="waitlist" className="border-b border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-12 items-start">
          <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="flex items-center gap-3">
              <span className="font-sans text-[10px] font-bold tracking-[0.32em] text-red-500 uppercase">
                How to Get In
              </span>
              <span className="h-px flex-1 bg-gradient-to-r from-red-500/60 via-red-500/20 to-transparent" />
            </div>
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight">
              Apply for an invitation.
            </h2>
            <div className="space-y-3 text-sm text-white/65 leading-relaxed font-sans">
              <p>
                We review every signup individually. The site is invite-only
                because the value of the research scales inversely with the
                size of the room — we keep it small.
              </p>
              <p>
                When you&apos;re ready to join, you&apos;ll get a one-time email
                with a link to set your password and sign in. Initial access is
                set per-invitation; we extend on request.
              </p>
            </div>
            <ul className="space-y-2 text-sm text-white/60 font-sans pt-2">
              <li className="flex items-baseline gap-2">
                <span className="text-red-500">●</span>
                <span>Two emails total: application received, then invitation ready.</span>
              </li>
              <li className="flex items-baseline gap-2">
                <span className="text-red-500">●</span>
                <span>No marketing spam, ever.</span>
              </li>
              <li className="flex items-baseline gap-2">
                <span className="text-red-500">●</span>
                <span>Decline rate is real — apply with a serious reason.</span>
              </li>
            </ul>
          </div>
          <WaitlistForm />
        </div>
      </section>

      {/* LEARN PROMO --------------------------------------------------------- */}
      <section className="border-b border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-16 space-y-10">
          <div className="space-y-2 max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight">
              While you wait, learn the primitives.
            </h2>
            <p className="text-sm text-white/55 font-sans">
              Nine short explainers for the concepts the daily and weekly
              research is built on. Public; no signup required.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold tracking-[0.28em] text-red-500 uppercase">
                Primitives
              </span>
              <span className="h-px flex-1 bg-gradient-to-r from-red-500/60 via-red-500/20 to-transparent" />
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { href: "/learn/0dte-options", title: "0DTE Options", desc: "Same-day expiration: theta, gamma, and why size matters." },
                { href: "/learn/max-pain", title: "Max Pain", desc: "Where the open-interest pin lives, and why it pulls price." },
                { href: "/learn/gamma-exposure", title: "Gamma Exposure", desc: "Dealer hedging, the zero-gamma flip, and POS vs NEG regimes." },
                { href: "/learn/polymarket-whales", title: "Polymarket Whales", desc: "Composite scoring, convergence signals, and what they mean." },
              ].map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className="block rounded-lg border border-white/10 hover:border-red-500/40 hover:bg-white/[0.03] p-4 transition-all group"
                >
                  <h3 className="font-bold text-base group-hover:text-red-400 transition-colors">
                    {it.title} →
                  </h3>
                  <p className="text-xs text-white/55 leading-relaxed font-sans mt-1">{it.desc}</p>
                </Link>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold tracking-[0.28em] text-red-500 uppercase">
                Research Methodology
              </span>
              <span className="h-px flex-1 bg-gradient-to-r from-red-500/60 via-red-500/20 to-transparent" />
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { href: "/learn/weekly-research", title: "Weekly Research Stack", desc: "How the three weekly scans combine to inform the day's 0DTE bias." },
                { href: "/learn/institutional-flow", title: "Institutional Flow", desc: "13F filings, smart-money convergence, and accumulation signals." },
                { href: "/learn/earnings-whiplash", title: "Earnings Whiplash", desc: "When implied move is priced below historical realized — long-vol setups." },
                { href: "/learn/sector-rotation", title: "Sector Rotation", desc: "GICS relative-strength flips year-over-year. Leadership changes early." },
                { href: "/learn/insider-buys", title: "Insider Buys (Form 4)", desc: "Open-market purchases, dollar-size filters, and signal vs noise." },
              ].map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className="block rounded-lg border border-white/10 hover:border-red-500/40 hover:bg-white/[0.03] p-4 transition-all group"
                >
                  <h3 className="font-bold text-base group-hover:text-red-400 transition-colors">
                    {it.title} →
                  </h3>
                  <p className="text-xs text-white/55 leading-relaxed font-sans mt-1">{it.desc}</p>
                </Link>
              ))}
            </div>
          </div>

          <div>
            <Link
              href="/learn"
              className="inline-block text-xs text-white/65 hover:text-white hover:underline"
            >
              See all explainers in one place →
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
