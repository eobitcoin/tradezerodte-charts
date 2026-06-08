import { desc } from "drizzle-orm";
import { db } from "../lib/db";
import { calendarScans } from "../lib/db/schema";

async function main() {
  const [latest] = await db.select().from(calendarScans).orderBy(desc(calendarScans.scanDay)).limit(1);
  if (!latest) { console.log("no scan"); process.exit(0); }
  console.log(`scan_day=${latest.scanDay}  universe=${latest.universeSize}  computed=${latest.computedSize}`);
  const picks = latest.data?.picks ?? [];
  const reasonCounts: Record<string, number> = {};
  for (const p of picks) {
    const r = p.skipReason ?? "unknown";
    reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  }
  console.log("\nSkip reasons (per ticker):");
  for (const [r, n] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)}  ${r}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
