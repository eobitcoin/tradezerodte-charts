import { NextResponse } from "next/server";
import { fetchOptionChain } from "@/lib/polygon";

/**
 * GET /api/options/chain/[ticker]
 *
 * Returns the live option chain for one ticker, organized for the
 * Risk Graph builder UI:
 *
 *   {
 *     ticker, spot, asOf, expiries: [{
 *       expiration, dteDays,
 *       calls: [{ contractTicker, strike, bid, ask, mid, iv, delta,
 *                 gamma, theta, vega, openInterest, volume }],
 *       puts:  [ same shape ]
 *     }]
 *   }
 *
 * Caching: 30 second edge cache (no manual TTL needed — `revalidate`
 * tag handles it). The chain doesn't change inside a 30s window
 * meaningfully and this saves Polygon calls when the user re-renders
 * the builder.
 *
 * No auth — this endpoint is read-only chain data, same surface
 * Polygon already exposes to anyone with a key. Adds rate-limit
 * protection by being cached.
 */
export const revalidate = 30;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await ctx.params;
  const upper = ticker.toUpperCase();

  let chain;
  try {
    chain = await fetchOptionChain(upper);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Polygon: ${message}` }, { status: 502 });
  }
  if (chain.length === 0) {
    return NextResponse.json(
      { error: `No chain data for ${upper}` },
      { status: 404 },
    );
  }

  // Extract spot from any chain entry (equities embed it). For index
  // tickers the caller would need a separate lookup — but the Risk
  // Graph builder is equity-only for v1.
  let spot: number | null = null;
  for (const c of chain) {
    const p = c.underlying_asset?.price;
    if (typeof p === "number" && Number.isFinite(p) && p > 0) {
      spot = p;
      break;
    }
  }
  if (spot == null) {
    return NextResponse.json(
      { error: `Could not determine spot for ${upper}` },
      { status: 502 },
    );
  }

  // Bucket by expiration → call/put.
  type ContractRow = {
    contractTicker: string;
    strike: number;
    bid: number | null;
    ask: number | null;
    mid: number | null;
    iv: number | null;
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
    openInterest: number | null;
    volume: number | null;
  };

  const byExpiry = new Map<
    string,
    { calls: ContractRow[]; puts: ContractRow[] }
  >();

  for (const c of chain) {
    const expiry = c.details.expiration_date;
    if (!byExpiry.has(expiry)) byExpiry.set(expiry, { calls: [], puts: [] });
    const bid = c.last_quote?.bid ?? null;
    const ask = c.last_quote?.ask ?? null;
    const mid =
      typeof bid === "number" && typeof ask === "number" && ask >= bid
        ? (bid + ask) / 2
        : null;
    const row: ContractRow = {
      contractTicker: c.details.ticker,
      strike: c.details.strike_price,
      bid,
      ask,
      mid,
      iv: c.implied_volatility ?? null,
      delta: c.greeks?.delta ?? null,
      gamma: c.greeks?.gamma ?? null,
      theta: c.greeks?.theta ?? null,
      vega: c.greeks?.vega ?? null,
      openInterest: c.open_interest ?? null,
      volume: c.day?.volume ?? null,
    };
    if (c.details.contract_type === "call") {
      byExpiry.get(expiry)!.calls.push(row);
    } else {
      byExpiry.get(expiry)!.puts.push(row);
    }
  }

  const todayMs = Date.now();
  const expiries = [...byExpiry.entries()]
    .map(([expiration, { calls, puts }]) => {
      const dteDays = Math.max(
        0,
        Math.round(
          (new Date(`${expiration}T00:00:00Z`).getTime() - todayMs) /
            86_400_000,
        ),
      );
      // Sort each by strike ascending.
      calls.sort((a, b) => a.strike - b.strike);
      puts.sort((a, b) => a.strike - b.strike);
      return { expiration, dteDays, calls, puts };
    })
    .sort((a, b) => a.expiration.localeCompare(b.expiration));

  return NextResponse.json({
    ticker: upper,
    spot,
    asOf: new Date().toISOString().slice(0, 10),
    expiries,
  });
}
