import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import OptionsSubNav from "@/components/OptionsSubNav";
import RiskGraphBuilder from "@/components/RiskGraph/RiskGraphBuilder";

export const dynamic = "force-dynamic";

/**
 * /research/risk-graph — multi-leg trade builder + risk graph.
 *
 * The page is mostly a thin wrapper around the RiskGraphBuilder
 * client component. Everything interactive happens client-side; the
 * only server round-trips are the chain fetch (cached 30s) and the
 * save endpoint.
 */
export default function RiskGraphPage() {
  return (
    <>
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <OptionsSubNav active="risk-graph" />
        <header className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[10px] uppercase tracking-widest text-amber-400">
              Risk Graph · Multi-leg trade builder
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/research/risk-graph/saved"
                className="text-xs text-amber-300 hover:underline"
              >
                Saved ideas →
              </Link>
              <Link
                href="/learn/risk-graph"
                className="text-xs text-white/55 hover:text-white hover:underline"
              >
                Help · how to read this →
              </Link>
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Risk Graph</h1>
          <p className="text-sm text-white/55 max-w-3xl">
            Build multi-leg option positions interactively. Click{" "}
            <span className="text-emerald-300">+</span> to buy and{" "}
            <span className="text-rose-300">−</span> to sell on any
            strike in the chain. The risk graph renders live as you
            add legs, with P&amp;L curves at expiry plus intermediate
            time snapshots. Save trade ideas to track them later.
          </p>
        </header>

        <RiskGraphBuilder />
      </main>
    </>
  );
}
