import { notFound } from "next/navigation";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { leapScans } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import LeapScanView from "@/components/LeapScanView";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * /research/leaps/[scanDay] — specific scan by date. Mirror of the
 * landing filtered to one scan_day.
 */
export default async function LeapsArchivePage({
  params,
}: {
  params: Promise<{ scanDay: string }>;
}) {
  const { scanDay } = await params;
  if (!DATE_RE.test(scanDay)) notFound();

  const [scan] = await db
    .select()
    .from(leapScans)
    .where(eq(leapScans.scanDay, scanDay))
    .limit(1);
  if (!scan) notFound();

  const archive = await db
    .select({ scanDay: leapScans.scanDay })
    .from(leapScans)
    .where(and(ne(leapScans.scanDay, scanDay)))
    .orderBy(desc(leapScans.scanDay))
    .limit(12);

  return (
    <>
      <SiteHeader />
      <LeapScanView scan={scan} archive={archive} />
    </>
  );
}
