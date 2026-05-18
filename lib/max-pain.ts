import type { MaxPainGroup, MaxPainTicker, GexRegime, MaxPainAlertSeverity } from "./db/schema";

export const GROUP_LABELS: Record<MaxPainGroup, string> = {
  trading_focus: "Trading Focus",
  pin_friendly: "Pin-Friendly",
  index_vol: "Index / Vol",
  mega_cap: "Mega Cap",
};

export const GROUP_ORDER: MaxPainGroup[] = ["trading_focus", "pin_friendly", "index_vol", "mega_cap"];

export const RETAIL_TICKERS = new Set(["HOOD", "SOFI", "RBLX"]);
export const PIN_TICKERS = new Set(["SOFI", "RIVN", "AFRM", "RBLX", "PLTR", "HOOD"]);

export function regimeColors(r?: GexRegime | null): {
  pill: string;
  border: string;
  label: string;
} {
  switch (r) {
    case "POS":
      return {
        pill: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40",
        border: "border-l-emerald-500/60",
        label: "POS",
      };
    case "NEG":
      return {
        pill: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40",
        border: "border-l-rose-500/60",
        label: "NEG",
      };
    case "FLIP":
      return {
        pill: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40",
        border: "border-l-amber-500/60",
        label: "FLIP",
      };
    default:
      return {
        pill: "bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50 border-black/10 dark:border-white/10",
        border: "border-l-black/20 dark:border-l-white/20",
        label: "—",
      };
  }
}

export function severityColors(s: MaxPainAlertSeverity): {
  pill: string;
  dot: string;
} {
  switch (s) {
    case "HIGH":
      return {
        pill: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40",
        dot: "bg-rose-500",
      };
    case "MED":
      return {
        pill: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40",
        dot: "bg-amber-500",
      };
    case "LOW":
      return {
        pill: "bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60 border-black/10 dark:border-white/10",
        dot: "bg-black/40 dark:bg-white/40",
      };
  }
}

export function groupTickers(tickers: MaxPainTicker[]): Record<MaxPainGroup, MaxPainTicker[]> {
  const out: Record<MaxPainGroup, MaxPainTicker[]> = {
    trading_focus: [],
    pin_friendly: [],
    index_vol: [],
    mega_cap: [],
  };
  for (const t of tickers) {
    const g = (t.group ?? "mega_cap") as MaxPainGroup;
    if (out[g]) out[g].push(t);
  }
  return out;
}

export function pickActiveTicker(tickers: MaxPainTicker[], requested?: string): MaxPainTicker | undefined {
  if (!tickers.length) return undefined;
  if (requested) {
    const upper = requested.toUpperCase();
    const found = tickers.find((t) => t.ticker.toUpperCase() === upper);
    if (found) return found;
  }
  // Default: TSLA if present, else first in trading_focus, else first overall.
  const tsla = tickers.find((t) => t.ticker.toUpperCase() === "TSLA");
  if (tsla) return tsla;
  const tf = tickers.find((t) => t.group === "trading_focus");
  return tf ?? tickers[0];
}

export function fmtNum(n: number | undefined, opts?: { decimals?: number }): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: opts?.decimals ?? 2 });
}

export function fmtPct(n: number | undefined, decimals = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(decimals)}%`;
}

export function pctFromSpot(level: number | undefined, spot: number | undefined): number | undefined {
  if (level == null || spot == null || spot === 0) return undefined;
  return ((level - spot) / spot) * 100;
}

export function fmtMoney(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}B`;
  if (Math.abs(n) >= 0.001) return `$${(n * 1000).toFixed(0)}M`;
  return `$${(n * 1_000_000).toFixed(0)}K`;
}
