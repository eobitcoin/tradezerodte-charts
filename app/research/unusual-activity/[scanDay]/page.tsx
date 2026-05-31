import { notFound } from "next/navigation";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { uoaScans } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import OptionsSubNav from "@/components/OptionsSubNav";
import UoaScanView from "@/components/UoaScanView";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * /research/unusual-activity/[scanDay] — specific scan by date.
 * Mirror of the landing page filtered to one scan_day.
 */
export default async function UnusualActivityArchivePage({
  params,
}: {
  params: Promise<{ scanDay: string }>;
}) {
  const { scanDay } = await params;
  if (!DATE_RE.test(scanDay)) notFound();

  const [scan] = await db
    .select()
    .from(uoaScans)
    .where(eq(uoaScans.scanDay, scanDay))
    .limit(1);
  if (!scan) notFound();

  const archive = await db
    .select({ scanDay: uoaScans.scanDay })
    .from(uoaScans)
    .where(and(ne(uoaScans.scanDay, scanDay)))
    .orderBy(desc(uoaScans.scanDay))
    .limit(12);

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 pt-6">
        <OptionsSubNav active="unusual" />
      </div>
      <UoaScanView scan={scan} archive={archive} />
    </>
  );
}
