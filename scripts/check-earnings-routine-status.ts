/**
 * Check what the earnings routine has (or hasn't) published recently.
 * Run with DATABASE_URL set (public proxy URL).
 */
import { desc } from "drizzle-orm";
import { db } from "../lib/db";
import { earningsPosts, earningsScans } from "../lib/db/schema";

async function main() {
  console.log("=== earnings_posts (most recent 3) ===");
  const posts = await db
    .select({
      scanDay: earningsPosts.scanDay,
      createdAt: earningsPosts.createdAt,
    })
    .from(earningsPosts)
    .orderBy(desc(earningsPosts.scanDay))
    .limit(3);
  for (const p of posts) {
    console.log(`  scanDay=${p.scanDay}  createdAt=${p.createdAt?.toISOString()}`);
  }
  if (posts.length === 0) console.log("  (none)");

  console.log("\n=== earnings_scans (most recent 3) ===");
  const scans = await db
    .select({
      scanWeek: earningsScans.scanWeek,
      createdAt: earningsScans.createdAt,
    })
    .from(earningsScans)
    .orderBy(desc(earningsScans.scanWeek))
    .limit(3);
  for (const s of scans) {
    console.log(`  scanWeek=${s.scanWeek}  createdAt=${s.createdAt?.toISOString()}`);
  }
  if (scans.length === 0) console.log("  (none)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
