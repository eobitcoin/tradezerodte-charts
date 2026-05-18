import Link from "next/link";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";

interface EmptyProps {
  title: string;
  description: string;
  authedHref: string;
}

function EmptyShell({ title, description, authedHref }: EmptyProps) {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <PublicHeader />
      <main className="flex-1 max-w-3xl mx-auto px-6 py-16 font-sans w-full text-center space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-white/65 max-w-prose mx-auto">{description}</p>
        <div className="pt-4">
          <Link
            href={`/signup?next=${encodeURIComponent(authedHref)}`}
            className="inline-block px-5 py-3 rounded-md bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold uppercase tracking-[0.22em] shadow-lg shadow-red-900/30 transition-colors"
          >
            Sign up to get notified
          </Link>
        </div>
        <div className="pt-2">
          <Link href="/explore" className="text-xs text-white/55 hover:text-white hover:underline">
            ← All explore previews
          </Link>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}

export function renderInstitutionalLatestEmpty() {
  return (
    <EmptyShell
      title="Institutional Flow — coming soon"
      description="The weekly 13F-driven scan hasn't published its first preview yet. Sign up and you'll see it the moment it does — the public preview shows one headline name, the authenticated post shows all five plus the full thesis behind each."
      authedHref="/research/institutional"
    />
  );
}

export function renderEarningsLatestEmpty() {
  return (
    <EmptyShell
      title="Earnings Whiplash — coming soon"
      description="The weekly earnings-volatility scan hasn't published its first preview yet. Once it does, you'll see the headline asymmetric long-vol setup here. The full list of 10 names plus the 3 flagged setups is in the authenticated post."
      authedHref="/research/earnings"
    />
  );
}

export function renderRotationLatestEmpty() {
  return (
    <EmptyShell
      title="Sector Rotation — coming soon"
      description="The weekly sector-leadership scan hasn't published its first preview yet. The public preview will show one rotating sector with thesis; the authenticated post covers all 11 GICS sectors plus the top-5 money-flow ranking per rotating sector."
      authedHref="/research/rotation"
    />
  );
}

export function renderDailyAnalysisLatestEmpty() {
  return (
    <EmptyShell
      title="Daily Analysis — coming soon"
      description="The premarket 0DTE Trading Research hasn't published today's preview yet. Each session the routine grades the day's top setups A+ to F — the public preview reveals the top-ranked trade in full; the authenticated post shows every graded setup with entry triggers, targets, stops, and the rationale behind each."
      authedHref="/"
    />
  );
}

export function renderInsiderLatestEmpty() {
  return (
    <EmptyShell
      title="Insider Buys — coming soon"
      description="The daily SEC Form 4 scan hasn't published its first preview yet. The public preview will show the largest single insider buy of the day; the authenticated post lists every qualifying buy across all tickers."
      authedHref="/insider"
    />
  );
}
