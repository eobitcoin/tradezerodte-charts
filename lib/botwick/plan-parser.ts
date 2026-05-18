/**
 * BotWick plan parser — turns the free-text trade plans in `posts.trades[]`
 * into a structured `ParsedPlan` the runner can evaluate.
 *
 * Design rules:
 *   1. NEVER throw. Unknown input → push a warning, return null for that
 *      sub-AST. The risk engine and runner refuse to act on unparsed plans;
 *      that's safer than guessing.
 *   2. Conservative direction logic. We use `direction` from the trade row
 *      first; the strike/option-type extraction only complements it.
 *   3. Regex-first, not LLM. The plans are written by the daily research
 *      routine in a consistent voice — a small grammar covers the real
 *      corpus (see /lib/db real-world samples in docs/botwick-architecture.md).
 *      Anything weird gets flagged for review, not parsed loosely.
 */

import type { Trade } from "@/lib/db/schema";
import type {
  Condition,
  ContractIntent,
  ParsedPlan,
  Predicate,
  TriggerAST,
} from "./types";

// ---------------------------------------------------------------------------
// Number / string utilities
// ---------------------------------------------------------------------------

/** Pull the first dollar amount out of a string. "$437.5" → 437.5 */
function firstDollar(s: string): number | null {
  const m = s.match(/\$?\s*(\d{1,5}(?:\.\d{1,4})?)/);
  return m ? Number(m[1]) : null;
}

/**
 * Pull a price range like "$4.50 – $5.50" or "$0.81 – $0.83".
 * Returns null when no range is present.
 */
function priceRange(s: string): [number, number] | null {
  // Match en-dash, em-dash, hyphen, or "to".
  const m = s.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:[‐-―\-]|to)\s*\$?\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return lo <= hi ? [lo, hi] : [hi, lo];
}

/**
 * Pull a percent like "+60%" or "−40%" or "-33%". Returns signed number.
 * Handles the Unicode minus (−) used in the real plans.
 */
function firstSignedPercent(s: string): number | null {
  const m = s.match(/([+\-−]?)\s*(\d{1,3}(?:\.\d{1,3})?)\s*%/);
  if (!m) return null;
  const sign = m[1] === "-" || m[1] === "−" ? -1 : 1;
  return sign * Number(m[2]);
}

/** Pull "HH:MM" ET time. "12:30 ET" → "12:30". Returns null when absent. */
function firstEtTime(s: string): string | null {
  const m = s.match(/(\d{1,2}:\d{2})\s*(?:AM|PM|am|pm)?\s*ET/);
  if (!m) return null;
  // Normalise "9:30" → "09:30"
  const [hh, mm] = m[1].split(":");
  return `${hh.padStart(2, "0")}:${mm}`;
}

/** Coerce strike that may be a number, "437.5", "TSLA $437.5 PUT 0DTE", etc. */
function extractStrike(input: number | string | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  return firstDollar(input);
}

/**
 * Look for an OCC-style option symbol embedded in any field.
 * Format: <root[1-6]><yy><mm><dd><C|P><strike*1000 padded to 8 digits>.
 * Example: "TSLA260513C00445000"
 */
function extractOcc(...strs: (string | undefined | null)[]): string | null {
  for (const s of strs) {
    if (!s) continue;
    const m = s.match(/[A-Z]{1,6}\d{6}[CP]\d{8}/);
    if (m) return m[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-field parsers
// ---------------------------------------------------------------------------

/**
 * Plan clauses we KNOW we can't act on safely. If any of these appear in the
 * trigger text we refuse to act on the trade — even if other clauses parsed
 * — because doing otherwise silently relaxes the entry condition (firing on
 * a SUBSET of what the plan requires).
 *
 * If we ever add the data feeds, remove the offending pattern here.
 */
const UNSUPPORTED_KEYWORDS_RE =
  /\b(pm\s+(?:low|high|range)|pre-?market\s+(?:low|high|range)|implied\s+open|gap\s+fill|breadth)\b/i;

/**
 * Strip TICK clauses out of an entry-trigger text. TICK is intentionally
 * not used as an entry criterion — see config note. The plan's bar/VWAP
 * conditions stand alone; the TICK qualifier is dropped along with one
 * adjacent connector so the cleaned text remains grammatical for the
 * downstream matchers.
 *
 * Returns the cleaned text plus a list of dropped clauses (for the warning
 * payload so the user can see in the tape that we ignored something).
 */
function stripTickClauses(text: string): { cleaned: string; stripped: string[] } {
  // TICK clause along with its left-adjacent connector ("and", "with", "+",
  // "/", ",", ";") if present. Captures common comparators.
  const tickWithLeadingConn =
    /(?:\s*\b(?:and|with|\+|\/|,|;)\b\s*)?\btick\b\s*(?:>|<|above|below|greater\s+than|less\s+than|over|under)\s*[+-]?\s*\d{2,4}/gi;

  const stripped: string[] = [];
  let cleaned = text.replace(tickWithLeadingConn, (match) => {
    // Record the matched substring (trimmed) so the tape can show which
    // clause was dropped verbatim.
    stripped.push(match.trim().replace(/^(?:and|with|\+|\/|,|;)\s*/i, "").trim());
    return "";
  });

  // If TICK was at the very start of the text it had no leading connector
  // — the remainder may now begin with one. Strip it.
  cleaned = cleaned
    .replace(/^\s*\b(?:and|with|\+|\/|,|;)\b\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return { cleaned, stripped };
}

/**
 * Add `09:30` + N minutes → "HH:MM". E.g., N=30 → "10:00".
 * Caps at 16:00 to avoid producing invalid times.
 */
function rthOffset(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  const total = 9 * 60 + 30 + minutes;
  const max = 16 * 60;
  if (total > max) return null;
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Parse `entry_trigger` text into a conjunction of predicates.
 *
 * Vocabulary we currently recognise:
 *   - `Nmin close below/above $X` / `close below/above $X` → bar_close_below/above
 *   - `Break above $X` / `Break of $X` / `Reclaim $X` / `Hold above $X` /
 *     `Break and hold above $X` → bar_close_above
 *   - `Reject of $X` / `Rejection of $X` / `Reject at $X` → bar_close_below
 *   - `VWAP rejection` → vwap_rejection (direction inferred from above/below)
 *   - `VWAP support` / `VWAP reclaim` / `holding VWAP` → vwap_relative(above)
 *   - `VWAP resistance` → vwap_relative(below)
 *   - `in first N min` / `in the first N min` → time_before(09:30+N)
 *   - `after first N min` / `after N min` → time_after(09:30+N)
 *   - `after HH:MM ET` → time_after(HH:MM)
 *
 * Hard-NACK if the text mentions TICK, PM levels, or other data we don't have.
 */
function parseEntryTrigger(text: string | undefined): {
  cond: Condition | null;
  warnings: string[];
} {
  if (!text) return { cond: null, warnings: ["entry_trigger missing"] };

  const warnings: string[] = [];

  // Strip TICK clauses first. Policy: the bot ignores TICK as an entry
  // qualifier — the bar/VWAP conditions stand alone. We surface a warning
  // so the user can see in the tape exactly which clause was dropped.
  const tickStrip = stripTickClauses(text);
  const cleaned = tickStrip.cleaned;
  if (tickStrip.stripped.length > 0) {
    warnings.push(
      `TICK clause(s) ignored per config: ${tickStrip.stripped.join("; ")}`,
    );
  }

  if (UNSUPPORTED_KEYWORDS_RE.test(cleaned)) {
    return {
      cond: null,
      warnings: [
        ...warnings,
        `entry_trigger contains unsupported clauses (PM-level / etc.): "${cleaned}"`,
      ],
    };
  }

  if (!cleaned) {
    // Everything we recognise was TICK and we just dropped it.
    return {
      cond: null,
      warnings: [...warnings, "entry_trigger has no parseable content after TICK was stripped"],
    };
  }

  const t = cleaned.toLowerCase();
  const preds: Predicate[] = [];

  // Bar timeframe — defaults to 5min. Only override when it's explicitly
  // attached to a bar word ("close" / "candle" / "bar"); otherwise patterns
  // like "in first 30 min" would mis-resolve as a 30min TF (it's a time
  // window, not a bar timeframe).
  let tf: "1min" | "5min" | "15min" = "5min";
  const tfMatch = t.match(/(\d{1,2})\s*-?\s*min(?:ute)?\s+(?:close|candle|bar)/);
  if (tfMatch) {
    const n = Number(tfMatch[1]);
    if (n === 1) tf = "1min";
    else if (n === 5) tf = "5min";
    else if (n === 15) tf = "15min";
  }

  // ---- Bar close below ------------------------------------------------
  const closeBelow = t.match(/close[s]?\s+below\s+\$?(\d+(?:\.\d+)?)/);
  if (closeBelow) preds.push({ bar_close_below: { price: Number(closeBelow[1]), tf } });

  // ---- Bar close above ------------------------------------------------
  const closeAbove = t.match(/close[s]?\s+above\s+\$?(\d+(?:\.\d+)?)/);
  if (closeAbove) preds.push({ bar_close_above: { price: Number(closeAbove[1]), tf } });

  // ---- Break / Reclaim / Hold above → bar_close_above ----------------
  // Examples: "Break above 224.30", "Break of 386.50", "Break and hold above 224",
  //           "Reclaim 455", "Hold above 294.50", "Holds 224".
  const breakAbove = t.match(
    /(?:break(?:\s+(?:of|above|and\s+hold\s+above))?|reclaim|holds?\s+above|holds?)\s+\$?(\d+(?:\.\d+)?)/,
  );
  if (
    breakAbove &&
    !preds.some((p) => "bar_close_above" in p && p.bar_close_above.price === Number(breakAbove[1]))
  ) {
    preds.push({ bar_close_above: { price: Number(breakAbove[1]), tf } });
  }

  // ---- Reject / Rejection of $X → bar_close_below ---------------------
  // "Reject of 418", "Rejection of 418", "Reject at 418"
  const rejectOf = t.match(/reject(?:ion)?\s+(?:of|at)\s+\$?(\d+(?:\.\d+)?)/);
  if (
    rejectOf &&
    // Don't double-up if "rejection at VWAP" was the phrase (VWAP isn't a price).
    !/reject(?:ion)?\s+(?:of|at)\s+vwap\b/.test(t) &&
    !preds.some((p) => "bar_close_below" in p && p.bar_close_below.price === Number(rejectOf[1]))
  ) {
    preds.push({ bar_close_below: { price: Number(rejectOf[1]), tf } });
  }

  // ---- VWAP rejection (bar pattern: tag then reverse) -----------------
  if (/vwap\s+rejection|rejection\s+at\s+vwap/.test(t)) {
    const hasAbove = preds.some((p) => "bar_close_above" in p);
    const hasBelow = preds.some((p) => "bar_close_below" in p);
    if (hasBelow) preds.push({ vwap_rejection: { side: "short" } });
    else if (hasAbove) preds.push({ vwap_rejection: { side: "long" } });
    else warnings.push("'VWAP rejection' present but no directional anchor");
  }

  // ---- VWAP support / reclaim / hold → vwap_relative(above) ----------
  // ---- VWAP resistance → vwap_relative(below) -------------------------
  if (/vwap\s+(?:support|reclaim|hold)\b|holding\s+vwap\b/.test(t)) {
    preds.push({ vwap_relative: { side: "above" } });
  }
  if (/vwap\s+resistance\b/.test(t)) {
    preds.push({ vwap_relative: { side: "below" } });
  }

  // ---- Time windows ---------------------------------------------------
  // "in first N min" / "in the first N min" → time_before(09:30+N)
  const inFirstN = t.match(/in\s+(?:the\s+)?first\s+(\d{1,2})\s*min/);
  if (inFirstN) {
    const cap = rthOffset(Number(inFirstN[1]));
    if (cap) preds.push({ time_before: { et: cap } });
  }
  // "after first N min" / "after N min" → time_after(09:30+N)
  const afterFirstN = t.match(/after\s+(?:the\s+)?(?:first\s+)?(\d{1,2})\s*min/);
  if (afterFirstN) {
    const start = rthOffset(Number(afterFirstN[1]));
    if (start) preds.push({ time_after: { et: start } });
  }
  // "after HH:MM ET" (existing pattern). Source from `cleaned` so any time
  // values that lived inside a now-stripped TICK clause aren't mis-picked-up.
  const afterEt = firstEtTime(cleaned);
  if (afterEt && /after\s+\d/i.test(cleaned)) {
    // Only add if we didn't already pick up "after N min"; that's preferred
    // because it doesn't require ET parsing.
    if (!afterFirstN) preds.push({ time_after: { et: afterEt } });
  }

  // NOTE: TICK is *intentionally not modeled*. `stripTickClauses` above
  // removes TICK clauses from the trigger text; we don't carry a TICK
  // predicate, evaluator branch, or data feed. Plans that mention TICK get
  // their TICK qualifier silently dropped (with a warning) and trade on
  // whatever non-TICK conditions remain.

  if (preds.length === 0) {
    warnings.push(`entry_trigger unrecognised: "${cleaned}"`);
    return { cond: null, warnings };
  }
  return {
    cond: preds.length === 1 ? preds[0] : { all: preds },
    warnings,
  };
}

/**
 * Parse a target/stop line like "$432 underlying / +60% premium" into an OR
 * of two predicates: hit the underlying price OR the premium move.
 *
 * `direction` says which side fires first: a long put profits when underlying
 * goes DOWN, so target uses `<=`; a long call uses `>=`.
 *
 * `kind` controls premium-pct semantics:
 *   - "target" → premium_pct_gte
 *   - "stop"   → premium_pct_lte (signed; the % is usually negative in the
 *                text, but the predicate compares to entry fill)
 */
function parseExitLine(
  text: string | undefined,
  direction: "long" | "short",
  kind: "target" | "stop",
): { cond: Condition | null; warnings: string[] } {
  if (!text) return { cond: null, warnings: [`${kind} missing`] };

  const preds: Predicate[] = [];
  const warnings: string[] = [];

  // Underlying price tag. We look for a dollar number that's NOT immediately
  // followed by "%" (those are premium percentages). The "underlying" keyword
  // is a strong hint; absent that, take the first $-prefixed number on the
  // line that isn't paired with a percent.
  const priceMatch = text.match(/\$\s*(\d+(?:\.\d{1,4})?)\b(?!\s*%)/);
  if (priceMatch) {
    const price = Number(priceMatch[1]);
    // Target side: long takes ">=" (hit the up-target), short takes "<=".
    // Stop side: long takes "<=" (price collapsed), short takes ">=".
    let op: "<=" | ">=" = "<=";
    if (kind === "target") op = direction === "long" ? ">=" : "<=";
    else op = direction === "long" ? "<=" : ">=";
    preds.push({ underlying_at: { price, op } });
  }

  const pct = firstSignedPercent(text);
  if (pct != null) {
    if (kind === "target") preds.push({ premium_pct_gte: Math.abs(pct) });
    else preds.push({ premium_pct_lte: -Math.abs(pct) });
  }

  if (preds.length === 0) {
    warnings.push(`${kind} unrecognised: "${text}"`);
    return { cond: null, warnings };
  }
  return {
    cond: preds.length === 1 ? preds[0] : { any: preds },
    warnings,
  };
}

/** "12:30 ET — exit if not at T1" → { time_after: { et: "12:30" } } */
function parseTimeStop(text: string | undefined): {
  cond: Condition | null;
  warnings: string[];
} {
  if (!text) return { cond: null, warnings: [] }; // time stop is optional
  const et = firstEtTime(text);
  if (!et) {
    return { cond: null, warnings: [`time_stop unrecognised: "${text}"`] };
  }
  return { cond: { time_after: { et } }, warnings: [] };
}

// ---------------------------------------------------------------------------
// Top-level parser
// ---------------------------------------------------------------------------

/**
 * Map the Trade.direction enum to the long/short used by the trigger
 * predicates. `avoid` is never tradable — caller filters those out earlier,
 * but we default to "long" to keep types narrow.
 */
function directionToSide(d: Trade["direction"]): "long" | "short" {
  if (d === "put" || d === "short") return "short";
  return "long";
}

function directionToOptionType(d: Trade["direction"]): "call" | "put" | null {
  if (d === "call" || d === "long") return "call";
  if (d === "put" || d === "short") return "put";
  return null;
}

export function parseTrade(trade: Trade): ParsedPlan {
  const warnings: string[] = [];
  const side = directionToSide(trade.direction);
  const optionType = directionToOptionType(trade.direction);
  if (!optionType) warnings.push(`direction "${trade.direction ?? "—"}" not tradable`);

  // Contract — strike, expiry, OCC.
  const strike = extractStrike(trade.strike);
  if (strike == null) warnings.push("strike could not be extracted");

  // Expiry: the schema field is sometimes "0DTE" / "2DTE" / "YYYY-MM-DD" /
  // embedded in strike prose. Best effort: pull obvious labels.
  let expiry: string | null = null;
  if (trade.expiry) {
    expiry = String(trade.expiry);
  } else if (typeof trade.strike === "string") {
    const m = trade.strike.match(/(\d+)\s*DTE/i);
    if (m) expiry = `${m[1]}DTE`;
  }

  const occSymbol = extractOcc(
    typeof trade.strike === "string" ? trade.strike : null,
    trade.rationale,
  );

  const contract: ContractIntent = {
    optionType: optionType ?? "call",
    strike,
    expiry,
    occSymbol,
  };

  // Entry zone → midpoint estimate. Useful for risk-engine sizing before we
  // have a live quote.
  let entryMidEstimate: number | null = null;
  let entryZoneRange: [number, number] | null = null;
  if (trade.entry_zone) {
    entryZoneRange = priceRange(trade.entry_zone);
    if (entryZoneRange) {
      entryMidEstimate = (entryZoneRange[0] + entryZoneRange[1]) / 2;
    } else {
      // Single-price entry zone like "$4.20".
      const single = firstDollar(trade.entry_zone);
      if (single != null) entryMidEstimate = single;
    }
    // "mid $4.50" overrides the range midpoint when explicitly stated.
    const mid = trade.entry_zone.match(/mid\s*\$?\s*(\d+(?:\.\d+)?)/i);
    if (mid) entryMidEstimate = Number(mid[1]);
  }

  // Triggers.
  const entry = parseEntryTrigger(trade.entry_trigger);
  const target1 = parseExitLine(
    typeof trade.target1 === "string" ? trade.target1 : trade.target1 != null ? String(trade.target1) : undefined,
    side,
    "target",
  );
  const target2 = parseExitLine(
    typeof trade.target2 === "string" ? trade.target2 : trade.target2 != null ? String(trade.target2) : undefined,
    side,
    "target",
  );
  const stop = parseExitLine(
    typeof trade.stop === "string" ? trade.stop : trade.stop != null ? String(trade.stop) : undefined,
    side,
    "stop",
  );
  const timeStop = parseTimeStop(trade.time_stop);

  warnings.push(
    ...entry.warnings,
    ...target1.warnings,
    ...target2.warnings,
    ...stop.warnings,
    ...timeStop.warnings,
  );

  const ast: TriggerAST = {
    entry: entry.cond,
    target1: target1.cond,
    target2: target2.cond,
    stop: stop.cond,
    time_stop: timeStop.cond,
  };

  // "parsed = true" means the bot has enough to act safely:
  //   - direction + strike known
  //   - entry condition recognised
  //   - target1 AND stop recognised (we never enter a position without an exit)
  // target2 + time_stop are nice-to-have, not blockers.
  const parsed =
    optionType !== null &&
    strike !== null &&
    ast.entry !== null &&
    ast.target1 !== null &&
    ast.stop !== null;

  return {
    ticker: trade.ticker,
    contract,
    ast,
    entryMidEstimate,
    entryZoneRange,
    parsed,
    warnings,
  };
}
