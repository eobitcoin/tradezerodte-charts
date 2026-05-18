/**
 * OCC option-symbol resolver for BotWick.
 *
 * Daily plans express the contract in different ways:
 *   - As a fully-qualified OCC symbol embedded in the prose:
 *       "TSLA260513C00445000" → use as-is.
 *   - As strike + direction + relative expiry:
 *       "TSLA $437.5 PUT 0DTE" → build OCC for today's expiry.
 *   - As strike + direction + explicit ISO expiry:
 *       "AMD $460 PUT (expires 2026-05-15)" → build OCC for that date.
 *
 * This resolver normalises all three into a single OCC string the Tradier
 * adapter can quote. Returns a discriminated result so the caller never
 * has to try/catch.
 */

import type { ContractIntent } from "./types";
import type { BotTrade, Trade } from "@/lib/db/schema";
import { parseTrade } from "./plan-parser";

export type OccResolution =
  | { ok: true; occSymbol: string }
  | { ok: false; reason: string };

/** "2026-05-13" → "260513" */
function compactDate(iso: string): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[1].slice(2)}${m[2]}${m[3]}`;
}

/** America/New_York today, as "YYYY-MM-DD". */
function todayEt(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Add N calendar days to a YYYY-MM-DD. */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`); // noon UTC avoids DST edge cases
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Turn a free-form expiry hint ("0DTE", "2DTE", "2026-05-13") into a
 * YYYY-MM-DD string. Returns null when unparseable.
 *
 * Note: NDTE-with-day-count is calendar-day arithmetic; we do NOT skip
 * weekends. Real plans almost always embed the explicit ISO date alongside
 * the NDTE label, so this is a best-effort fallback. Caller should prefer
 * `parsed.contract.occSymbol` when present.
 */
function resolveExpiryIso(expiry: string | null): string | null {
  if (!expiry) return null;
  const trimmed = expiry.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/^(\d+)\s*DTE$/i);
  if (m) return addDays(todayEt(), Number(m[1]));
  return null;
}

/**
 * Build an OCC-21 symbol.
 *
 *   ROOT (1-6 chars) + YYMMDD + C|P + STRIKE_8DIGITS (cents × 100)
 *
 * Strike encoding: dollars × 1000, zero-padded to 8 digits. So a 437.5 put
 * expiring 2026-05-13 on TSLA becomes "TSLA260513P00437500".
 */
function buildOcc(args: {
  ticker: string;
  expiryIso: string;
  type: "call" | "put";
  strike: number;
}): OccResolution {
  const cd = compactDate(args.expiryIso);
  if (!cd) return { ok: false, reason: `bad expiry "${args.expiryIso}"` };
  if (!Number.isFinite(args.strike) || args.strike <= 0) {
    return { ok: false, reason: `bad strike ${args.strike}` };
  }
  const cp = args.type === "call" ? "C" : "P";
  const strikeInt = Math.round(args.strike * 1000);
  const strikeStr = String(strikeInt).padStart(8, "0");
  const root = args.ticker.toUpperCase();
  return { ok: true, occSymbol: `${root}${cd}${cp}${strikeStr}` };
}

/**
 * Top-level: resolve a contract from a bot_trade's persisted plan.
 *
 * The ingest pipeline stores the parsed `ContractIntent` on `plan.contract`.
 * Some real plans include the OCC symbol verbatim in the prose; when we
 * captured that at ingest, prefer it (Tradier's source-of-truth match).
 */
export function resolveOcc(trade: BotTrade): OccResolution {
  const plan = (trade.plan ?? {}) as Record<string, unknown>;
  let contract = (plan.contract ?? null) as ContractIntent | null;

  // Fallback for legacy rows: bot_trades inserted before ingest stored
  // `plan.contract` only have `plan.trade`. Re-parse on demand so older
  // pending trades aren't broken by the new pipeline.
  if (!contract && plan.trade) {
    const reparsed = parseTrade(plan.trade as Trade);
    contract = reparsed.contract;
  }

  if (contract?.occSymbol) {
    return { ok: true, occSymbol: contract.occSymbol };
  }
  if (!contract?.strike || !contract?.optionType) {
    return { ok: false, reason: "plan.contract.strike/optionType missing" };
  }
  const expiryIso = resolveExpiryIso(contract.expiry);
  if (!expiryIso) {
    return { ok: false, reason: `unresolvable expiry "${contract.expiry ?? "—"}"` };
  }
  return buildOcc({
    ticker: trade.sourceTicker,
    expiryIso,
    type: contract.optionType,
    strike: contract.strike,
  });
}
