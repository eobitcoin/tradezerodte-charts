#!/usr/bin/env node
/**
 * One-shot backfill for the 8 metals research posts from 2026-05-25 that
 * landed with `| Level | Context |` markdown tables instead of the
 * required bulleted ★/★★/★★★ format.
 *
 * Strategy:
 *   1. Pull each row's body_md.
 *   2. Locate the "## Key Levels" section and its trailing markdown table.
 *   3. Parse each table row (price + context).
 *   4. Apply a keyword heuristic to assign ★/★★/★★★:
 *        - ★★★: cycle/absolute high or low, Wave D, ABCD anchor,
 *                current support/resistance, structural pivot, primary
 *        - ★★ : spike, swing, channel, recovery, pivot, prior
 *        - ★  : session, intraday, gap
 *        - default ★★ when no keywords match
 *   5. Replace the table with a bulleted list and UPSERT body_md.
 *
 * Run modes:
 *   DRY_RUN=1 → prints proposed transforms, no DB writes
 *   DRY_RUN=0 → applies UPDATEs
 *
 * Heuristic limitations: rating quality won't match a fresh routine run
 * (which judges importance from the full bar context). It's a
 * non-degraded fallback that gives the visual hierarchy back. Re-run
 * the routine for any ticker whose ratings look off.
 */

import postgres from "postgres";

const DRY_RUN = process.env.DRY_RUN !== "0";
const TARGET_SCAN_DAY = process.env.SCAN_DAY || "2026-05-25";
const TARGET_ASSET_CLASS = process.env.ASSET_CLASS || "metals";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Set DATABASE_URL (or DATABASE_PUBLIC_URL).");
  process.exit(1);
}

const sql = postgres(DB_URL, { ssl: "require" });

function rateLevel(context) {
  const lo = context.toLowerCase();
  if (
    /\b(cycle|absolute|wave\s*d\b|abcd|primary|structural)\b/.test(lo) ||
    /current\s+(support|resistance)/.test(lo) ||
    /tariff[- ]crash/.test(lo)
  ) {
    return "★★★";
  }
  if (/\b(spike|swing|channel|recovery|pivot|prior)\b/.test(lo)) {
    return "★★";
  }
  if (/\b(session|intraday|gap)\b/.test(lo)) {
    return "★";
  }
  return "★★";
}

/**
 * Transform a body_md that contains a "## Key Levels" section followed by
 * a markdown table into the bulleted ★ format. Returns the new body
 * (with the table replaced) or null when the input doesn't match the
 * expected shape (no heading, no table, etc.).
 */
function transformBody(bodyMd) {
  // Capture: heading line, then 1+ table lines that immediately follow
  // (allowing blank lines between heading and table).
  const re =
    /(#{1,4}\s*Key\s+Levels?[^\n]*)\n+((?:[ \t]*\|[^\n]*\|\n)+)/i;
  const m = bodyMd.match(re);
  if (!m) return { changed: false, reason: "no Key Levels heading + table" };
  const heading = m[1];
  const tableBlock = m[2];
  const tableLines = tableBlock
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|") && l.endsWith("|"));
  if (tableLines.length < 3) {
    return { changed: false, reason: "table too short (need header+sep+rows)" };
  }
  // Skip header row + separator (---) — keep data rows.
  const dataRows = tableLines.slice(2);
  const items = [];
  for (const row of dataRows) {
    const cells = row
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 2) continue;
    const price = cells[0];
    const context = cells.slice(1).join(" | ");
    if (!/^\$/.test(price)) continue;
    items.push({ price, context });
  }
  if (items.length === 0) return { changed: false, reason: "no parseable rows" };
  const newBlock = items
    .map(({ price, context }) => `- ${rateLevel(context)} ${price} — ${context}`)
    .join("\n");
  const replacement = `${heading}\n\n${newBlock}\n`;
  // CRITICAL: pass replacement via a function, NOT a string. JavaScript's
  // String.replace interprets `$1`, `$2`, etc. in a string replacement as
  // capture-group backreferences — which mangles prices like "$117.18"
  // (treated as `$1` + `17.18` → "## Key Levels17.18"). The function
  // callback returns the literal string with no interpolation.
  const newBody = bodyMd.replace(re, () => replacement);
  return { changed: true, newBody, items: items.length };
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
    console.log(`OK    ${row.ticker} — ${out.items} levels rewritten`);
    // Show the rewritten Key Levels block only
    const sectionMatch = out.newBody.match(
      /#{1,4}\s*Key\s+Levels?[^\n]*\n+(?:- [^\n]*\n)+/i,
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
