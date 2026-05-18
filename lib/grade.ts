import type { Grade, Trade } from "./db/schema";

const ORDER: Grade[] = [
  "A+", "A", "A-",
  "B+", "B", "B-",
  "C+", "C", "C-",
  "D+", "D", "D-",
  "F",
];

export function gradeRank(g: Grade | null | undefined): number {
  if (!g) return 999;
  const i = ORDER.indexOf(g);
  return i === -1 ? 999 : i;
}

export function sortTradesByGrade<T extends { grade?: Grade | null; rank?: number }>(trades: T[]): T[] {
  // Grade is the primary key (A+ first, F last). Rank only breaks ties between
  // trades that share the same grade — we want A-grade trades at the top of the
  // summary table even if the routine listed them later in the source document.
  return [...trades].sort((a, b) => {
    const gradeDiff = gradeRank(a.grade) - gradeRank(b.grade);
    if (gradeDiff !== 0) return gradeDiff;
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    if (a.rank != null) return -1;
    if (b.rank != null) return 1;
    return 0;
  });
}

export type GradeBucket = "A" | "B" | "C" | "D" | "F" | "none";

export function gradeBucket(g: Grade | null | undefined): GradeBucket {
  if (!g) return "none";
  if (g.startsWith("A")) return "A";
  if (g.startsWith("B")) return "B";
  if (g.startsWith("C")) return "C";
  if (g.startsWith("D")) return "D";
  return "F";
}

export function gradeColors(g: Grade | null | undefined): {
  pill: string;
  chip: string;
  border: string;
} {
  switch (gradeBucket(g)) {
    case "A":
      return {
        pill: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40",
        chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        border: "border-emerald-500/40",
      };
    case "B":
      return {
        pill: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/40",
        chip: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
        border: "border-sky-500/40",
      };
    case "C":
      return {
        pill: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40",
        chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        border: "border-amber-500/40",
      };
    case "D":
      return {
        pill: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/40",
        chip: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
        border: "border-orange-500/40",
      };
    case "F":
      return {
        pill: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/40",
        chip: "bg-red-500/15 text-red-700 dark:text-red-300",
        border: "border-red-500/40",
      };
    default:
      return {
        pill: "bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60 border-black/10 dark:border-white/10",
        chip: "bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60",
        border: "border-black/10 dark:border-white/10",
      };
  }
}

export function topTradesForCalendar(trades: Trade[], limit = 3): Trade[] {
  return sortTradesByGrade(trades).slice(0, limit);
}

export function tickerAnchor(ticker: string): string {
  return `ticker-${ticker.toUpperCase()}`;
}

/**
 * Strip OCC option symbols from a Strike display string. OCC format is:
 *
 *   <ticker><YYMMDD><C|P><strike-padded-to-8-digits>
 *   e.g. TSLA260513C00445000  (TSLA, May 13 2026, Call, $445.000)
 *
 * The routine sometimes embeds these inside the Strike cell text, like:
 *   "445 Call (TSLA260513C00445000, 2DTE Wed expiry — nearest available)"
 *
 * Users don't read OCC symbols visually — strip them and clean up the
 * leftover punctuation so the Trade Summary table reads naturally:
 *   "445 Call (2DTE Wed expiry — nearest available)"
 */
export function cleanStrikeDisplay(v: number | string | undefined | null): string {
  if (v == null) return "—";
  if (typeof v === "number") {
    return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  let s = String(v);
  // Remove OCC symbols. The ticker portion can be 1–6 alpha chars.
  s = s.replace(/[A-Z]{1,6}\d{6}[CP]\d{8}/g, "");
  // Clean up the leftover punctuation that the strip leaves behind.
  s = s.replace(/,\s*,/g, ",");        // collapse double commas
  s = s.replace(/\(\s*,\s*/g, "(");    // ", " right after open paren
  s = s.replace(/,\s*\)/g, ")");       // ", " right before close paren
  s = s.replace(/\(\s*\)/g, "");       // empty parens
  s = s.replace(/\s+/g, " ");          // collapse extra whitespace
  s = s.replace(/\s+([)\],])/g, "$1"); // space before closing punctuation
  return s.trim();
}
