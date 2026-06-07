/**
 * Dry-run for the YouTube thumbnail data path.
 *
 * Runs the EXACT same DB query that `briefing-publish.ts` uses to
 * pick the SPY 0DTE max-pain number for the thumbnail, then prints
 * what would be rendered. No side effects.
 *
 * Usage:
 *   npx tsx scripts/test-thumbnail-data.ts                    # today
 *   npx tsx scripts/test-thumbnail-data.ts 2026-06-05         # specific day
 *
 * Requires DATABASE_URL env (same value as Railway).
 */

import { desc } from "drizzle-orm";
import { db } from "../lib/db";
import { maxPainPosts } from "../lib/db/schema";
import { nyTradingDay } from "../lib/trading-day";

async function main() {
  const tradingDay = process.argv[2] ?? nyTradingDay();

  console.log(
    `Querying max_pain_posts: latest scan ≤ ${tradingDay} (max-pain only runs Mon 9:55 ET; mid-week renders use latest available)`,
  );

  // Match production: take the latest scan_day. Max-pain only runs
  // Mondays, so any other day uses the most recent Monday's data.
  const [latestMaxPain] = await db
    .select()
    .from(maxPainPosts)
    .orderBy(desc(maxPainPosts.scanDay))
    .limit(1);

  if (!latestMaxPain) {
    console.log(`\n⚠️  No max_pain_posts rows at all.`);
    console.log("   Thumbnail would fall back to YouTube's auto-generated frame.");
    process.exit(0);
  }

  console.log(`\n✓ Found max_pain_posts row (scan_day=${latestMaxPain.scanDay})`);
  console.log(`  ${latestMaxPain.tickers?.length ?? 0} tickers in the scan`);

  const spy = latestMaxPain.tickers?.find((t) => t.ticker === "SPY");
  if (!spy) {
    console.log("\n⚠️  SPY not found in scan tickers.");
    console.log("   Tickers present:", latestMaxPain.tickers?.map((t) => t.ticker).join(", "));
    console.log("   Thumbnail would fall back to YouTube's auto-generated frame.");
    process.exit(0);
  }

  console.log(`\n✓ SPY found`);
  console.log(`  spot: ${spy.spot ?? "—"}`);
  console.log(`  frontMonthMaxPain: ${spy.frontMonthMaxPain ?? "—"}`);
  console.log(`  ${spy.expirations?.length ?? 0} expirations:`);
  for (const e of spy.expirations ?? []) {
    console.log(
      `    exp=${e.exp} dte=${e.dte ?? "?"} maxPain=${e.maxPain ?? "—"} spot=${e.spot ?? "—"}`,
    );
  }

  const spyZeroDte = spy.expirations?.find(
    (e) => e.exp === tradingDay || e.dte === 0,
  );
  const bigNumber = spyZeroDte?.maxPain ?? spy.expirations?.[0]?.maxPain;

  console.log("\n=== What the thumbnail would render ===");
  if (bigNumber != null) {
    console.log(`  Big number:  ${Math.round(bigNumber)}`);
    console.log(`  Big label:   MAX PAIN`);
    console.log(`  Ticker:      SPY`);
    console.log(
      `  Source:      ${spyZeroDte ? `0DTE expiration ${spyZeroDte.exp}` : `fallback to first expiration ${spy.expirations?.[0]?.exp}`}`,
    );
  } else {
    console.log("  No usable maxPain found → fallback to YouTube auto-thumbnail");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
