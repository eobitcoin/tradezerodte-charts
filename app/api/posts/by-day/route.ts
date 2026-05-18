import { NextResponse } from "next/server";
import { requireIngestBearer } from "@/lib/bearer";
import { getPostByDayKind, getScansForDay } from "@/lib/scans";
import type { ScanKind } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * GET /api/posts/by-day?day=YYYY-MM-DD[&scan_kind=premarket|market_open|analysis]
 *
 * Bearer-protected (same INGEST_API_KEY used by POST /api/posts) so it's safe
 * to call from a scheduled routine. Two query shapes:
 *
 *   - With `scan_kind`: returns the single post matching that (day, kind).
 *     Status 200 with the row, or 200 with `{ post: null }` when missing.
 *   - Without `scan_kind`: returns all scans for the day grouped by kind:
 *     `{ tradingDay, premarket, marketOpen, analysis }` (each can be null).
 *
 * Use this from the 10:00 ET analysis routine to read the two earlier
 * scans before publishing the narrative.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_KINDS: ScanKind[] = ["premarket", "market_open", "analysis", "settlement"];

export async function GET(req: Request) {
  const auth = requireIngestBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const url = new URL(req.url);
  const day = url.searchParams.get("day");
  const scanKindParam = url.searchParams.get("scan_kind");

  if (!day || !DATE_RE.test(day)) {
    return NextResponse.json(
      { error: "missing or invalid `day` (must be YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  if (scanKindParam) {
    if (!VALID_KINDS.includes(scanKindParam as ScanKind)) {
      return NextResponse.json(
        { error: `invalid scan_kind; must be one of ${VALID_KINDS.join(", ")}` },
        { status: 400 },
      );
    }
    const post = await getPostByDayKind(day, scanKindParam as ScanKind);
    return NextResponse.json(
      { trading_day: day, scan_kind: scanKindParam, post: post ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const scans = await getScansForDay(day);
  return NextResponse.json(
    {
      trading_day: day,
      premarket: scans.premarket ?? null,
      market_open: scans.marketOpen ?? null,
      analysis: scans.analysis ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
