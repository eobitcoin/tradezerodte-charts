import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { botActions, botConfig } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";

/**
 * POST /api/admin/botwick/kill
 *
 * Emergency stop. Sets killSwitchEngaged + forces enabled=false + forces
 * mode="off" so the runner cannot resume on its own. Also writes a
 * high-severity event to bot_actions.
 *
 * Clearing the kill switch (engage=false) just lifts the flag — it does NOT
 * auto-resume trading. The admin still has to flip `enabled` back on via the
 * regular config endpoint, which is intentional: kill switch trips during
 * incidents and the admin should review state before re-arming.
 */
const Body = z.object({
  engage: z.boolean(),
  reason: z.string().max(500).nullable().optional(),
});

export async function POST(req: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "bad request", details: String(e) }, { status: 400 });
  }

  if (body.engage) {
    await db
      .update(botConfig)
      .set({
        killSwitchEngaged: true,
        killSwitchReason: body.reason ?? "Admin emergency stop",
        enabled: false,
        mode: "off",
        // Kill = full disarm. Forcing live_orders_confirmed back to false
        // means after an incident the admin must explicitly re-confirm
        // before any live-mode trading resumes. Belt-and-suspenders for the
        // §6.5 + Phase 4 safety story.
        liveOrdersConfirmed: false,
        updatedAt: new Date(),
        updatedBy: admin.id,
      })
      .where(eq(botConfig.id, "default"));

    await db.insert(botActions).values({
      kind: "kill_switch",
      severity: "error",
      message: `⛔ KILL SWITCH ENGAGED by BotWick Admin: ${body.reason ?? "no reason"}`,
      data: { actor: admin.id, reason: body.reason },
    });
  } else {
    await db
      .update(botConfig)
      .set({
        killSwitchEngaged: false,
        killSwitchReason: null,
        updatedAt: new Date(),
        updatedBy: admin.id,
      })
      .where(eq(botConfig.id, "default"));

    await db.insert(botActions).values({
      kind: "kill_switch",
      severity: "warn",
      message: `Kill switch cleared by BotWick Admin (bot remains disabled until manually re-enabled)`,
      data: { actor: admin.id },
    });
  }

  return NextResponse.json({ ok: true });
}
