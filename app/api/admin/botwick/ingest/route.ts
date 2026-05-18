import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";
import { getBotConfig } from "@/lib/botwick";
import { ingestPost } from "@/lib/botwick/ingest";

/**
 * POST /api/admin/botwick/ingest
 *
 * Admin-only. Either ingest a specific trading_day (?day=YYYY-MM-DD) or, if
 * omitted, the most recent post we have. Runs the parser + v1 risk gates and
 * writes plan_received / risk_block / plan_skipped events to the Matrix tape.
 *
 * Re-runnable: ingest dedups against non-terminal bot_trades for the same
 * (postDay, ticker, strategy).
 */
const Body = z.object({
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
    .optional(),
});

export async function POST(req: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: z.infer<typeof Body> = {};
  try {
    if (req.headers.get("content-length") && Number(req.headers.get("content-length")) > 0) {
      body = Body.parse(await req.json());
    }
  } catch (err) {
    return NextResponse.json({ error: "bad request", detail: String(err) }, { status: 400 });
  }

  const post = body.day
    ? (await db.select().from(posts).where(eq(posts.tradingDay, body.day)).limit(1))[0]
    : (await db.select().from(posts).orderBy(desc(posts.tradingDay)).limit(1))[0];

  if (!post) {
    return NextResponse.json(
      { error: `no post found${body.day ? ` for ${body.day}` : ""}` },
      { status: 404 },
    );
  }

  const config = await getBotConfig();
  const summary = await ingestPost({
    post,
    config,
    actor: { id: admin.id },
  });

  return NextResponse.json({ ok: true, summary });
}
