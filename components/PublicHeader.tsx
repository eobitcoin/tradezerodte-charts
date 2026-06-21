import Link from "next/link";

/**
 * Header used on public, indexable pages (/welcome, /learn/*). Distinct from
 * the authed SiteHeader — minimal nav, prominent sign-in CTA, optimized for
 * first-time visitors who haven't signed in. Kept dark-themed to match the
 * AuthShell aesthetic so visitors flowing from /welcome → /login don't feel
 * jarred.
 */
export default function PublicHeader() {
  return (
    <header className="border-b border-white/10 bg-black/80 backdrop-blur sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-6">
        <Link
          href="/welcome"
          className="flex items-baseline gap-2 group"
        >
          <span className="inline-block px-2.5 py-1 rounded-md bg-red-600 text-white font-sans font-semibold tracking-tight ring-2 ring-red-500/25 group-hover:ring-red-500/50 shadow-sm shadow-red-900/30 transition-all text-sm">
            OliviaTrades Research
          </span>
          <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-white/40">
            private
          </span>
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/morning-brief" className="text-white/70 hover:text-white hidden sm:inline">
            Brief
          </Link>
          <Link href="/learn" className="text-white/70 hover:text-white hidden sm:inline">
            Learn
          </Link>
          <Link href="/explore" className="text-white/70 hover:text-white hidden sm:inline">
            Explore
          </Link>
          <Link href="/welcome#waitlist" className="text-white/70 hover:text-white hidden sm:inline">
            Waitlist
          </Link>
          <Link
            href="/login"
            className="px-3 py-1.5 rounded-md border border-white/20 text-white hover:bg-white/10 transition-colors text-sm"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
