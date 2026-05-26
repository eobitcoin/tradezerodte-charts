#!/usr/bin/env node
/**
 * Second-pass backfill for today's 8 metals research posts. The first
 * pass (backfill-metals-stars.mjs) mistakenly converted the original
 * | Level | Context | tables into a bulleted list, then I learned the
 * canonical format is actually a 3-column table with star ratings
 * embedded in a "Type" column using the Wicked Stocks vocabulary:
 *
 *   ★★★★★  Annual containment   — cycle anchors
 *   ★★★★   Multi-week contain   — major D/B-wave pivots
 *   ★★★    Weekly containment   — weekly-bar pivots
 *   ★★     Intra-day containment — round numbers / recent pivots
 *   ★      Session containment  — single-session extremes
 *   (none) Wave projection      — ABCD measured-move targets (no stars)
 *
 * This script parses my v1 bullet output (`- ★(s) $X — context`) and
 * rebuilds the proper `| Level | Type | Role |` table with Type
 * classifications driven by the same keyword heuristics, but now 5-star
 * granularity instead of 3.
 *
 * Heuristics (context substring → Type):
 *   - "absolute cycle", "cycle high", "cycle low", "tariff-crash"        → Annual containment (★★★★★)
 *   - "long-term base/cycle", "wave a", "c-wave"                          → Annual containment (★★★★★)
 *   - "wave d", "corrective floor", "abcd anchor", "d-wave"               → Multi-week contain (★★★★)
 *   - "wave b", "b-wave high", "spike high", "breakout"                   → Multi-week contain (★★★★)
 *   - "weekly", "swing high", "swing low", "recovery high", "pivot"       → Weekly containment (★★★)
 *   - "round number", explicit $X00.00, "intra-day"                       → Intra-day containment (★★)
 *   - "session"                                                           → Session containment (★)
 *   - default fallback                                                    → Weekly containment (★★★)
 *
 * Run modes:
 *   DRY_RUN=1 → prints proposed transforms, no DB writes
 *   DRY_RUN=0 → applies UPDATEs
 */

import postgres from "postgres";

const DRY_RUN = process.env.DRY_RUN !== "0";
const TARGET_SCAN_DAY = process.env.SCAN_DAY || "2026-05-25";
const TARGET_ASSET_CLASS = process.env.ASSET_CLASS || "metals";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Set DATABASE_URL.");
  process.exit(1);
}

const sql = postgres(DB_URL, { ssl: "require" });

/** Classify the level into a Wicked Stocks Type label given the context blurb. */
function classifyType(context) {
  const lo = context.toLowerCase();
  // Annual containment — cycle anchors, wave A/C, long-term base.
  if (
    /\babsolute\b.*\b(high|low|terminus|cycle|base)\b/.test(lo) ||
    /\bcycle\s+(high|low|base|anchor|terminus)\b/.test(lo) ||
    /\btariff[- ]crash\b/.test(lo) ||
    /\b(long[- ]term|cycle)\s+base\b/.test(lo) ||
    /\bwave\s*a\b/.test(lo) ||
    /\bc[- ]wave\b/.test(lo) ||
    /\bnovember\s+4,?\s*2025\b/.test(lo)
  ) {
    return "Annual containment (★★★★★)";
  }
  // Multi-week contain — D/B-wave pivots, corrective floors, spike highs.
  if (
    /\bwave\s*d\b/.test(lo) ||
    /\bcorrective\s+floor\b/.test(lo) ||
    /\bd[- ]wave\b/.test(lo) ||
    /\babcd\b/.test(lo) ||
    /\b(wave\s*b|b[- ]wave)\s+(high|peak)\b/.test(lo) ||
    /\bspike\s+(high|terminus)\b/.test(lo) ||
    /\bbreakout\b/.test(lo) ||
    /\b(structural\s+(floor|high)|primary\s+(top|bottom))\b/.test(lo)
  ) {
    return "Multi-week contain (★★★★)";
  }
  // Weekly containment — swing highs/lows, recovery highs, weekly pivots.
  if (
    /\bweekly\b/.test(lo) ||
    /\bswing\s+(high|low|close)\b/.test(lo) ||
    /\brecovery\s+(high|peak|resistance|close)\b/.test(lo) ||
    /\bpivot\b/.test(lo) ||
    /\bsecondary\s+(peak|top)\b/.test(lo) ||
    /\bnear[- ]term\s+(resistance|support|pivot|overhead)\b/.test(lo)
  ) {
    return "Weekly containment (★★★)";
  }
  // Intra-day containment — round numbers, recent pivots, intra-day.
  if (
    /\bround\s+number\b/.test(lo) ||
    /\bintra[- ]day\b/.test(lo) ||
    /\$[0-9]+0\.00\b/.test(context) // exact round-number price like $300.00
  ) {
    return "Intra-day containment (★★)";
  }
  // Session containment — single-session highs/lows.
  if (/\bsession\s+(high|low)\b/.test(lo)) {
    return "Session containment (★)";
  }
  // Default: most level mentions in a write-up are weekly-grade pivots.
  return "Weekly containment (★★★)";
}

/**
 * Transform a body_md that contains a "## Key Levels" section followed
 * by my v1 bullet list back into the canonical 3-column table format.
 * Returns the new body or { changed: false, reason } when nothing to do.
 */
function transformBody(bodyMd) {
  // Regex captures: (1) the heading line, (2) the bullet block that follows.
  // Bullets look like: "- ★(s) $price — context"
  const re =
    /(#{1,4}\s*Key\s+Levels?[^\n]*)\n+((?:[ \t]*-\s*★[★\s]*\$[^\n]+\n?)+)/i;
  const m = bodyMd.match(re);
  if (!m) return { changed: false, reason: "no Key Levels + bullet block" };
  const headingText = m[1];
  const bulletBlock = m[2];

  // Parse each bullet — split into stars / price / context.
  const bulletRe = /^\s*-\s*(★+)\s+(\$[\d.,]+)\s*(?:—|-|–)\s*(.+?)\s*$/;
  const rows = [];
  for (const line of bulletBlock.split("\n")) {
    if (!line.trim()) continue;
    const bm = line.match(bulletRe);
    if (!bm) continue;
    const [, , price, context] = bm;
    const type = classifyType(context);
    rows.push({ price, type, role: context });
  }
  if (rows.length === 0) return { changed: false, reason: "no parseable bullets" };

  // Rebuild the heading as "## Key Level Map" (canonical title) regardless
  // of what the routine emitted, then the 3-column table.
  const tableLines = [
    "| Level | Type | Role |",
    "|-------|------|------|",
    ...rows.map((r) => `| ${r.price} | ${r.type} | ${r.role} |`),
  ];
  const replacement = `## Key Level Map\n\n${tableLines.join("\n")}\n`;
  // Use function-callback replace so $-prefixed prices don't get
  // mangled as regex backreferences (lesson from v1).
  const newBody = bodyMd.replace(re, () => replacement);
  return { changed: true, newBody, items: rows.length };
}

async function main() {
  const rows = await sql`
    SELECT id, ticker, scan_day::text AS scan_day, body_md
    FROM research_posts
    WHERE asset_class = ${TARGET_ASSET_CLASS}
      AND scan_day = ${TARGET_SCAN_DAY}
    ORDER BY ticker
  `;
  console.log(
    `Found ${rows.length} ${TARGET_ASSET_CLASS} rows for ${TARGET_SCAN_DAY}.`,
  );
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE (will UPDATE)"}\n`);

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const out = transformBody(row.body_md);
    if (!out.changed) {
      console.log(`SKIP  ${row.ticker} — ${out.reason}`);
      skipped++;
      continue;
    }
    console.log(`OK    ${row.ticker} — ${out.items} rows`);
    const sectionMatch = out.newBody.match(
      /#{1,4}\s*Key\s+Level\s+Map[^\n]*\n+(?:\|[^\n]*\|\n)+/i,
    );
    if (sectionMatch) {
      console.log(sectionMatch[0].split("\n").map((l) => `      ${l}`).join("\n"));
    }
    if (!DRY_RUN) {
      await sql`
        UPDATE research_posts
        SET body_md = ${out.newBody}, updated_at = now()
        WHERE id = ${row.id}
      `;
      updated++;
    }
  }
  console.log(
    `\nDone. ${DRY_RUN ? `Would update ${rows.length - skipped}.` : `Updated ${updated}.`} Skipped ${skipped}.`,
  );
  await sql.end();
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
