import type { Metadata } from "next";
import Link from "next/link";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";

export const metadata: Metadata = {
  title: "Learn — 0DTE Options, Max Pain, Gamma, Institutional Flow, Insider Buys",
  description:
    "Long-form, plain-English explainers for every concept used in 0DTE Market Research: 0DTE mechanics, Max Pain, gamma exposure, Polymarket whales, institutional flow, earnings whiplash, sector rotation, insider buys, and the weekly research stack.",
  alternates: { canonical: `${APP_URL}/learn` },
  openGraph: {
    type: "website",
    url: `${APP_URL}/learn`,
    title: "Learn — 0DTE Market Research",
    description:
      "Public, plain-English explainers for the concepts behind the daily and weekly research.",
  },
};

interface LearnEntry {
  href: string;
  title: string;
  blurb: string;
}

const PRIMITIVES: LearnEntry[] = [
  {
    href: "/learn/0dte-options",
    title: "0DTE Options",
    blurb:
      "Same-day expiration mechanics: theta dynamics, gamma magnitude, and why position sizing matters more than direction.",
  },
  {
    href: "/learn/max-pain",
    title: "Max Pain",
    blurb:
      "Where open-interest concentration pins price near expiration, how dealer hedging creates that pin, and the regimes when it breaks.",
  },
  {
    href: "/learn/gamma-exposure",
    title: "Gamma Exposure (GEX)",
    blurb:
      "Dealer hedging flows, the zero-gamma flip, and why positive- vs negative-gamma regimes produce opposite intraday behaviour.",
  },
  {
    href: "/learn/polymarket-whales",
    title: "Polymarket Whales",
    blurb:
      "Composite whale scoring, convergence signals across large prediction-market bettors, and what cross-market agreement actually predicts.",
  },
];

const APP_TABS: LearnEntry[] = [
  {
    href: "/learn/trade-cards",
    title: "Reading the Trade Cards",
    blurb:
      "How each card represents the merged plan for one ticker, what every badge / stamp / status means, and how the four daily scans update the card through the day.",
  },
  {
    href: "/learn/analysis",
    title: "Reading the Analysis Tab",
    blurb:
      "Premarket vs market-open comparison: the high-probability picks rule, lineage labels, grade Δ, direction Δ, and how the LLM narrative fits with the deterministic table.",
  },
  {
    href: "/learn/scorecard",
    title: "Scorecard",
    blurb:
      "Cross-session performance view: cumulative P&L, win rate, time-series bar chart, per-ticker leaderboard. How the buckets work and what the chart actually shows.",
  },
];

const METHODOLOGY: LearnEntry[] = [
  {
    href: "/learn/weekly-research",
    title: "Weekly Research Stack",
    blurb:
      "How the three weekly scans (Institutional Flow, Earnings Whiplash, Sector Rotation) fit together to inform the day's 0DTE bias.",
  },
  {
    href: "/learn/institutional-flow",
    title: "Institutional Flow (13F)",
    blurb:
      "SEC 13F filings, smart-money convergence, and how to spot the stocks hedge funds are quietly accumulating before retail catches on.",
  },
  {
    href: "/learn/earnings-whiplash",
    title: "Earnings Whiplash",
    blurb:
      "When implied move is priced below historical realized move — the long-vol asymmetric setup that earnings season produces.",
  },
  {
    href: "/learn/sector-rotation",
    title: "Sector Rotation",
    blurb:
      "GICS sector relative-strength flips year-over-year — the early signal of leadership changes that show up in headlines weeks later.",
  },
  {
    href: "/learn/insider-buys",
    title: "Insider Buys (Form 4)",
    blurb:
      "SEC Form 4 open-market purchases, why insider buys beat insider sales as a signal, and how dollar-size + position-type filtering works.",
  },
];

const ITEMLIST_LD = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  itemListElement: [...PRIMITIVES, ...APP_TABS, ...METHODOLOGY].map((e, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: e.title,
    url: `${APP_URL}${e.href}`,
  })),
};

export default function LearnIndexPage() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ITEMLIST_LD) }}
      />
      <PublicHeader />
      <main className="flex-1 max-w-5xl mx-auto px-6 py-12 lg:py-16 font-sans w-full">
        <header className="space-y-3 mb-10 max-w-3xl">
          <div className="text-[10px] uppercase tracking-widest text-red-400">
            Public · No signup required
          </div>
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight leading-[1.15]">
            Learn the concepts behind the research.
          </h1>
          <p className="text-base text-white/70 leading-relaxed">
            Plain-English explainers for every primitive the daily and weekly
            research is built on. Read these once and the actual reports stop
            looking like jargon.
          </p>
        </header>

        <section className="mb-14 space-y-5">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold tracking-[0.28em] text-red-500 uppercase">
              Primitives
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-red-500/60 via-red-500/20 to-transparent" />
          </div>
          <p className="text-sm text-white/55 max-w-2xl">
            Core mechanics that show up across every report — start here if
            you&apos;re new to options or to the way dealer flows shape
            intraday tape.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {PRIMITIVES.map((it) => (
              <Card key={it.href} entry={it} />
            ))}
          </div>
        </section>

        <section className="mb-14 space-y-5">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold tracking-[0.28em] text-red-500 uppercase">
              Using the App
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-red-500/60 via-red-500/20 to-transparent" />
          </div>
          <p className="text-sm text-white/55 max-w-2xl">
            How to read the authenticated tabs — what every badge, stamp, and
            chart means. These are the closest thing we have to a user manual.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {APP_TABS.map((it) => (
              <Card key={it.href} entry={it} />
            ))}
          </div>
        </section>

        <section className="mb-14 space-y-5">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold tracking-[0.28em] text-red-500 uppercase">
              Research Methodology
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-red-500/60 via-red-500/20 to-transparent" />
          </div>
          <p className="text-sm text-white/55 max-w-2xl">
            How each specific scan is built — the data sources, the filters,
            the thresholds, and what a flagged setup actually means. Pair
            these with the live previews on the{" "}
            <Link href="/explore" className="text-red-400 hover:underline">
              Explore page
            </Link>
            .
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {METHODOLOGY.map((it) => (
              <Card key={it.href} entry={it} />
            ))}
          </div>
        </section>

        <aside className="mt-8 rounded-lg border border-red-500/40 bg-gradient-to-br from-red-500/[0.08] to-transparent p-6 space-y-3">
          <h2 className="text-xl font-bold tracking-tight">
            Want to see these concepts applied to today&apos;s tape?
          </h2>
          <p className="text-sm text-white/65 max-w-prose">
            The Explore section shows live public previews of every weekly and
            daily scan — the headline pick is fully revealed. Members get the
            complete report.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href="/explore"
              className="inline-block px-5 py-3 rounded-md bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold uppercase tracking-[0.22em] shadow-lg shadow-red-900/30 transition-colors"
            >
              See live previews
            </Link>
            <Link
              href="/signup"
              className="text-xs text-white/55 hover:text-white hover:underline"
            >
              Sign up — Free trial →
            </Link>
          </div>
        </aside>
      </main>
      <PublicFooter />
    </div>
  );
}

function Card({ entry }: { entry: LearnEntry }) {
  return (
    <Link
      href={entry.href}
      className="block rounded-lg border border-white/10 hover:border-red-500/40 hover:bg-white/[0.03] p-4 space-y-2 transition-all"
    >
      <h3 className="text-base font-bold tracking-tight">{entry.title} →</h3>
      <p className="text-xs text-white/55 leading-relaxed">{entry.blurb}</p>
    </Link>
  );
}
