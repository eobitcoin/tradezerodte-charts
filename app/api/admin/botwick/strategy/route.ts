import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { botActions, botConfig } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";
import { STRATEGIES } from "@/lib/botwick/strategies";

/**
 * POST /api/admin/botwick/strategy
 *
 * Admin-only. Switches the active signal strategy and writes a config_change
 * event to the tape with full before/after. Kept separate from the broader
 * /config endpoint so the SIGNALS tab can save independently from the rest
 * of the CONFIG form.
 */
const Body = z.object({
  activeSignalStrategy: z.enum([
    "alma_vwap_cross",
    "alma_9_39_rsi",
    "plan_based",
    "alma_plus_plan",
  ]),
});

export async function POST(req: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "bad request", detail: String(e) }, { status: 400 });
  }

  const [before] = await db
    .select({ activeSignalStrategy: botConfig.activeSignalStrategy })
    .from(botConfig)
    .where(eq(botConfig.id, "default"))
    .limit(1);

  await db
    .update(botConfig)
    .set({
      activeSignalStrategy: body.activeSignalStrategy,
      updatedAt: new Date(),
      updatedBy: admin.id,
    })
    .where(eq(botConfig.id, "default"));

  const meta = STRATEGIES[body.activeSignalStrategy];
  await db.insert(botActions).values({
    kind: "config_change",
    severity: "info",
    message: `BotWick Admin set active signal strategy → ${meta.name}${meta.status === "in_development" ? " (in development — entries paused for this strategy)" : ""}`,
    data: {
      actor: admin.id,
      before: before?.activeSignalStrategy ?? null,
      after: body.activeSignalStrategy,
      status: meta.status,
    },
  });

  return NextResponse.json({ ok: true, active: body.activeSignalStrategy });
}
