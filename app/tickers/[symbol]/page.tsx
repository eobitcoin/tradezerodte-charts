import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdaptiveHeader from "@/components/AdaptiveHeader";
import PublicFooter from "@/components/PublicFooter";
import ResearchTeaserCard from "@/components/ResearchTeaserCard";
import { loadBriefCoverageForTicker } from "@/lib/tickers-public";
import { loadResearchForTicker } from "@/lib/research-by-ticker";
import {
  buildTickerCanonicalUrl,
  buildTickerSeoTitle,
  buildTickerSeoDescription,
  buildTickerJsonLd,
} from "@/lib/ticker-hub-seo";

/**
 * /tickers/[symbol] — the per-ticker hub page.
 *
 * Two sections:
 *   1. Briefs (free) — every daily 0DTE and Sunday weekly earnings clip
 *      that covered this ticker. Each links to the canonical brief page.
 *   2. Research (members only) — locked teasers for daily DTE posts,
 *      Wicked Stocks, insider, institutional, earnings whiplash, max
 *      pain. Each links to the existing public preview (or member URL
 *      where no preview exists); the existing paywall pattern + signup
 *      CTA already handle the gate.
 *
 * 404s when the ticker has zero coverage in either bucket (avoids the
 * thin-content penalty Google applies to pages that exist but have nothing
 * to say).
 */

// Loose ticker shape — 1-6 alphanumerics + dot/hyphen for things like BRK.B.
// Validation also happens at the loader queries (which only match exact-cased
// symbols already in the DB), so a malicious anchor won't hit anything.
const SYMBOL_RE = /^[A-Za-z0-9.\-]{1,6}$/;

interface PageProps {
  params: Promise<{ symbol: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { symbol } = await params;
  if (!SYMBOL_RE.test(symbol)) return { title: "Ticker — Olivia Trades" };
  const t = symbol.toUpperCase();
  const [briefs, research] = await Promise.all([
    loadBriefCoverageForTicker(t, 60),
    loadResearchForTicker(t, 5),
  ]);
  if (briefs.length === 0 && research.length === 0) {
    return {
      title: `$${t} — Olivia Trades`,
      robots: { index: false, follow: false },
    };
  }
  const title = buildTickerSeoTitle(t, briefs.length);
  const description = buildTickerSeoDescription(t, briefs, research);
  const url = buildTickerCanonicalUrl(t);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      title,
      description,
    },
  };
}

const KIND_TONE: Record<"daily" | "weekly", string> = {
  daily: "border-red-500/40 text-red-300 bg-red-500/[0.08]",
  weekly: "border-violet-500/40 text-violet-300 bg-violet-500/[0.08]",
};
const KIND_LABEL: Record<"daily" | "weekly", string> = {
  daily: "Daily 0DTE",
  weekly: "Weekly Earnings",
};

export default async function TickerHubPage({ params }: PageProps) {
  const { symbol } = await params;
  if (!SYMBOL_RE.test(symbol)) notFound();
  const t = symbol.toUpperCase();

  const [briefs, research] = await Promise.all([
    loadBriefCoverageForTicker(t, 60),
    loadResearchForTicker(t, 5),
  ]);

  if (briefs.length === 0 && research.length === 0) notFound();

  const jsonLd = buildTickerJsonLd(t, briefs, research);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <AdaptiveHeader />
      <main className="flex-1 max-w-5xl mx-auto px-6 py-10 lg:py-14 font-sans w-full">
        <nav className="mb-6 text-xs text-white/45">
          <Link href="/welcome" className="hover:text-white">
            Home
          </Link>
          <span className="mx-2">·</span>
          <Link href="/tickers" className="hover:text-white">
            Tickers
          </Link>
          <span className="mx-2">·</span>
          <span className="text-white/65 font-mono">${t}</span>
        </nav>

        {/* HERO */}
        <header className="space-y-3 mb-10 max-w-3xl">
          <div className="text-[10px] uppercase tracking-widest text-red-400">
            Ticker coverage
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold tracking-tight leading-[1]">
            ${t}
          </h1>
          <p className="text-sm lg:text-base text-white/75 leading-relaxed">
            Every brief and research piece from Olivia Trades that has covered{" "}
            <span className="font-mono font-bold">{t}</span> in the last 60
            days. Daily 0DTE recaps and the Sunday earnings brief are free
            to watch. Members get the full premarket plan, IV map, insider
            flow, and Wicked Stocks levels.
          </p>
        </header>

        {/* SECTION 1: BRIEFS (free) */}
        <section className="mb-12">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-white/65">
              Briefs
            </h2>
            <span className="text-[10px] uppercase tracking-widest text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/[0.08]">
              Free
            </span>
          </div>
          {briefs.length > 0 ? (
            <ul className="space-y-2">
              {briefs.map((b) => (
                <li key={`${b.kind}:${b.date}`}>
                  <Link
                    href={b.url}
                    className="group flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.02] hover:border-red-500/40 hover:bg-white/[0.04] px-3 py-3 transition-colors"
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/[0.04] text-white/55 group-hover:text-white/85"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="h-4 w-4"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span
                          className={`text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border ${KIND_TONE[b.kind]}`}
                        >
                          {KIND_LABEL[b.kind]}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-sm font-medium text-white/85 group-hover:text-white">
                        {b.title}
                      </div>
                      {b.excerpt && (
                        <div className="mt-0.5 truncate text-xs text-white/45">
                          {b.excerpt}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-white/45 group-hover:text-red-300 whitespace-nowrap">
                      Watch →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-white/45 italic">
              No briefs have covered ${t} recently.
            </p>
          )}
        </section>

        {/* SECTION 2: RESEARCH (members only) */}
        <section className="mb-12">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-white/65">
              Research
            </h2>
            <span className="text-[10px] uppercase tracking-widest text-amber-300 px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/[0.08]">
              Members only
            </span>
          </div>
          {research.length > 0 ? (
            <>
              <ul className="space-y-2">
                {research.map((r) => (
                  <ResearchTeaserCard key={`${r.kind}:${r.date}`} item={r} />
                ))}
              </ul>
              <div className="mt-4">
                <Link
                  href="/welcome#waitlist"
                  className="inline-block px-5 py-3 rounded-md bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold uppercase tracking-[0.22em] shadow-lg shadow-red-900/30 transition-colors"
                >
                  Sign up to unlock full research
                </Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-white/45 italic">
              No member research has covered ${t} in the last 60 days.
            </p>
          )}
        </section>

        {/* FOOTER NAV */}
        <aside className="border-t border-white/10 pt-6 text-xs text-white/55">
          <Link href="/tickers" className="hover:text-white underline">
            ← All covered tickers
          </Link>
        </aside>
      </main>
      <PublicFooter />
    </div>
  );
}
