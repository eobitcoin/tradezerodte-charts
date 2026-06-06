import Link from "next/link";
import type { Metadata } from "next";

/**
 * Public /about page — exists primarily to satisfy Google's OAuth
 * verification reviewers, who require that the "Application home
 * page" URL clearly identifies the app brand and explains its
 * purpose.
 *
 * The standard `/` route is gated to a login form (members-only), so
 * reviewers landing there can't see what the business is. This page
 * is the public-facing equivalent — it's the URL submitted to the
 * Google Auth Platform → Branding → Application home page field.
 *
 * Three things this page MUST do:
 *
 *   1. Display the brand name "Olivia Trades" prominently (resolves
 *      the "OAuth app name doesn't match home page" rejection).
 *   2. Explain what the application does (resolves the "home page
 *      does not explain the purpose of your app" rejection).
 *   3. Be discoverable via the same domain that hosts the privacy
 *      and terms pages (oliviatrades.com), so Google's domain check
 *      ties everything to the same verified property.
 *
 * Keep this page intentionally simple. No interactivity, no auth
 * gate, no marketing fluff. Reviewers want a clear answer to "what
 * does this app do?" in under 60 seconds.
 */

export const metadata: Metadata = {
  title: "About Olivia Trades — daily 0DTE options briefings",
  description:
    "Olivia Trades publishes daily pre-market briefing videos and weekly research scans for 0DTE options traders. AI-generated presenter, human-curated analysis.",
  // Override the site-wide og:site_name for this page so Google
  // reviewers see the new "Olivia Trades" brand even if the rest of
  // the marketing metadata still references the legacy brand.
  openGraph: {
    title: "About Olivia Trades",
    description:
      "Daily 0DTE options briefings + weekly research scans. AI-generated presenter, human-curated analysis.",
    siteName: "Olivia Trades",
    url: "https://www.oliviatrades.com/about",
    type: "website",
  },
  alternates: {
    canonical: "https://www.oliviatrades.com/about",
  },
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-black text-white font-sans">
      <div className="max-w-3xl mx-auto px-6 py-16 space-y-12">
        {/* Brand header */}
        <header className="space-y-3">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            Olivia Trades
          </h1>
          <p className="text-lg text-white/70 leading-relaxed">
            Daily pre-market options briefings and quantitative research
            for traders who specialize in zero-day-to-expiration (0DTE)
            options.
          </p>
        </header>

        {/* What we do */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white/95">What we do</h2>
          <p className="text-white/75 leading-relaxed">
            Every trading day before the open, Olivia Trades publishes
            a focused video briefing that translates live options market
            data into an actionable read for the session. The briefings
            cover Max Pain levels, gamma exposure, unusual options
            activity, IV regime, and the day&apos;s most asymmetric
            single-name setups.
          </p>
          <p className="text-white/75 leading-relaxed">
            On a weekly cadence we also publish:
          </p>
          <ul className="list-disc list-inside text-white/75 space-y-1 pl-2">
            <li>
              An Options Edge IV anomaly scan (Sunday + Tuesday) that
              flags tickers with statistically unusual implied
              volatility readings against their 1-year history.
            </li>
            <li>
              A weekly earnings briefing (Sunday) covering the
              week&apos;s most market-moving reports with proposed
              option-structure trades.
            </li>
            <li>
              Quantitative scans for sell-puts opportunities, calendar
              spreads, and LEAPS candidates, ranked by composite scores
              derived from live Polygon options chain data.
            </li>
          </ul>
        </section>

        {/* AI disclosure */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white/95">
            How the briefings are produced
          </h2>
          <p className="text-white/75 leading-relaxed">
            The presenter you see in our videos (Olivia) is an
            AI-generated character built with{" "}
            <span className="text-white/90">Hedra</span>. The voice is
            synthesized via{" "}
            <span className="text-white/90">ElevenLabs</span>. The
            background music is original composition generated with{" "}
            <span className="text-white/90">Suno AI</span> under our Pro
            commercial license. All visuals, audio, and music are
            disclosed as AI-generated wherever we publish.
          </p>
          <p className="text-white/75 leading-relaxed">
            Everything else — the market analysis, scanner logic, trade
            structures, risk frameworks, and editorial decisions — is
            built and maintained by humans. The numbers are pulled
            fresh against live data on every briefing; nothing is
            cached or recycled.
          </p>
        </section>

        {/* YouTube + distribution */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white/95">
            Where to find us
          </h2>
          <p className="text-white/75 leading-relaxed">
            Daily briefing videos are published to our YouTube channel
            and TikTok. Full research — including the scanner outputs,
            backtests, and the interactive Risk Graph builder — lives
            on this site for invited members.
          </p>
        </section>

        {/* Legal */}
        <section className="space-y-3 border-t border-white/10 pt-8">
          <h2 className="text-sm font-semibold text-white/55 uppercase tracking-widest">
            Legal
          </h2>
          <p className="text-sm text-white/55 leading-relaxed">
            Olivia Trades publishes educational research and commentary.
            Nothing on this site is investment advice. Options trading
            involves substantial risk of loss; trade only with capital
            you can afford to lose. Past results, including backtests
            and scanner scores, do not guarantee future performance.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm pt-2">
            <Link
              href="/privacy"
              className="text-white/70 hover:text-white underline"
            >
              Privacy policy
            </Link>
            <Link
              href="/terms"
              className="text-white/70 hover:text-white underline"
            >
              Terms of service
            </Link>
            <Link
              href="/"
              className="text-white/70 hover:text-white underline"
            >
              Member sign-in
            </Link>
          </div>
        </section>

        <footer className="text-xs text-white/40 pt-8">
          © Olivia Trades · oliviatrades.com
        </footer>
      </div>
    </main>
  );
}
