import Link from "next/link";

export default function PublicFooter() {
  return (
    <footer className="border-t border-white/10 bg-black mt-16">
      <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
        <div className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-[0.22em] text-white/40">Product</h3>
          <Link href="/welcome" className="block text-white/70 hover:text-white">
            Overview
          </Link>
          <Link href="/welcome#features" className="block text-white/70 hover:text-white">
            Features
          </Link>
          <Link href="/welcome#waitlist" className="block text-white/70 hover:text-white">
            Join Waitlist
          </Link>
          <Link href="/login" className="block text-white/70 hover:text-white">
            Sign in
          </Link>
        </div>
        <div className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-[0.22em] text-white/40">Explore</h3>
          <Link href="/explore" className="block text-white/70 hover:text-white">
            All previews
          </Link>
          <Link href="/explore/daily" className="block text-white/70 hover:text-white">
            Daily Analysis
          </Link>
          <Link href="/explore/institutional" className="block text-white/70 hover:text-white">
            Institutional Flow
          </Link>
          <Link href="/explore/earnings" className="block text-white/70 hover:text-white">
            Earnings Whiplash
          </Link>
          <Link href="/explore/sector-rotation" className="block text-white/70 hover:text-white">
            Sector Rotation
          </Link>
          <Link href="/explore/insider" className="block text-white/70 hover:text-white">
            Insider Buys
          </Link>
        </div>
        <div className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-[0.22em] text-white/40">Learn</h3>
          <Link href="/learn/0dte-options" className="block text-white/70 hover:text-white">
            0DTE Options
          </Link>
          <Link href="/learn/max-pain" className="block text-white/70 hover:text-white">
            Max Pain
          </Link>
          <Link href="/learn/gamma-exposure" className="block text-white/70 hover:text-white">
            Gamma Exposure
          </Link>
          <Link href="/learn/institutional-flow" className="block text-white/70 hover:text-white">
            Institutional Flow
          </Link>
          <Link href="/learn/earnings-whiplash" className="block text-white/70 hover:text-white">
            Earnings Whiplash
          </Link>
          <Link href="/learn/sector-rotation" className="block text-white/70 hover:text-white">
            Sector Rotation
          </Link>
          <Link href="/learn/insider-buys" className="block text-white/70 hover:text-white">
            Insider Buys
          </Link>
          <Link href="/learn/weekly-research" className="block text-white/70 hover:text-white">
            Weekly Research
          </Link>
          <Link href="/learn/polymarket-whales" className="block text-white/70 hover:text-white">
            Polymarket Whales
          </Link>
          <Link href="/learn/trade-cards" className="block text-white/70 hover:text-white">
            Trade Cards
          </Link>
          <Link href="/learn/analysis" className="block text-white/70 hover:text-white">
            Analysis Tab
          </Link>
          <Link href="/learn/scorecard" className="block text-white/70 hover:text-white">
            Scorecard
          </Link>
        </div>
        <div className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-[0.22em] text-white/40">Disclosures</h3>
          <p className="text-[11px] text-white/45 leading-relaxed">
            OliviaTrades Research is a private, invite-only research tool. Content
            on this site is for informational and educational purposes only —
            not investment advice. Options trading involves substantial risk of
            loss and is not suitable for every investor.
          </p>
          <div className="flex gap-3 pt-1 text-[11px]">
            <Link href="/privacy" className="text-white/65 hover:text-white">
              Privacy
            </Link>
            <Link href="/terms" className="text-white/65 hover:text-white">
              Terms
            </Link>
          </div>
        </div>
      </div>
      <div className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-4 text-[11px] text-white/35 flex flex-wrap items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} OliviaTrades Research</span>
          <div className="flex items-center gap-3">
            <Link href="/privacy" className="hover:text-white/65">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-white/65">
              Terms
            </Link>
            <span>·</span>
            <span>Not financial advice</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
