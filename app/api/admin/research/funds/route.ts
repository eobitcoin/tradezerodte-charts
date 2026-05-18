/**
 * GET    /api/admin/research/funds        — list all funds (admin)
 * POST   /api/admin/research/funds        — add a fund { name, cik, note?, sortOrder? }
 * PATCH  /api/admin/research/funds/[id]   — update fund { name?, cik?, enabled?, sortOrder?, note? }
 * DELETE /api/admin/research/funds/[id]   — delete (rare; usually flip enabled=false)
 *
 * Admin-only. Mutations to this list take effect on the NEXT institutional
 * scan — the routine pulls funds via the public /api/institutional/funds
 * endpoint at the start of each run.
 */
import { NextResponse } from "next/server";
import { asc, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { institutionalFunds } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";

export const runtime = "nodejs";

const FundBody = z.object({
  name: z.string().min(1).max(200),
  cik: z
    .string()
    .min(1)
    .max(20)
    .transform((v) => v.replace(/\D/g, "").padStart(10, "0")),
  note: z.string().max(1000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await db
    .select()
    .from(institutionalFunds)
    .orderBy(asc(institutionalFunds.sortOrder), asc(institutionalFunds.name));
  return NextResponse.json({ funds: rows });
}

export async function POST(req: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body;
  try {
    body = FundBody.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "invalid body", detail: String(e) }, { status: 400 });
  }
  // Default sort_order to (max + 10) so new funds land at the end.
  const [maxRow] = await db
    .select({ sortOrder: institutionalFunds.sortOrder })
    .from(institutionalFunds)
    .orderBy(desc(institutionalFunds.sortOrder))
    .limit(1);
  const sortOrder = body.sortOrder ?? (maxRow ? maxRow.sortOrder + 10 : 10);
  try {
    const [inserted] = await db
      .insert(institutionalFunds)
      .values({
        name: body.name,
        cik: body.cik,
        note: body.note ?? null,
        sortOrder,
      })
      .returning();
    return NextResponse.json({ ok: true, fund: inserted });
  } catch (e) {
    // Likely unique-violation on CIK.
    return NextResponse.json(
      { error: "could not insert (CIK already exists?)", detail: String(e) },
      { status: 409 },
    );
  }
}
