import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tradeIdeas } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * DELETE /api/risk-graph/save/[id]
 *
 * Deletes a saved trade idea. Auth-gated — any signed-in user can
 * delete (single-user app for now; if multi-user matters later, add
 * an owner check against meta.savedBy).
 *
 * Returns:
 *   200 { ok: true }            — deleted (or already absent)
 *   400 { error }               — malformed id
 *   401 { error }               — not signed in
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  await db.delete(tradeIdeas).where(eq(tradeIdeas.id, id));
  return NextResponse.json({ ok: true });
}
