/**
 * POST /api/sector-rotation/publish/<SECTOR_ROTATION_PUBLISH_TOKEN>
 *
 * Ingest endpoint for the weekly Sector Rotation Detector routine.
 * UPSERTs one post per scan_day.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { sectorRotationPosts } from "@/lib/db/schema";

export const runtime = "nodejs";

const Etf = z.object({
  ticker: z.string().min(1).max(10),
  name: z.string().min(1).max(200),
  aumUsdB: z.number().nonnegative().nullable(),
  avgDailyDollarVolumeUsd: z.number().nonnegative().nullable(),
  moneyFlowUsd: z.number().nullable(),
  moneyFlowRank: z.number().int().min(1).max(10),
  currentPrice: z.number().nonnegative().nullable(),
  thirtyDayReturnPct: z.number().nullable(),
  note: z.string().max(400).nullable(),
});

const Sector = z.object({
  sectorName: z.string().min(1).max(100),
  sectorEtf: z.string().min(1).max(10),
  last30DayReturnPct: z.number().nullable(),
  spy30DayReturnPct: z.number().nullable(),
  relativeStrength: z.number().nullable(),
  priorYear30DayReturnPct: z.number().nullable(),
  spyPriorYear30DayReturnPct: z.number().nullable(),
  relativeStrengthPriorYear: z.number().nullable(),
  rotationDirection: z.enum([
    "turning_positive",
    "turning_negative",
    "stable_positive",
    "stable_negative",
  ]),
  rotationMagnitudePct: z.number().nullable(),
  isRotating: z.boolean(),
  topEtfs: z.array(Etf).max(10).default([]),
  thesis: z.string().min(1).max(4000),
  risks: z.string().max(2000).default(""),
});

const Body = z.object({
  scanDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "scanDay must be YYYY-MM-DD"),
  summary: z.string().max(8000).default(""),
  methodology: z.string().max(4000).default(""),
  sectors: z.array(Sector).max(15),
  runAt: z.string().datetime().optional(),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const expected = process.env.SECTOR_ROTATION_PUBLISH_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }

  const runAt = body.runAt ? new Date(body.runAt) : new Date();

  const [row] = await db
    .insert(sectorRotationPosts)
    .values({
      scanDay: body.scanDay,
      summary: body.summary,
      methodology: body.methodology,
      sectors: body.sectors,
      runAt,
      meta: body.meta,
    })
    .onConflictDoUpdate({
      target: sectorRotationPosts.scanDay,
      set: {
        summary: body.summary,
        methodology: body.methodology,
        sectors: body.sectors,
        runAt,
        meta: body.meta,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: sectorRotationPosts.id, scanDay: sectorRotationPosts.scanDay });

  return NextResponse.json({
    ok: true,
    id: row.id,
    scanDay: row.scanDay,
    url: "/research/rotation",
    sectors: body.sectors.length,
    rotating: body.sectors.filter((s) => s.isRotating).length,
  });
}
