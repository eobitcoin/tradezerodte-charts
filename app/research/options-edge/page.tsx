import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { optionsEdgeScans } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import OptionsSubNav from "@/components/OptionsSubNav";
import OptionsEdgeScanView from "@/components/OptionsEdgeScanView";

export const dynamic = "force-dynamic";

/**
 * /research/options-edge — member-only landing for the latest weekly
 * Options Edge IV anomaly scan. Reads the most recent row from
 * options_edge_scans. Empty state when no scan has been published yet.
 */
export default async function OptionsEdgeLandingPage() {
  const [latest] = await db
    .select()
    .from(optionsEdgeScans)
    .orderBy(desc(optionsEdgeScans.scanDay))
    .limit(1);

  const archive = await db
    .select({ scanDay: optionsEdgeScans.scanDay })
    .from(optionsEdgeScans)
    .orderBy(desc(optionsEdgeScans.scanDay))
    .limit(12);

  if (!latest) {
    return (
      <>
        <SiteHeader />
        <div className="max-w-7xl mx-auto px-4 pt-6">
          <OptionsSubNav active="edge" />
        </div>
        <main className="max-w-5xl mx-auto px-4 py-12 space-y-4 text-center">
          <h1 className="text-xl font-semibold">No Options Edge scans yet</h1>
          <p className="text-sm text-black/60 dark:text-white/60 max-w-md mx-auto">
            The Options Edge scanner runs every Sunday. It z-scores each
            ticker&apos;s IV surface against its own 1-year history and
            flags anomalies in ATM IV rank, 25Δ skew, term structure, and
            IV/HV ratio. The first scan will appear here once the routine
            publishes.
          </p>
          <Link href="/research" className="inline-block underline text-sm">
            Back to research →
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 pt-6">
        <OptionsSubNav active="edge" />
      </div>
      <OptionsEdgeScanView
        scan={latest}
        archive={archive.filter((a) => a.scanDay !== latest.scanDay)}
      />
    </>
  );
}
