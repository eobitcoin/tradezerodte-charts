import { NextResponse } from "next/server";
import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { botActions, botTrades } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";

/**
 * GET /api/admin/botwick/archive
 *   ?batch=<iso>  → return that specific archive batch (events + trades)
 *   (no query)    → return list of all archive batches with counts
 *
 * Batches are grouped by the exact `archivedAt` timestamp set by the
 * reset-archive endpoint (every reset uses a single `now()` for all rows
 * in that batch, so a single timestamp identifies the whole snapshot).
 */
export async function GET(req: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const batch = url.searchParams.get("batch");

  if (batch) {
    const batchDate = new Date(batch);
    if (Number.isNaN(batchDate.getTime())) {
      return NextResponse.json({ error: "invalid batch timestamp" }, { status: 400 });
    }
    const [actions, trades] = await Promise.all([
      db
        .select()
        .from(botActions)
        .where(eq(botActions.archivedAt, batchDate))
        .orderBy(desc(botActions.ts))
        .limit(500),
      db
        .select()
        .from(botTrades)
        .where(eq(botTrades.archivedAt, batchDate))
        .orderBy(desc(botTrades.signaledAt))
        .limit(200),
    ]);
    return NextResponse.json({ ok: true, batch: batchDate.toISOString(), actions, trades });
  }

  // List of batches: distinct archivedAt timestamps + counts.
  const actionBatches = await db
    .select({
      archivedAt: botActions.archivedAt,
      count: sql<number>`count(*)::int`,
    })
    .from(botActions)
    .where(isNotNull(botActions.archivedAt))
    .groupBy(botActions.archivedAt)
    .orderBy(desc(botActions.archivedAt));

  const tradeBatches = await db
    .select({
      archivedAt: botTrades.archivedAt,
      count: sql<number>`count(*)::int`,
    })
    .from(botTrades)
    .where(isNotNull(botTrades.archivedAt))
    .groupBy(botTrades.archivedAt)
    .orderBy(desc(botTrades.archivedAt));

  // Merge action + trade counts on archivedAt.
  const byIso = new Map<string, { archivedAt: string; actionCount: number; tradeCount: number }>();
  for (const a of actionBatches) {
    if (!a.archivedAt) continue;
    const iso = a.archivedAt.toISOString();
    byIso.set(iso, { archivedAt: iso, actionCount: a.count, tradeCount: 0 });
  }
  for (const t of tradeBatches) {
    if (!t.archivedAt) continue;
    const iso = t.archivedAt.toISOString();
    const existing = byIso.get(iso) ?? { archivedAt: iso, actionCount: 0, tradeCount: 0 };
    existing.tradeCount = t.count;
    byIso.set(iso, existing);
  }
  const batches = Array.from(byIso.values()).sort((a, b) =>
    b.archivedAt.localeCompare(a.archivedAt),
  );

  return NextResponse.json({ ok: true, batches });
}
