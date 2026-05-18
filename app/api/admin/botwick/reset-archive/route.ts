import { NextResponse } from "next/server";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { botActions, botAlmaState, botConfig, botTrades } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";
import { reconcileWithBroker } from "@/lib/botwick/broker-reconcile";
import { withAdvisoryLock, LOCK_IDS } from "@/lib/db/advisory-lock";

/**
 * POST /api/admin/botwick/reset-archive
 *
 * Admin-only. Tags all current bot_actions + non-live bot_trades with
 * `archivedAt = now()` so they disappear from the Activity tab and show up
 * under the ARCHIVE tab. Also wipes the `bot_alma_state` cache so READY
 * states reset to a clean slate.
 *
 * Active live trades (`submitting`, `working`, `open`, `closing`) are NEVER
 * archived — they represent real money in flight and must keep being
 * managed by the monitor and OMS.
 *
 * Returns the count of rows touched in each table so the UI can confirm.
 */
export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // B3: Take the monitor lock so this archive doesn't race with a tick
  // (which mutates bot_trades + bot_actions). Tick is short — admin retries
  // if a tick is mid-flight.
  const lock = await withAdvisoryLock(LOCK_IDS.BOTWICK_MONITOR_TICK, () => runResetArchive(admin.id));
  if (!lock.ok) {
    return NextResponse.json(
      { error: "monitor tick in progress; retry in a second", code: "lock_unavailable" },
      { status: 503 },
    );
  }
  return lock.data;
}

async function runResetArchive(adminId: string): Promise<Response> {
  // STEP 1 — Reconcile broker state FIRST so we don't archive around a stale
  // view. Catches positions the admin closed manually at Tradier while the
  // bot wasn't watching (e.g., bot was disabled). Without this, any
  // externally-closed trades would still show as `open` and be excluded from
  // archive, leaving them stuck on the Activity tab.
  const [cfgForReconcile] = await db
    .select()
    .from(botConfig)
    .where(eq(botConfig.id, "default"))
    .limit(1);
  let reconcileSummary: { externallyClosed: number; recoveredStuck: number; errors: string[] } = {
    externallyClosed: 0,
    recoveredStuck: 0,
    errors: [],
  };
  if (cfgForReconcile && cfgForReconcile.mode !== "off") {
    try {
      const r = await reconcileWithBroker(cfgForReconcile);
      reconcileSummary = {
        externallyClosed: r.externallyClosed.length,
        recoveredStuck: r.recoveredStuck.length,
        errors: r.errors,
      };
    } catch (err) {
      reconcileSummary.errors.push(`reconcile threw: ${String(err)}`);
    }
  }

  const now = new Date();

  const archivedActions = await db
    .update(botActions)
    .set({ archivedAt: now })
    .where(isNull(botActions.archivedAt))
    .returning({ id: botActions.id });

  const archivedTrades = await db
    .update(botTrades)
    .set({ archivedAt: now })
    .where(
      and(
        isNull(botTrades.archivedAt),
        // Only archive non-actionable / non-live trades. Live trades stay
        // visible so the OMS keeps managing them.
        inArray(botTrades.status, [
          "pending",
          "signal_armed",
          "signal_fired",
          "closed",
          "rejected",
          "cancelled",
          "errored",
        ]),
      ),
    )
    .returning({ id: botTrades.id });

  const clearedAlma = await db.delete(botAlmaState).returning({ ticker: botAlmaState.ticker });

  // Reset bot runtime status to a clean OFF state. Per spec, "all the current
  // BOT status will be reset (so if the BOT was ARMed that will be reset to
  // new start for example)" — flip enabled off, clear kill switch, and clear
  // the live-orders confirmation safety rail so re-enabling live requires
  // an explicit re-toggle. `mode` is preserved (admin's deliberate choice).
  await db
    .update(botConfig)
    .set({
      enabled: false,
      killSwitchEngaged: false,
      killSwitchReason: null,
      liveOrdersConfirmed: false,
      updatedAt: now,
      updatedBy: adminId,
    })
    .where(eq(botConfig.id, "default"));

  // Drop one fresh row into bot_actions documenting the reset itself. Will
  // show up at the top of the (now empty) Activity tape.
  await db.insert(botActions).values({
    kind: "config_change",
    severity: "warn",
    message: `Reset & Archive by BotWick Admin: ${reconcileSummary.externallyClosed > 0 ? `reconciled ${reconcileSummary.externallyClosed} externally-closed trade${reconcileSummary.externallyClosed === 1 ? "" : "s"}; ` : ""}archived ${archivedActions.length} events, ${archivedTrades.length} non-live trades; cleared ${clearedAlma.length} ALMA READY states. Bot disabled, kill-switch + live-confirmation reset.`,
    data: {
      actor: adminId,
      archivedActions: archivedActions.length,
      archivedTrades: archivedTrades.length,
      clearedAlmaStates: clearedAlma.length,
      reconcileSummary,
      archivedAt: now.toISOString(),
      configReset: {
        enabled: false,
        killSwitchEngaged: false,
        liveOrdersConfirmed: false,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    archivedAt: now.toISOString(),
    archivedActions: archivedActions.length,
    archivedTrades: archivedTrades.length,
    clearedAlmaStates: clearedAlma.length,
    reconcile: reconcileSummary,
  });
}

