/**
 * POST /api/economic-calendar/ingest/<ECON_INGEST_TOKEN>
 *
 * Cron-pinged endpoint (cron-job.org) that pulls the upcoming week's macro
 * events from Finnhub and upserts them into `economic_events`. Intended to
 * fire **Sunday at ~9 PM ET** so Monday-morning users can see the week ahead.
 *
 * Filtering:
 *   - Country must be in KEEP_COUNTRIES (US primary; EU/UK/JP/CN included
 *     when their events are high-importance enough to spill over to US risk
 *     assets — see classifyEconEvent for what we tag).
 *   - Low-importance non-US events are dropped to keep the page focused.
 *   - Each event's title is run through classifyEconEvent for a canned
 *     description + asset tags. Optional richer commentary is added by a
 *     separate Sunday Claude routine via /publish.
 *
 * Returns a small summary so cron-job.org's UI can verify the run.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { economicEvents } from "@/lib/db/schema";
import { fetchFinnhubEconomicCalendar } from "@/lib/finnhub";
import { classifyEconEvent } from "@/lib/econ-classification";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Countries we ingest. US always; EU/UK/JP/CN only at medium+ importance. */
const KEEP_COUNTRIES = new Set(["US", "EU", "GB", "JP", "CN"]);
const NON_US_MIN_IMPORTANCE = new Set(["medium", "high"]);

/**
 * Compute a [from, to] window covering this week's remainder + the
 * upcoming week. Pulling 14 days is safer than trying to be clever about
 * "current vs upcoming week": the cron is intended to run Sunday evening
 * but a manual test run any other day-of-week should also produce useful
 * data, and the page-side query slices by week_of regardless.
 */
function ingestRange(now: Date = new Date()): { from: string; to: string } {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setUTCDate(today.getUTCDate() + 14);
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  return { from: fmt(today), to: fmt(end) };
}

/** Monday (UTC ISO date string) on or before the given date. */
function mondayOf(d: Date): string {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  const dow = x.getUTCDay();
  x.setUTCDate(x.getUTCDate() - ((dow + 6) % 7));
  return x.toISOString().slice(0, 10);
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const expected = process.env.ECON_INGEST_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const { from, to } = ingestRange();
  console.log(`[econ-ingest] window from=${from} to=${to}`);

  let events;
  try {
    events = await fetchFinnhubEconomicCalendar({ from, to });
  } catch (err) {
    console.error("[econ-ingest] fetch failed:", err);
    return NextResponse.json(
      { error: "fetch_failed", detail: String(err) },
      { status: 500 },
    );
  }
  console.log(`[econ-ingest] finnhub returned ${events.length} events`);

  // Country + importance filtering.
  const filtered = events.filter((e) => {
    const c = e.country.toUpperCase();
    if (!KEEP_COUNTRIES.has(c)) return false;
    if (c !== "US" && !NON_US_MIN_IMPORTANCE.has(e.importance)) return false;
    return true;
  });
  // Tally country breakdown to see what got dropped.
  const countryCounts: Record<string, number> = {};
  for (const e of events) {
    const c = (e.country || "??").toUpperCase();
    countryCounts[c] = (countryCounts[c] ?? 0) + 1;
  }
  console.log(
    `[econ-ingest] filtered=${filtered.length}/${events.length} countries=${JSON.stringify(countryCounts)}`,
  );

  if (filtered.length === 0) {
    return NextResponse.json({
      ok: true,
      from,
      to,
      fetched: events.length,
      ingested: 0,
      ms: Date.now() - started,
    });
  }

  // Build the rows to upsert. external_id = country|title|ISO time, hashed
  // implicitly via uniqueness; we'll use a composite string.
  const rows = filtered.map((e) => {
    const cls = classifyEconEvent(e.title, e.country);
    const externalId = `${e.country.toUpperCase()}|${e.title}|${e.time.toISOString()}`;
    return {
      externalId,
      title: e.title,
      country: e.country.toUpperCase(),
      eventTime: e.time,
      importance: e.importance,
      actual: e.actual != null ? String(e.actual) : null,
      estimate: e.estimate != null ? String(e.estimate) : null,
      prior: e.prior != null ? String(e.prior) : null,
      unit: e.unit,
      description: cls.description || null,
      assetTags: cls.assetTags,
      source: "finnhub" as const,
      raw: e.raw as unknown as Record<string, unknown>,
      // week_of is the Monday of the *event's* week, not the run's week.
      // That way an ingest run on a Sunday correctly tags Wed events as
      // belonging to the upcoming week, not the past week.
      weekOf: mondayOf(e.time),
      fetchedAt: new Date(),
    };
  });

  // Bulk upsert. ~14 cols × 1000 rows = 14K params, well under 65K limit.
  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await db
      .insert(economicEvents)
      .values(slice)
      .onConflictDoUpdate({
        target: economicEvents.externalId,
        set: {
          title: sql`excluded.title`,
          eventTime: sql`excluded.event_time`,
          importance: sql`excluded.importance`,
          actual: sql`excluded.actual`,        // updates after-the-fact reads
          estimate: sql`excluded.estimate`,
          prior: sql`excluded.prior`,
          unit: sql`excluded.unit`,
          // Only refresh description + tags if the canned pattern still
          // applies. We deliberately do NOT clobber impact_text — the
          // Claude routine owns that field.
          description: sql`COALESCE(EXCLUDED.description, ${economicEvents.description})`,
          assetTags: sql`excluded.asset_tags`,
          raw: sql`excluded.raw`,
          weekOf: sql`excluded.week_of`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
    upserted += slice.length;
  }

  return NextResponse.json({
    ok: true,
    from,
    to,
    fetched: events.length,
    filtered: filtered.length,
    upserted,
    ms: Date.now() - started,
  });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const expected = process.env.ECON_INGEST_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    method: "POST",
    note: "POST to refresh the upcoming week's economic calendar from Finnhub.",
  });
}
