/**
 * GET /api/institutional/funds/<INSTITUTIONAL_PUBLISH_TOKEN>
 *
 * Returns the current admin-configured fund watchlist for the weekly
 * institutional scan. Bearer-protected with the same token as the
 * publish endpoint — the routine reads this at the start of each run
 * so admin edits to the fund list take effect without a code change.
 *
 * Returns only enabled funds, ordered by sort_order then name.
 */
import { NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { institutionalFunds } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const expected = process.env.INSTITUTIONAL_PUBLISH_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      name: institutionalFunds.name,
      cik: institutionalFunds.cik,
      note: institutionalFunds.note,
      sortOrder: institutionalFunds.sortOrder,
    })
    .from(institutionalFunds)
    .where(eq(institutionalFunds.enabled, true))
    .orderBy(asc(institutionalFunds.sortOrder), asc(institutionalFunds.name));

  return NextResponse.json({ funds: rows, count: rows.length });
}
