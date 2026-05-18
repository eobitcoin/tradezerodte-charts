/**
 * POST /api/economic-calendar/publish/<ECON_PUBLISH_TOKEN>
 *
 * Endpoint for the Sunday Claude "weekly economic preview" routine to
 * UPSERT economic events with bespoke regime-aware commentary.
 *
 * Body shape:
 *   {
 *     "events": [
 *       {
 *         "title": "CPI YoY",                       // required
 *         "country": "US",                          // required
 *         "event_time": "2026-05-13T12:30:00Z",     // required, ISO
 *         "importance": "high",                     // 'low' | 'medium' | 'high'
 *         "estimate": 3.1,                          // optional numeric
 *         "prior":    3.2,
 *         "actual":   null,                         // null until printed
 *         "unit":     "%",
 *         "description": "What the event measures (1–2 sentences).",
 *         "impact_text": "Regime-aware narrative on potential impact.",
 *         "asset_tags": ["SPX","rates","USD","gold"]
 *       },
 *       ...
 *     ]
 *   }
 *
 * Each event upserts on a deterministic external_id derived from
 * country|title|ISO time. Re-running with updated data (e.g. adding the
 * actual print after the event) overwrites only the populated fields —
 * commentary you already published is preserved unless explicitly
 * provided again.
 *
 * Designed to be called from a /schedule routine. The routine produces
 * the week's events once on Sunday; mid-week reruns can fill in actuals.
 */
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { economicEvents } from "@/lib/db/schema";

export const runtime = "nodejs";

const Importance = z.enum(["low", "medium", "high"]);

const EventInput = z.object({
  title: z.string().min(1).max(200),
  country: z.string().min(1).max(8),
  event_time: z.string().datetime(),
  importance: Importance,
  estimate: z.number().nullable().optional(),
  prior: z.number().nullable().optional(),
  actual: z.number().nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  impact_text: z.string().max(8000).nullable().optional(),
  asset_tags: z.array(z.string().max(40)).max(20).optional(),
});

const Body = z.object({
  events: z.array(EventInput).min(1).max(200),
});

/** Monday (UTC ISO date) on or before the given date — for week_of grouping. */
function mondayOf(d: Date): string {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  const dow = x.getUTCDay();
  x.setUTCDate(x.getUTCDate() - ((dow + 6) % 7));
  return x.toISOString().slice(0, 10);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const expected = process.env.ECON_PUBLISH_TOKEN;
  console.log(
    `[econ-publish] POST received; token-prefix=${token.slice(0, 6)} expected-set=${!!expected}`,
  );
  if (!expected || token !== expected) {
    console.warn(
      `[econ-publish] auth failed; token-prefix=${token.slice(0, 6)} expected-prefix=${(expected ?? "").slice(0, 6)}`,
    );
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body;
  try {
    const text = await req.text();
    console.log(`[econ-publish] body length=${text.length}`);
    body = Body.parse(JSON.parse(text));
  } catch (err) {
    console.warn(`[econ-publish] body parse failed:`, err);
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }
  console.log(`[econ-publish] events=${body.events.length}`);

  const rows = body.events.map((e) => {
    const country = e.country.toUpperCase();
    const eventTime = new Date(e.event_time);
    const externalId = `${country}|${e.title}|${eventTime.toISOString()}`;
    return {
      externalId,
      title: e.title,
      country,
      eventTime,
      importance: e.importance,
      actual: e.actual != null ? String(e.actual) : null,
      estimate: e.estimate != null ? String(e.estimate) : null,
      prior: e.prior != null ? String(e.prior) : null,
      unit: e.unit ?? null,
      description: e.description ?? null,
      impactText: e.impact_text ?? null,
      assetTags: e.asset_tags ?? [],
      source: "claude_routine" as const,
      raw: e as unknown as Record<string, unknown>,
      weekOf: mondayOf(eventTime),
      fetchedAt: new Date(),
    };
  });

  // Upsert one at a time so per-row payloads don't clobber each other
  // (small N — typically 5–20 events per week — so per-row is fine).
  let inserted = 0;
  let updated = 0;
  for (const r of rows) {
    const existing = (
      await db
        .select({ id: economicEvents.id })
        .from(economicEvents)
        .where(eq(economicEvents.externalId, r.externalId))
        .limit(1)
    )[0];

    if (existing) {
      // Only overwrite fields the caller actually provided — let prior
      // commentary stand if the new payload doesn't include it.
      const updates: Partial<typeof economicEvents.$inferInsert> = {
        importance: r.importance,
        weekOf: r.weekOf,
        fetchedAt: new Date(),
        source: r.source,
        raw: r.raw,
      };
      if (r.actual != null) updates.actual = r.actual;
      if (r.estimate != null) updates.estimate = r.estimate;
      if (r.prior != null) updates.prior = r.prior;
      if (r.unit != null) updates.unit = r.unit;
      if (r.description != null) updates.description = r.description;
      if (r.impactText != null) updates.impactText = r.impactText;
      if (r.assetTags.length > 0) updates.assetTags = r.assetTags;
      await db.update(economicEvents).set(updates).where(eq(economicEvents.id, existing.id));
      updated += 1;
    } else {
      await db.insert(economicEvents).values(r);
      inserted += 1;
    }
  }

  return NextResponse.json({ ok: true, inserted, updated });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const expected = process.env.ECON_PUBLISH_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    method: "POST",
    note: "POST a structured event list to upsert the economic calendar.",
  });
}

// Suppress unused import warnings — `sql` is reserved for future bulk
// upserts if performance becomes a concern.
void sql;
