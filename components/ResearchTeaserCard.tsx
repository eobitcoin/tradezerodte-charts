import Link from "next/link";
import type { TickerResearchItem } from "@/lib/research-by-ticker";

/**
 * Locked teaser card for member-only research, surfaced on /tickers/[symbol].
 *
 * UX contract:
 *   - Visually signals "this is members-only" (lock icon + badge)
 *   - Clicking goes to the existing /explore/[type]/[date] public preview
 *     (which already shows headline + paywall + signup CTA via the
 *     ExploreScaffold component). For research types with no public
 *     preview (Wicked Stocks, Max Pain) the link goes to the member URL
 *     directly — middleware redirects to /login?next=… for unauth visitors.
 *
 * SEO contract:
 *   - The card text (title + date + kind chip) is plain HTML — Google
 *     can index the teaser. The JSON-LD on the parent page marks the
 *     linked CreativeWork as `isAccessibleForFree: false`, the Google-
 *     blessed signal for paywalled content.
 */

const KIND_TONE: Record<TickerResearchItem["kind"], string> = {
  daily: "border-sky-500/40 text-sky-300 bg-sky-500/[0.08]",
  insider: "border-amber-500/40 text-amber-300 bg-amber-500/[0.08]",
  wicked_stocks: "border-violet-500/40 text-violet-300 bg-violet-500/[0.08]",
  metals: "border-yellow-500/40 text-yellow-300 bg-yellow-500/[0.08]",
  institutional: "border-emerald-500/40 text-emerald-300 bg-emerald-500/[0.08]",
  earnings: "border-rose-500/40 text-rose-300 bg-rose-500/[0.08]",
  max_pain: "border-indigo-500/40 text-indigo-300 bg-indigo-500/[0.08]",
};

const KIND_CHIP_LABEL: Record<TickerResearchItem["kind"], string> = {
  daily: "Daily 0DTE",
  insider: "Insider",
  wicked_stocks: "Wicked Stocks",
  metals: "Metals",
  institutional: "Institutional",
  earnings: "Earnings",
  max_pain: "Max Pain",
};

export default function ResearchTeaserCard({ item }: { item: TickerResearchItem }) {
  return (
    <li>
      <Link
        href={item.url}
        className="paywall group flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04] px-3 py-3 transition-colors"
      >
        {/* Lock icon — pure CSS, no asset dependency. */}
        <span
          aria-hidden="true"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/[0.04] text-white/55 group-hover:text-white/85 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span
              className={`text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border ${KIND_TONE[item.kind]}`}
            >
              {KIND_CHIP_LABEL[item.kind]}
            </span>
            <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-white/15 text-white/55">
              Members only
            </span>
          </div>
          <div className="mt-1 truncate text-sm font-medium text-white/85 group-hover:text-white">
            {item.title}
          </div>
        </div>
        <span className="text-[10px] text-white/45 group-hover:text-white/75 whitespace-nowrap">
          Sign up to read →
        </span>
      </Link>
    </li>
  );
}
