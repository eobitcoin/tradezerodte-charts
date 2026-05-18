/**
 * Strike selection — pick the nearest OTM contract from a Tradier option
 * chain for the requested side.
 *
 *   CALL: OTM means strike > current price. Nearest = smallest strike above.
 *   PUT:  OTM means strike < current price. Nearest = largest strike below.
 *
 * Returned contract carries its OCC symbol, strike, bid, ask, and last so
 * the caller can immediately compute a live mid without a second fetch.
 *
 * Failure modes (all `ok: false`):
 *   - no_chain         : empty chain
 *   - no_otm           : no contracts on the OTM side of `currentPrice`
 *   - illiquid         : nearest OTM has no bid/ask (no live quote)
 */

import type { TradierChainOption } from "./tradier-adapter";

export type StrikePickResult =
  | { ok: true; contract: TradierChainOption; mid: number | null }
  | { ok: false; code: "no_chain" | "no_otm" | "illiquid"; reason: string };

function liveMidFrom(c: TradierChainOption): number | null {
  if (c.bid == null || c.ask == null) return null;
  if (c.bid <= 0 || c.ask <= 0) return null;
  if (c.ask < c.bid) return null;
  return (c.bid + c.ask) / 2;
}

/**
 * Filter to OTM only, sort so the nearest is first, and return the first
 * one with a usable live quote. Skipping illiquid strikes lets us hop over
 * a one-off weird quote and pick the next nearest tradable contract.
 *
 * `liquidityHopLimit` caps how many strikes we'll skip looking for liquidity.
 * Default 3 — bigger than that and the chain itself is the problem.
 */
export function pickNearestOtm(args: {
  chain: TradierChainOption[];
  side: "call" | "put";
  currentPrice: number;
  liquidityHopLimit?: number;
}): StrikePickResult {
  const { chain, side, currentPrice, liquidityHopLimit = 3 } = args;
  if (!chain || chain.length === 0) {
    return { ok: false, code: "no_chain", reason: "option chain is empty" };
  }
  const isOtm = (s: number) => (side === "call" ? s > currentPrice : s < currentPrice);

  const candidates = chain
    .filter((c) => c.option_type === side && Number.isFinite(c.strike) && isOtm(c.strike))
    .sort((a, b) =>
      side === "call" ? a.strike - b.strike /* ascending */ : b.strike - a.strike /* descending */,
    );

  if (candidates.length === 0) {
    return {
      ok: false,
      code: "no_otm",
      reason: `no OTM ${side} strikes ${side === "call" ? ">" : "<"} ${currentPrice}`,
    };
  }

  for (let i = 0; i < Math.min(candidates.length, liquidityHopLimit); i++) {
    const candidate = candidates[i];
    const mid = liveMidFrom(candidate);
    if (mid != null) return { ok: true, contract: candidate, mid };
  }
  // Nothing in the first N hops has a live quote — caller can still get a
  // contract back via the first candidate but won't have a price.
  return {
    ok: false,
    code: "illiquid",
    reason: `nearest ${liquidityHopLimit} OTM ${side} strikes had no usable bid/ask`,
  };
}
