import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tradeIdeas, type TradeIdeaLeg } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

/**
 * POST /api/risk-graph/save
 *
 * Persists a multi-leg trade idea built in the Risk Graph UI.
 *
 * Body shape:
 *   {
 *     name: string,                   // user label
 *     ticker: string,
 *     legs: TradeIdeaLeg[],
 *     spot: number,                   // underlying at entry
 *     entryDebit: number,             // net $ paid (negative = credit)
 *     notes?: string,
 *   }
 *
 * Auth: requires a signed-in user (any role). Returns 401 if not.
 *
 * Validation: at least one leg, every leg has finite numeric fields,
 * ticker non-empty. Anything malformed returns 400 with a message.
 *
 * Returns:
 *   200 { ok: true, id }      — saved, navigate to /research/risk-graph/saved/[id]
 *   400 { error }             — validation failed
 *   401 { error }             — not signed in
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = body as {
    name?: string;
    ticker?: string;
    legs?: unknown;
    spot?: number;
    entryDebit?: number;
    notes?: string;
  };

  const name = (b.name ?? "").trim();
  const ticker = (b.ticker ?? "").trim().toUpperCase();
  const spot = Number(b.spot);
  const entryDebit = Number(b.entryDebit);
  const notes = (b.notes ?? "").trim();

  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });
  if (!Number.isFinite(spot) || spot <= 0) {
    return NextResponse.json({ error: "spot must be a positive number" }, { status: 400 });
  }
  if (!Number.isFinite(entryDebit)) {
    return NextResponse.json({ error: "entryDebit must be a number" }, { status: 400 });
  }
  if (!Array.isArray(b.legs) || b.legs.length === 0) {
    return NextResponse.json({ error: "at least one leg required" }, { status: 400 });
  }

  const legs: TradeIdeaLeg[] = [];
  for (const raw of b.legs) {
    const l = raw as Record<string, unknown>;
    if (
      (l.type !== "call" && l.type !== "put") ||
      (l.side !== "long" && l.side !== "short") ||
      typeof l.strike !== "number" ||
      typeof l.expiration !== "string" ||
      typeof l.qty !== "number" ||
      typeof l.entryPrice !== "number" ||
      typeof l.entryIv !== "number"
    ) {
      return NextResponse.json({ error: "malformed leg" }, { status: 400 });
    }
    legs.push({
      type: l.type,
      side: l.side,
      strike: l.strike,
      expiration: l.expiration,
      qty: l.qty,
      entryPrice: l.entryPrice,
      entryIv: l.entryIv,
      contractTicker:
        typeof l.contractTicker === "string" ? l.contractTicker : undefined,
      entryBid: typeof l.entryBid === "number" ? l.entryBid : null,
      entryAsk: typeof l.entryAsk === "number" ? l.entryAsk : null,
    });
  }

  const [row] = await db
    .insert(tradeIdeas)
    .values({
      name,
      ticker,
      legs,
      underlyingSpotAtEntry: spot.toString(),
      entryDebit: entryDebit.toFixed(2),
      notes,
      meta: { savedBy: user.id, savedByEmail: user.email },
    })
    .returning({ id: tradeIdeas.id });

  return NextResponse.json({ ok: true, id: row.id });
}
