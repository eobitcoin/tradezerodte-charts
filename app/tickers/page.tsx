import type { Metadata } from "next";
import Link from "next/link";
import AdaptiveHeader from "@/components/AdaptiveHeader";
import PublicFooter from "@/components/PublicFooter";
import { listAllCoveredTickers } from "@/lib/tickers-public";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

/**
 * /tickers — alphabetical index of every ticker covered in at least one
 * published brief. Each entry links to /tickers/[symbol], the per-ticker
 * hub. Jump-to-letter anchors at the top help scrolling on long lists.
 *
 * The index is what Google crawls to discover hub pages. It's also linked
 * from the per-hub footer + sitemap, so it sits at the center of the
 * internal-link graph for ticker queries.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tickers — Olivia Trades Coverage Index",
  description:
    "Every ticker Olivia Trades has covered in a daily 0DTE brief or Sunday weekly earnings brief. Tap any symbol for the full coverage page.",
  alternates: { canonical: `${APP_URL}/tickers` },
  openGraph: {
    type: "website",
    url: `${APP_URL}/tickers`,
    title: "Tickers — Olivia Trades Coverage Index",
    description:
      "Browse every stock and ETF covered by Olivia Trades — daily 0DTE setups and weekly earnings briefs.",
  },
};

export default async function TickersIndexPage() {
  const tickers = await listAllCoveredTickers();

  // Group by first letter for jump-anchored navigation.
  const grouped: Record<string, string[]> = {};
  for (const t of tickers) {
    const letter = /^[A-Z]/.test(t[0]) ? t[0] : "#";
    if (!grouped[letter]) grouped[letter] = [];
    grouped[letter].push(t);
  }
  const letters = Object.keys(grouped).sort();

  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <AdaptiveHeader />
      <main className="flex-1 max-w-5xl mx-auto px-6 py-10 lg:py-14 font-sans w-full">
        <header className="space-y-3 mb-10 max-w-3xl">
          <div className="text-[10px] uppercase tracking-widest text-red-400">
            Ticker index
          </div>
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight leading-[1.1]">
            Olivia&apos;s coverage, by ticker.
          </h1>
          <p className="text-sm lg:text-base text-white/75 leading-relaxed">
            Every stock and ETF that&apos;s appeared in a daily 0DTE recap or
            the Sunday weekly earnings brief. Tap a symbol for every clip and
            piece of research we&apos;ve published on it.
          </p>
        </header>

        {tickers.length === 0 ? (
          <div className="rounded border border-white/10 bg-white/[0.02] p-8 text-center text-sm text-white/55">
            No briefs published yet. Check back soon.
          </div>
        ) : (
          <>
            {/* Jump-to-letter strip */}
            <nav className="mb-8 flex flex-wrap gap-1.5 text-xs">
              {letters.map((l) => (
                <a
                  key={l}
                  href={`#letter-${l}`}
                  className="inline-flex items-center justify-center w-8 h-8 rounded border border-white/15 bg-white/[0.02] text-white/65 hover:bg-white/[0.06] hover:text-white font-mono"
                >
                  {l}
                </a>
              ))}
            </nav>

            <div className="space-y-8">
              {letters.map((l) => (
                <section key={l} id={`letter-${l}`}>
                  <h2 className="text-xs uppercase tracking-widest text-white/45 mb-3 font-mono">
                    {l}
                  </h2>
                  <ul className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                    {grouped[l].map((t) => (
                      <li key={t}>
                        <Link
                          href={`/tickers/${t}`}
                          className="block rounded-md border border-white/10 bg-white/[0.02] hover:border-red-500/40 hover:bg-white/[0.06] px-3 py-2 text-sm font-mono font-bold tracking-tight text-white/85 hover:text-white text-center"
                        >
                          ${t}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
