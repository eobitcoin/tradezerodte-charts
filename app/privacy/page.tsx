import type { Metadata } from "next";
import Link from "next/link";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";
const EFFECTIVE_DATE = "May 18, 2026";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Privacy Policy | 0DTE Market Research",
  description:
    "How 0DTE Market Research collects, uses, and protects your information. Plain-English privacy policy covering account data, cookies, third-party services, and your rights.",
  alternates: { canonical: `${APP_URL}/privacy` },
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

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <PublicHeader />
      <div className="flex-1 max-w-3xl mx-auto px-4 py-8 space-y-6 w-full">
        <nav className="text-xs text-white/45">
          <Link href="/welcome" className="hover:text-white">
            Home
          </Link>
          <span className="mx-2">·</span>
          <span className="text-white/65">Privacy</span>
        </nav>

        <header className="space-y-2">
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight leading-[1.15]">
            Privacy Policy
          </h1>
          <p className="text-sm text-white/55">Effective {EFFECTIVE_DATE}</p>
        </header>

        <article className="prose prose-invert max-w-none text-white/80 space-y-4 leading-relaxed">
          <p>
            0DTE Market Research (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or the
            &ldquo;Service&rdquo;) is a private, invite-only research tool
            operated from the United States. This policy explains what
            information we collect, how we use it, and the choices you have.
            If anything here is unclear, email us at{" "}
            <a className="underline" href="mailto:ertemusa@gmail.com">
              ertemusa@gmail.com
            </a>
            .
          </p>

          <H2 id="what-we-collect">1. What we collect</H2>
          <p>
            <strong>Account data.</strong> When you sign up we collect your
            email address and a hashed password. We never store your password
            in clear text. If you join the waitlist we additionally collect any
            free-text fields you choose to submit (e.g. how you heard about us).
          </p>
          <p>
            <strong>Authentication state.</strong> When you sign in we set a
            session cookie containing a random session identifier (no personal
            data). The cookie is HTTP-only, SameSite=Lax, and expires after a
            fixed period.
          </p>
          <p>
            <strong>Server logs.</strong> Like any web service, our hosting
            provider logs IP addresses, request paths, user-agents, and
            timestamps for security and operational purposes. These logs are
            retained for a short period and are not used for advertising.
          </p>
          <p>
            <strong>What we do NOT collect.</strong> We do not collect payment
            information (the Service has no paid tier today). We do not embed
            third-party advertising trackers. We do not sell your data.
          </p>

          <H2 id="how-we-use">2. How we use your information</H2>
          <ul className="list-disc pl-6 space-y-1">
            <li>To authenticate you and keep your session active.</li>
            <li>To send transactional email — account verification, password
              resets, and waitlist responses. We use Resend as our email
              provider.</li>
            <li>To respond to inquiries you send us.</li>
            <li>To investigate and prevent abuse, fraud, or security
              incidents.</li>
          </ul>
          <p>
            We do not use your data to train AI models, and we do not share it
            with third parties for marketing.
          </p>

          <H2 id="third-parties">3. Third-party services</H2>
          <p>
            The Service relies on a small set of vendors. They each have their
            own privacy policies governing data they handle on our behalf:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Railway</strong> — application hosting and database
              storage (United States).
            </li>
            <li>
              <strong>Resend</strong> — transactional email delivery.
            </li>
            <li>
              <strong>Polygon.io</strong> — market data provider used inside
              the research pipeline (no personal data shared).
            </li>
            <li>
              <strong>Google (YouTube)</strong> and{" "}
              <strong>TikTok</strong> — when we publish daily briefing videos
              to those platforms, the platforms control how that content is
              distributed and recommended. We do not pass user data to them.
            </li>
          </ul>

          <H2 id="cookies">4. Cookies</H2>
          <p>
            We use one strictly necessary cookie — the session cookie described
            above — required for the Service to function once you sign in. We
            do not use advertising or analytics cookies. If your browser blocks
            cookies entirely, you will not be able to sign in.
          </p>

          <H2 id="your-rights">5. Your choices and rights</H2>
          <p>
            You can request a copy of the data we hold on you, request that we
            delete your account, or correct your email at any time by emailing{" "}
            <a className="underline" href="mailto:ertemusa@gmail.com">
              ertemusa@gmail.com
            </a>
            . Deletion is permanent and irreversible. Some operational logs
            may persist briefly after deletion before being rotated out per
            our hosting provider&apos;s standard retention.
          </p>
          <p>
            If you are in the European Economic Area or the United Kingdom,
            you have additional rights under GDPR including the right to
            object to processing, the right to data portability, and the right
            to lodge a complaint with your local supervisory authority.
            California residents have analogous rights under the CCPA/CPRA.
          </p>

          <H2 id="children">6. Children</H2>
          <p>
            The Service is not intended for, and not directed to, anyone under
            18. We do not knowingly collect data from minors. If you believe a
            minor has registered for an account, email us and we will delete
            the account.
          </p>

          <H2 id="security">7. Security</H2>
          <p>
            Passwords are hashed with Argon2id. All traffic to the Service is
            served over HTTPS. We store sensitive credentials in
            environment-isolated secret stores. No system is perfectly secure;
            we will notify affected users in a timely manner if we become
            aware of a breach affecting their data.
          </p>

          <H2 id="changes">8. Changes to this policy</H2>
          <p>
            We may revise this policy as the Service evolves. The
            &ldquo;Effective&rdquo; date above will be updated and, for
            material changes, we will display a notice on the site or email
            registered users.
          </p>

          <H2 id="contact">9. Contact</H2>
          <p>
            Questions, requests, or complaints:{" "}
            <a className="underline" href="mailto:ertemusa@gmail.com">
              ertemusa@gmail.com
            </a>
            .
          </p>

          <hr className="border-white/10" />
          <p className="text-xs text-white/50">
            See also our{" "}
            <Link href="/terms" className="underline">
              Terms of Service
            </Link>
            .
          </p>
        </article>
      </div>
      <PublicFooter />
    </div>
  );
}
