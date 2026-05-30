import { notFound } from "next/navigation";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { optionsEdgeScans } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import OptionsEdgeScanView from "@/components/OptionsEdgeScanView";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * /research/options-edge/[scanDay] — specific scan by date. Mirror of
 * /research/options-edge but filtered to one scan_day.
 */
export default async function OptionsEdgeArchivePage({
  params,
}: {
  params: Promise<{ scanDay: string }>;
}) {
  const { scanDay } = await params;
  if (!DATE_RE.test(scanDay)) notFound();

  const [scan] = await db
    .select()
    .from(optionsEdgeScans)
    .where(eq(optionsEdgeScans.scanDay, scanDay))
    .limit(1);
  if (!scan) notFound();

  const archive = await db
    .select({ scanDay: optionsEdgeScans.scanDay })
    .from(optionsEdgeScans)
    .where(
      and(
        ne(optionsEdgeScans.scanDay, scanDay),
      ),
    )
    .orderBy(desc(optionsEdgeScans.scanDay))
    .limit(12);

  return (
    <>
      <SiteHeader />
      <OptionsEdgeScanView scan={scan} archive={archive} />
    </>
  );
}
