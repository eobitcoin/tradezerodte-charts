import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { insiderPosts, type InsiderBuy } from "@/lib/db/schema";
import { requireIngestBearer } from "@/lib/bearer";
import { nyTradingDay } from "@/lib/trading-day";
import { inferTitle } from "@/lib/parse-routine";

export const runtime = "nodejs";

const Buy = z.object({
  ticker: z.string().min(1).max(16).transform((v) => v.toUpperCase().trim()),
  company: z.string().min(1).max(200),
  executive: z.string().min(1).max(200),
  title: z.string().max(200).optional(),
  shares: z.number().int().nonnegative().optional(),
  total_value: z.number().nonnegative().optional(),
  position_type: z.enum(["new", "addition"]).optional(),
  filing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "filing_date must be YYYY-MM-DD").optional(),
  filing_url: z.string().url().max(500).optional(),
  notes: z.string().max(1000).optional(),
});

const Body = z.object({
  title: z.string().min(1).max(300).optional(),
  body_md: z.string().min(1).max(200_000),
  buys: z.array(Buy).max(200).optional(),
  scan_day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "scan_day must be YYYY-MM-DD")
    .optional(),
  run_at: z.string().datetime({ offset: true }).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  append: z.boolean().optional(),
});

export async function POST(req: Request) {
  const auth = requireIngestBearer(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }

  const scanDay = parsed.scan_day || nyTradingDay();
  const runAt = parsed.run_at ? new Date(parsed.run_at) : null;

  // Append mode — concatenate body_md and merge buys array onto an existing scan-day row.
  if (parsed.append === true) {
    const existing = await db.select().from(insiderPosts).where(eq(insiderPosts.scanDay, scanDay)).limit(1);
    if (existing[0]) {
      const merged_body = `${existing[0].bodyMd}\n\n${parsed.body_md}`;
      const merged_buys: InsiderBuy[] = [
        ...(existing[0].buys as InsiderBuy[]),
        ...((parsed.buys ?? []) as InsiderBuy[]),
      ];
      const merged_title = parsed.title || existing[0].title || `SEC Form 4 Insider Scan — ${scanDay}`;
      const merged_meta = { ...(existing[0].meta as Record<string, unknown>), ...(parsed.meta ?? {}) };

      const [row] = await db
        .update(insiderPosts)
        .set({
          title: merged_title,
          bodyMd: merged_body,
          buys: merged_buys,
          runAt: runAt ?? existing[0].runAt,
          meta: merged_meta,
          updatedAt: sql`now()`,
        })
        .where(eq(insiderPosts.scanDay, scanDay))
        .returning({ id: insiderPosts.id, scanDay: insiderPosts.scanDay });

      return NextResponse.json(
        {
          id: row.id,
          scan_day: row.scanDay,
          url: `/insider/${row.scanDay}`,
          mode: "append",
          body_chars: merged_body.length,
          buys_count: merged_buys.length,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    // Fall through to create path if no existing row.
  }

  const buys = (parsed.buys ?? []) as InsiderBuy[];
  const title = parsed.title || inferTitle(parsed.body_md) || `SEC Form 4 Insider Scan — ${scanDay}`;

  const [row] = await db
    .insert(insiderPosts)
    .values({
      scanDay,
      title,
      bodyMd: parsed.body_md,
      buys,
      runAt,
      meta: parsed.meta ?? {},
    })
    .onConflictDoUpdate({
      target: insiderPosts.scanDay,
      set: {
        title,
        bodyMd: parsed.body_md,
        buys,
        runAt,
        meta: parsed.meta ?? {},
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: insiderPosts.id, scanDay: insiderPosts.scanDay });

  return NextResponse.json(
    {
      id: row.id,
      scan_day: row.scanDay,
      url: `/insider/${row.scanDay}`,
      mode: parsed.append === true ? "append-create" : "replace",
      body_chars: parsed.body_md.length,
      buys_count: buys.length,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
