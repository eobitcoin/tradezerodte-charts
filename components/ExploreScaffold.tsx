import Link from "next/link";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export interface ExplorePageProps {
  /** Slug used in the URL: institutional | earnings | sector-rotation | insider | daily | metals | quantum */
  type: "institutional" | "earnings" | "sector-rotation" | "insider" | "daily" | "metals" | "quantum";
  /** The scan-day this preview is for; powers canonical + JSON-LD */
  scanDay: string;
  /** Pretty title (e.g. "Institutional Flow — May 19, 2026") */
  title: string;
  /** Plain-text description for meta + JSON-LD (1-2 sentences from the post summary) */
  description: string;
  /** The path back to the authenticated post (used by the "Read full analysis" CTA) */
  authedPath: string;
  /** When the underlying scan was run, for JSON-LD datePublished */
  runAt: Date | null;
  /** Optional: list of past scan days for sidebar / SEO crosslinks */
  archive?: Array<{ scanDay: string; href: string; label: string }>;
  children: React.ReactNode;
}

/**
 * Public-facing scaffold for /explore/* preview pages.
 *
 * SECURITY: this scaffold renders only what's passed in via `children` and
 * the metadata props. Hidden post fields (full thesis, complete fund list,
 * etc.) must be stripped at the DB-query layer BEFORE reaching this
 * component — never pass full post data and trust the scaffold to hide it.
 *
 * Renders:
 *  - Public header + footer (no logged-in nav)
 *  - JSON-LD Article structured data (Google rich snippets, indexable)
 *  - Breadcrumb: Home → Explore → {type} → {scanDay}
 *  - Children (the preview content)
 *  - Always-visible signup CTA
 *  - Optional archive crosslinks (drives SEO inventory)
 */
export default function ExploreScaffold({
  type,
  scanDay,
  title,
  description,
  authedPath,
  runAt,
  archive = [],
  children,
}: ExplorePageProps) {
  const canonical = `${APP_URL}/explore/${type}/${scanDay}`;
  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    url: canonical,
    datePublished: runAt ? runAt.toISOString() : undefined,
    publisher: {
      "@type": "Organization",
      name: "Olivia Trades",
      url: APP_URL,
    },
  };
  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      <PublicHeader />
      <main className="flex-1 max-w-4xl mx-auto px-6 py-10 lg:py-14 font-sans w-full">
        {/* Breadcrumb */}
        <nav className="mb-6 text-xs text-white/45">
          <Link href="/welcome" className="hover:text-white">Home</Link>
          <span className="mx-2">·</span>
          <Link href="/explore" className="hover:text-white">Explore</Link>
          <span className="mx-2">·</span>
          <Link href={`/explore/${type}`} className="hover:text-white capitalize">
            {type.replace("-", " ")}
          </Link>
          <span className="mx-2">·</span>
          <span className="text-white/65 font-mono">{scanDay}</span>
        </nav>

        {/* Children: the actual preview content */}
        <div>{children}</div>

        {/* Always-visible signup CTA */}
        <aside className="mt-12 rounded-lg border border-red-500/40 bg-gradient-to-br from-red-500/[0.08] to-transparent p-6 space-y-3 lining-nums">
          <h2 className="text-xl font-bold tracking-tight">
            See the full analysis.
          </h2>
          <p className="text-sm text-white/65 max-w-prose">
            This is a public preview. Logged-in members see every flagged setup, the
            complete thesis on each, the historical data behind the call, and the
            risks. Same scan, full content.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href={`/signup?next=${encodeURIComponent(authedPath)}`}
              className="inline-block px-5 py-3 rounded-md bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold uppercase tracking-[0.22em] shadow-lg shadow-red-900/30 transition-colors"
            >
              Sign up to read more
            </Link>
            <Link
              href={`/login?next=${encodeURIComponent(authedPath)}`}
              className="text-xs text-white/55 hover:text-white hover:underline"
            >
              Already a member? Log in →
            </Link>
          </div>
        </aside>

        {/* Archive crosslinks — drives SEO inventory by linking every past scan */}
        {archive.length > 0 && (
          <section className="mt-12 pt-8 border-t border-white/10">
            <h2 className="text-sm font-bold tracking-tight uppercase text-white/55 mb-4">
              Previous scans
            </h2>
            <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {archive.map((a) => (
                <li key={a.scanDay}>
                  <Link
                    href={a.href}
                    className="block rounded-md border border-white/10 hover:border-red-500/40 hover:bg-white/[0.03] px-3 py-2 text-xs transition-all"
                  >
                    <span className="font-mono text-white/55">{a.scanDay}</span>
                    <span className="ml-2 text-white/75">{a.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}

/**
 * Visual placeholder for a hidden item. Renders a generic locked card with
 * heavy-blur placeholder text. By design this component accepts NO props
 * that could leak identifying information — every locked card is visually
 * identical regardless of which underlying post item it represents. The
 * count of locked cards is the only signal an unauthed user sees about the
 * remaining content.
 */
export function BlurredCard() {
  return (
    <div className="relative rounded-lg border border-white/10 bg-white/[0.02] p-4 overflow-hidden">
      <div className="flex items-baseline gap-3 mb-3">
        <span className="inline-block px-2 py-0.5 text-[10px] uppercase tracking-widest rounded border bg-white/[0.05] text-white/55 border-white/10">
          Locked
        </span>
        <span className="font-bold tracking-tight">— Sign up to reveal —</span>
      </div>
      <div
        className="space-y-2 text-sm text-white/55 select-none pointer-events-none"
        aria-hidden="true"
        style={{ filter: "blur(6px)" }}
      >
        <p>
          The full thesis explains why this specific setup qualified, what the
          historical pattern suggests, and which catalysts are likely.
        </p>
        <p>
          Supporting data, risks, and the precise levels to watch are part of the
          authenticated post — not the public preview.
        </p>
      </div>
    </div>
  );
}
