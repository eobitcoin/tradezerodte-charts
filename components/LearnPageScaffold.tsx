import Link from "next/link";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";

export interface FAQ {
  question: string;
  answer: string;
}

export interface LearnPageProps {
  title: string;
  lead: string;
  slug: string;
  faqs: FAQ[];
  related: { slug: string; title: string }[];
  children: React.ReactNode;
}

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

/**
 * Reusable scaffold for /learn/* pages. Renders:
 *  - Public header/footer
 *  - Article body with consistent typography
 *  - FAQ section + JSON-LD FAQPage structured data (Google rich snippets)
 *  - Internal links to related explainers (SEO + UX)
 *  - Waitlist CTA at the bottom
 */
export default function LearnPageScaffold({
  title,
  lead,
  slug,
  faqs,
  related,
  children,
}: LearnPageProps) {
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.answer,
      },
    })),
  };

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description: lead,
    url: `${APP_URL}/learn/${slug}`,
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      <PublicHeader />

      <article className="flex-1 max-w-3xl mx-auto px-6 py-12 lg:py-16 font-sans">
        {/* Breadcrumb */}
        <nav className="mb-6 text-xs text-white/45">
          <Link href="/welcome" className="hover:text-white">Home</Link>
          <span className="mx-2">·</span>
          <Link href="/learn/0dte-options" className="hover:text-white">Learn</Link>
          <span className="mx-2">·</span>
          <span className="text-white/65">{title}</span>
        </nav>

        <header className="mb-8 space-y-3">
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight leading-[1.15] text-white lining-nums">
            {title}
          </h1>
          <p className="text-lg text-white/65 leading-relaxed lining-nums">{lead}</p>
        </header>

        <div className="learn-prose text-white/75">
          {children}
        </div>

        {/* FAQ */}
        {faqs.length > 0 && (
          <section className="mt-16 space-y-6 lining-nums">
            <h2 className="text-2xl font-bold tracking-tight">Frequently asked questions</h2>
            <div className="space-y-5">
              {faqs.map((f) => (
                <div key={f.question} className="border-l-2 border-red-500/40 pl-4">
                  <h3 className="text-base font-semibold mb-2">{f.question}</h3>
                  <p className="text-sm text-white/70 leading-relaxed">{f.answer}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Waitlist CTA */}
        <aside className="mt-16 rounded-lg border border-white/15 bg-white/[0.02] p-6 space-y-3 lining-nums">
          <h2 className="text-xl font-bold tracking-tight">
            Get the daily research that puts this into practice.
          </h2>
          <p className="text-sm text-white/65">
            Olivia Trades is invite-only. We use these primitives every
            morning to size our own positions — the daily brief ships before
            the open.
          </p>
          <Link
            href="/welcome#waitlist"
            className="inline-block px-5 py-3 rounded-md bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold uppercase tracking-[0.22em] shadow-lg shadow-red-900/30 transition-colors"
          >
            Request an Invitation
          </Link>
        </aside>

        {/* Related */}
        {related.length > 0 && (
          <section className="mt-16 pt-8 border-t border-white/10">
            <h2 className="text-sm font-bold tracking-tight uppercase text-white/55 mb-4">
              Keep reading
            </h2>
            <ul className="grid sm:grid-cols-2 gap-3">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link
                    href={`/learn/${r.slug}`}
                    className="block rounded-md border border-white/10 hover:border-red-500/40 hover:bg-white/[0.03] p-3 transition-all"
                  >
                    <div className="text-sm font-semibold">{r.title} →</div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>

      <PublicFooter />
    </div>
  );
}
