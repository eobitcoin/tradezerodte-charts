import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { institutionalFunds } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";

export const runtime = "nodejs";

const PatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  cik: z
    .string()
    .min(1)
    .max(20)
    .transform((v) => v.replace(/\D/g, "").padStart(10, "0"))
    .optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  note: z.string().max(1000).nullable().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  let body;
  try {
    body = PatchBody.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "invalid body", detail: String(e) }, { status: 400 });
  }
  const [updated] = await db
    .update(institutionalFunds)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.cik !== undefined && { cik: body.cik }),
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      ...(body.note !== undefined && { note: body.note }),
      updatedAt: new Date(),
    })
    .where(eq(institutionalFunds.id, id))
    .returning();
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, fund: updated });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const [deleted] = await db
    .delete(institutionalFunds)
    .where(eq(institutionalFunds.id, id))
    .returning({ id: institutionalFunds.id });
  if (!deleted) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
