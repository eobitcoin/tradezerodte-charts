import type { Metadata } from "next";
import Link from "next/link";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";
import {
  loadInstitutionalPreview,
  loadEarningsPreview,
  loadSectorRotationPreview,
  loadInsiderPreview,
  loadDailyAnalysisPreview,
} from "@/lib/explore-preview";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";

export const metadata: Metadata = {
  title: "Explore What's Inside — Public Research Previews",
  description:
    "See what 0DTE Market Research publishes for members: weekly institutional flow, earnings whiplash setups, sector rotation, daily insider buys. Public previews of every scan.",
  alternates: { canonical: `${APP_URL}/explore` },
  openGraph: {
    type: "website",
    url: `${APP_URL}/explore`,
    title: "Explore What's Inside — tradezerodte.com",
    description:
      "Public previews of the weekly + daily scans that drive our members' research.",
  },
};

export const dynamic = "force-dynamic";

interface Card {
  href: string;
  badgeTone: "emerald" | "amber" | "sky" | "red";
  category: string;
  title: string;
  blurb: string;
  scanDay: string | null;
  highlight: string | null;
}

export default async function ExploreIndexPage() {
  const [inst, earn, rot, ins, daily] = await Promise.all([
    loadInstitutionalPreview(),
    loadEarningsPreview(),
    loadSectorRotationPreview(),
    loadInsiderPreview(),
    loadDailyAnalysisPreview(),
  ]);

  const cards: Card[] = [
    {
      href: "/explore/daily",
      badgeTone: "red",
      category: "Daily · 0DTE",
      title: "Daily Analysis",
      blurb:
        "Premarket 0DTE research, every session. Top setups graded A+ to F — strike, direction, entry zone, targets, stop. The headline trade is fully revealed.",
      scanDay: daily?.tradingDay ?? null,
      highlight: daily
        ? `${daily.tradeCount} ${daily.tradeCount === 1 ? "trade" : "trades"} graded · top pick: ${daily.headlineTrade?.ticker ?? "—"}`
        : "First scan coming soon",
    },
    {
      href: "/explore/institutional",
      badgeTone: "emerald",
      category: "Weekly · 13F",
      title: "Institutional Flow",
      blurb:
        "Stocks where Berkshire, Bridgewater, and other smart-money funds are quietly accumulating before retail catches on.",
      scanDay: inst?.scanDay ?? null,
      highlight: inst
        ? `${inst.stockCount} ${inst.stockCount === 1 ? "stock" : "stocks"} this scan · headline: ${inst.headline?.ticker ?? "—"}`
        : "First scan coming soon",
    },
    {
      href: "/explore/earnings",
      badgeTone: "amber",
      category: "Weekly · Vol",
      title: "Earnings Whiplash Map",
      blurb:
        "S&P 500 earnings reports where options are pricing in less movement than the stock has historically delivered. Asymmetric long-vol setups.",
      scanDay: earn?.scanDay ?? null,
      highlight: earn
        ? `${earn.stockCount} setups · ${earn.flaggedCount} flagged asymmetric`
        : "First scan coming soon",
    },
    {
      href: "/explore/sector-rotation",
      badgeTone: "sky",
      category: "Weekly · Macro",
      title: "Sector Rotation Detector",
      blurb:
        "Sectors where relative strength has flipped vs the same window last year. Where capital is moving before headlines pick it up.",
      scanDay: rot?.scanDay ?? null,
      highlight: rot
        ? `${rot.rotatingCount} of ${rot.sectorCount} sectors rotating`
        : "First scan coming soon",
    },
    {
      href: "/explore/insider",
      badgeTone: "emerald",
      category: "Daily · Form 4",
      title: "Insider Buys",
      blurb:
        "Largest open-market insider purchases of the day, ranked by dollar value. CEOs and CFOs putting personal capital in.",
      scanDay: ins?.scanDay ?? null,
      highlight: ins
        ? `${ins.buyCount} qualifying buys · headline: ${ins.headline?.ticker ?? "—"}`
        : "First scan coming soon",
    },
  ];

  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <PublicHeader />
      <main className="flex-1 max-w-5xl mx-auto px-6 py-12 lg:py-16 font-sans w-full">
        <header className="space-y-3 mb-10 max-w-3xl">
          <div className="text-[10px] uppercase tracking-widest text-red-400">
            Public previews
          </div>
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight leading-[1.15]">
            Explore What&apos;s Inside
          </h1>
          <p className="text-base text-white/70 leading-relaxed">
            Every scan published to members has a public preview here. The headline
            pick is fully revealed; the rest is members-only. Daily premarket 0DTE
            analysis, daily insider buys, plus weekly institutional flow, earnings
            whiplash, and sector rotation scans.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="block rounded-lg border border-white/10 hover:border-red-500/40 hover:bg-white/[0.03] p-5 space-y-3 transition-all"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${
                    c.badgeTone === "emerald"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : c.badgeTone === "amber"
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                        : c.badgeTone === "sky"
                          ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
                          : "border-red-500/30 bg-red-500/10 text-red-300"
                  }`}
                >
                  {c.category}
                </span>
                {c.scanDay && (
                  <span className="text-[10px] font-mono text-white/45">{c.scanDay}</span>
                )}
              </div>
              <h2 className="text-xl font-bold tracking-tight">{c.title} →</h2>
              <p className="text-sm text-white/65 leading-relaxed">{c.blurb}</p>
              {c.highlight && (
                <div className="text-xs text-white/55 pt-2 border-t border-white/5">
                  {c.highlight}
                </div>
              )}
            </Link>
          ))}
        </div>

        <aside className="mt-12 rounded-lg border border-red-500/40 bg-gradient-to-br from-red-500/[0.08] to-transparent p-6 space-y-3">
          <h2 className="text-xl font-bold tracking-tight">
            See every flagged setup, full thesis, complete data.
          </h2>
          <p className="text-sm text-white/65 max-w-prose">
            Members get the full report on every scan — all flagged names, the
            complete thesis on each, the supporting data, and the risks. Same
            scans, full content. Daily 0DTE trade-idea reports and 5+ other tabs
            of research included.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href="/signup"
              className="inline-block px-5 py-3 rounded-md bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold uppercase tracking-[0.22em] shadow-lg shadow-red-900/30 transition-colors"
            >
              Sign up — Free trial
            </Link>
            <Link
              href="/login"
              className="text-xs text-white/55 hover:text-white hover:underline"
            >
              Already a member? Log in →
            </Link>
          </div>
        </aside>
      </main>
      <PublicFooter />
    </div>
  );
}
