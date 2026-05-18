// Markdown -> structured trades parser.
// Used both by the CLI (scripts/ingest-routine.ts) and server-side in /api/posts
// to extract trades from a routine's markdown report.
//
// Recognises three formats per ticker section:
//   1. Pandoc grid tables (`Strike    $275C`)
//   2. GFM tables (`| Strike | $275C |`)
//   3. Bold/plain key-value lines (`**Strike:** $275C` / `Strike: $275C`)

import type { Grade, Trade, Direction } from "./db/schema";

export const VALID_GRADES = new Set<Grade>([
  "A+", "A", "A-",
  "B+", "B", "B-",
  "C+", "C", "C-",
  "D+", "D", "D-",
  "F",
]);

function escapeRe(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function unescapePandoc(s: string): string {
  return s
    .replace(/\\\$/g, "$")
    .replace(/\\~/g, "~")
    .replace(/\\\[/g, "[")
    .replace(/\\\]/g, "]")
    .replace(/\\</g, "<")
    .replace(/\\>/g, ">")
    .replace(/\\\&/g, "&")
    .replace(/\\\*/g, "*")
    .replace(/\\_/g, "_");
}

function cleanValue(v: string): string {
  return unescapePandoc(v.replace(/\*+/g, "").trim())
    .replace(/^\s*[-–—:]\s+/, "")
    .trim();
}

function normalizeMinus(s: string): string {
  return s.replace(/[−–—]/g, "-");
}

interface SectionHit {
  ticker: string;
  description: string;
  start: number;
  end: number;
  text: string;
}

export function findTickerSections(md: string): SectionHit[] {
  const lines = md.split("\n");
  const tickerRe = /^\s{0,3}(?:#+\s*)?\*?\*?([A-Z]{1,6})\*?\*?\s+(?:---|—|–)\s+(.+?)\s*$/;
  // Match "## Section 3", "**SECTION 3**", "Section 3", etc. — any heading-style line
  // that begins with optional `#`/`*` decoration followed by SECTION + digit.
  const sectionBoundaryRe = /^\s*[#*]*\s*SECTION\s+\d/i;
  const found: { ticker: string; description: string; start: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(tickerRe);
    if (!m) continue;
    const ticker = m[1];
    const desc = m[2].replace(/\*+/g, "").trim();
    if (/^SECTION\b/i.test(ticker) || /SECTION\b/i.test(desc)) continue;
    if (ticker.length === 1) continue;
    found.push({ ticker, description: desc, start: i });
  }

  const findNextSectionBoundary = (startLine: number): number => {
    for (let j = startLine; j < lines.length; j++) {
      if (sectionBoundaryRe.test(lines[j])) return j;
    }
    return lines.length;
  };

  return found.map((s, i) => {
    const nextTickerEnd = i + 1 < found.length ? found[i + 1].start : lines.length;
    const sectionEnd = findNextSectionBoundary(s.start + 1);
    const end = Math.min(nextTickerEnd, sectionEnd);
    return {
      ticker: s.ticker,
      description: s.description,
      start: s.start,
      end,
      text: lines.slice(s.start, end).join("\n"),
    };
  });
}

export function extractGrade(section: string): Grade | null {
  const text = normalizeMinus(section);
  const re = /Trade\s*Grade[\s:|*]*?(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F)(?![A-Z])/i;
  const m = text.match(re);
  if (!m) return null;
  const g = m[1].toUpperCase() as Grade;
  return VALID_GRADES.has(g) ? g : null;
}

export function extractRationale(section: string, grade: Grade): string | undefined {
  const text = normalizeMinus(section);
  const re = new RegExp(
    `Trade\\s*Grade[\\s:|*]*?${escapeRe(grade)}\\*{0,2}\\s*(?:---|--|—)?\\s*([^\\n|]+?)\\s*(?:\\||$)`,
    "im",
  );
  const m = text.match(re);
  if (m && m[1]) {
    const v = cleanValue(m[1]);
    if (v && !/^[-—–]+$/.test(v)) return v;
  }
  return undefined;
}

export function extractField(section: string, label: string): string | undefined {
  const lab = escapeRe(label);
  const patterns = [
    new RegExp(`^\\s*${lab}\\s{2,}(.+?)\\s*$`, "im"),
    new RegExp(`\\|\\s*\\*{0,2}\\s*${lab}\\s*:?\\s*\\*{0,2}\\s*\\|\\s*(.+?)\\s*\\|`, "im"),
    new RegExp(`\\*\\*\\s*${lab}\\s*:?\\s*\\*\\*\\s+(.+?)\\s*$`, "im"),
    new RegExp(`^\\s*-?\\s*${lab}\\s*:\\s+(.+?)\\s*$`, "im"),
  ];
  for (const re of patterns) {
    const m = section.match(re);
    if (m && m[1]) {
      const v = cleanValue(m[1]).replace(/^\|+\s*|\s*\|+$/g, "");
      if (v && !/^[-—–|]+$/.test(v)) return v;
    }
  }
  return undefined;
}

export function detectDirection(section: string, grade: Grade, strike?: string): Direction | undefined {
  if (grade === "F" || /\bAVOID\b/i.test(section)) return "avoid";
  if (/PUT[\s)(.\-]/i.test(section)) return "put";
  if (/CALL[\s)(.\-]/i.test(section)) return "call";
  if (strike) {
    const s = strike.replace(/[*_$\s]+/g, "");
    // Look for a digit-then-P/C pattern (e.g. "332P", "7100P", "275C") followed by either
    // end-of-string or a non-letter (so "332P0DTE" still matches but "Pcompany" doesn't).
    if (/\d+P(?![a-zA-Z])/.test(s)) return "put";
    if (/\d+C(?![a-zA-Z])/.test(s)) return "call";
    // Fallback: explicit "PUT" / "CALL" word in the strike
    if (/\bPUT\b/i.test(s)) return "put";
    if (/\bCALL\b/i.test(s)) return "call";
  }
  return undefined;
}

export function inferTitle(md: string): string | null {
  const lines = md.split("\n").slice(0, 30);
  const headingMatch = lines.find((l) => /^#+\s+/.test(l));
  if (headingMatch) return headingMatch.replace(/^#+\s+/, "").replace(/\*+/g, "").trim();
  for (const line of lines) {
    const m = line.match(/^\*\*(.+?)\*\*\s*$/);
    if (m) return cleanValue(m[1]);
  }
  return null;
}

export function parseTradesFromMarkdown(md: string): Trade[] {
  const sections = findTickerSections(md);
  const trades: Trade[] = [];
  for (const s of sections) {
    const grade = extractGrade(s.text);
    if (!grade) continue;
    const strike =
      extractField(s.text, "Strike") ??
      extractField(s.text, "Preferred Strike") ??
      extractField(s.text, "Preferred");
    const direction = detectDirection(s.text, grade, strike);
    trades.push({
      ticker: s.ticker,
      grade,
      direction,
      strike,
      entry_zone: extractField(s.text, "Premium Zone") ?? extractField(s.text, "Premium"),
      entry_trigger: extractField(s.text, "Entry Trigger") ?? extractField(s.text, "Entry"),
      target1: extractField(s.text, "Target 1") ?? extractField(s.text, "Target"),
      target2: extractField(s.text, "Target 2"),
      stop: extractField(s.text, "Stop Loss") ?? extractField(s.text, "Stop"),
      time_stop: extractField(s.text, "Time Stop"),
      rationale: extractRationale(s.text, grade),
    });
  }
  trades.forEach((t, i) => {
    if (t.rank == null) t.rank = i + 1;
  });
  return trades;
}
