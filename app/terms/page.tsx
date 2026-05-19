import type { Metadata } from "next";
import Link from "next/link";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";
const EFFECTIVE_DATE = "May 18, 2026";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Terms of Service | 0DTE Market Research",
  description:
    "Terms of Service for 0DTE Market Research. Educational content only — not financial advice. Read these terms before using the Service.",
  alternates: { canonical: `${APP_URL}/terms` },
  robots: { index: true, follow: true },
};

function H2({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <h2
      id={id}
      className="text-lg font-semibold tracking-tight pt-6 mt-2 border-t border-white/10 first:border-t-0 first:pt-0 first:mt-0"
    >
      {children}
    </h2>
  );
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <PublicHeader />
      <div className="flex-1 max-w-3xl mx-auto px-4 py-8 space-y-6 w-full">
        <nav className="text-xs text-white/45">
          <Link href="/welcome" className="hover:text-white">
            Home
          </Link>
          <span className="mx-2">·</span>
          <span className="text-white/65">Terms</span>
        </nav>

        <header className="space-y-2">
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight leading-[1.15]">
            Terms of Service
          </h1>
          <p className="text-sm text-white/55">Effective {EFFECTIVE_DATE}</p>
        </header>

        <article className="prose prose-invert max-w-none text-white/80 space-y-4 leading-relaxed">
          <p>
            These Terms of Service (&ldquo;Terms&rdquo;) govern your access to
            and use of 0DTE Market Research (the &ldquo;Service&rdquo;), the
            website at <code>tradezerodte.com</code>, our daily briefing
            videos, and any related content we publish on third-party
            platforms (YouTube, TikTok, etc.). By creating an account or
            otherwise using the Service, you agree to be bound by these
            Terms.
          </p>

          <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.08] px-4 py-3 my-4 text-sm">
            <strong>⚠ The most important sentence on this page:</strong>{" "}
            Nothing on this Service is financial, investment, legal, or tax
            advice. Every trade idea, chart, ticker mention, and commentary is
            published for educational and informational purposes only. You
            alone are responsible for your trading decisions and the
            consequences of them.
          </div>

          <H2 id="not-advice">1. Not financial advice</H2>
          <p>
            We are not a registered investment adviser, broker-dealer, or
            financial planner, and we are not acting in a fiduciary capacity.
            The content we publish — including but not limited to the daily
            briefing videos, the morning research post, the trade tables,
            grades, sentiment chips, charts, BotWick scans, and any data
            derived from these — represents personal observations and
            opinions as of the time of publication. It does not constitute a
            recommendation to buy, sell, or hold any security, derivative, or
            other financial instrument.
          </p>
          <p>
            <strong>Options trading, including 0DTE (zero days to
            expiration) options, involves substantial risk of loss.</strong>{" "}
            You can lose more than your initial investment. Past performance
            does not guarantee future results. The strategies discussed are
            not suitable for every investor. Consult a licensed financial
            advisor familiar with your circumstances before making any
            investment decision.
          </p>

          <H2 id="eligibility">2. Eligibility</H2>
          <p>
            You must be at least 18 years old to create an account. By
            registering, you represent that you are 18 or older and legally
            able to enter into a binding contract in your jurisdiction. You
            also represent that your use of the Service does not violate any
            law applicable to you.
          </p>

          <H2 id="account">3. Your account</H2>
          <p>
            You are responsible for keeping your password confidential and for
            all activity that occurs under your account. Notify us promptly at{" "}
            <a className="underline" href="mailto:ertemusa@gmail.com">
              ertemusa@gmail.com
            </a>{" "}
            if you suspect unauthorized access. We may suspend or terminate
            accounts that violate these Terms, share access credentials, or
            engage in abusive behavior.
          </p>
          <p>
            The Service is invite-only. We may approve, deny, or revoke
            access at our discretion. There is no entitlement to ongoing
            access.
          </p>

          <H2 id="acceptable-use">4. Acceptable use</H2>
          <p>You agree not to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Scrape, crawl, or otherwise extract content from the
              Service in bulk or in a manner that interferes with normal
              operation.</li>
            <li>Reverse-engineer the Service or attempt to access non-public
              areas, APIs, or data.</li>
            <li>Resell, sublicense, or redistribute our research content
              without written permission.</li>
            <li>Use the Service to defame, harass, or harm any person.</li>
            <li>Use the Service for any purpose that is unlawful in your
              jurisdiction.</li>
          </ul>

          <H2 id="ip">5. Intellectual property</H2>
          <p>
            All content published on the Service — written research, video
            scripts, charts, code, branding, and the &ldquo;Olivia
            Trades&rdquo; persona — is owned by us or licensed to us. You may
            view the content for your personal, non-commercial educational
            use. You may not republish, modify, or use it commercially
            without our prior written consent.
          </p>
          <p>
            If you submit feedback or suggestions, you grant us a
            non-exclusive, worldwide, royalty-free license to use them
            without restriction.
          </p>

          <H2 id="third-party">6. Third-party platforms</H2>
          <p>
            Our daily briefing videos are also published on third-party
            platforms (YouTube, TikTok, and similar). Your use of those
            platforms is governed by each platform&apos;s own terms of service
            and privacy policy. We are not responsible for the conduct of
            those platforms, their recommendation algorithms, or any content
            users post in response to our videos.
          </p>

          <H2 id="availability">7. Availability and changes</H2>
          <p>
            The Service is provided on an as-is, best-effort basis. We may
            modify, suspend, or discontinue any feature at any time without
            notice. Daily research routines depend on third-party market-data
            providers and may be incomplete, delayed, or unavailable. Do not
            rely on the Service as your sole source of trading information.
          </p>

          <H2 id="warranty">8. Disclaimer of warranties</H2>
          <p className="uppercase text-sm tracking-wide">
            The service and all content are provided &ldquo;as is&rdquo; and
            &ldquo;as available&rdquo; without warranties of any kind, express
            or implied, including without limitation warranties of
            merchantability, fitness for a particular purpose,
            non-infringement, accuracy, or that the service will be
            uninterrupted or error-free. To the maximum extent permitted by
            law, we disclaim all such warranties.
          </p>

          <H2 id="liability">9. Limitation of liability</H2>
          <p className="uppercase text-sm tracking-wide">
            To the maximum extent permitted by law, in no event shall 0DTE
            Market Research, its operators, officers, or affiliates be
            liable for any indirect, incidental, special, consequential,
            punitive, or exemplary damages — including but not limited to
            trading losses, lost profits, lost data, or business
            interruption — arising out of or in connection with your use of
            the service, even if we have been advised of the possibility of
            such damages. Our aggregate liability for any claim arising out
            of or relating to the service is limited to one hundred US
            dollars (USD $100).
          </p>

          <H2 id="indemnity">10. Indemnification</H2>
          <p>
            You agree to indemnify and hold harmless 0DTE Market Research and
            its operators from any claim or demand, including reasonable
            attorneys&apos; fees, arising out of your use of the Service, your
            violation of these Terms, or your violation of any third-party
            right.
          </p>

          <H2 id="termination">11. Termination</H2>
          <p>
            You may close your account at any time by emailing us. We may
            suspend or terminate your access at any time for any reason,
            including violation of these Terms. Sections 1, 5, 8, 9, 10, and
            13 survive termination.
          </p>

          <H2 id="governing-law">12. Governing law and disputes</H2>
          <p>
            These Terms are governed by the laws of the State of California,
            United States, without regard to its conflict-of-law principles.
            Any dispute arising out of or relating to these Terms or the
            Service shall be resolved in the state or federal courts located
            in San Francisco County, California, and you consent to personal
            jurisdiction there. Nothing in this section prevents either
            party from seeking injunctive relief in any court of competent
            jurisdiction.
          </p>

          <H2 id="changes">13. Changes to these Terms</H2>
          <p>
            We may update these Terms from time to time. The &ldquo;Effective&rdquo;
            date above will be updated and, for material changes, we will
            display a notice on the site or notify registered users by
            email. Your continued use of the Service after a change
            constitutes acceptance of the revised Terms.
          </p>

          <H2 id="contact">14. Contact</H2>
          <p>
            Questions about these Terms:{" "}
            <a className="underline" href="mailto:ertemusa@gmail.com">
              ertemusa@gmail.com
            </a>
            .
          </p>

          <hr className="border-white/10" />
          <p className="text-xs text-white/50">
            See also our{" "}
            <Link href="/privacy" className="underline">
              Privacy Policy
            </Link>
            .
          </p>
        </article>
      </div>
      <PublicFooter />
    </div>
  );
}
