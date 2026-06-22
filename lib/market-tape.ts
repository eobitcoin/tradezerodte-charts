/**
 * Market tape — small set of market-context metrics rendered as a strip
 * across the top of the dashboard. Pulled from Tradier (your existing
 * data plan; Polygon indices aren't entitled).
 *
 * V1 metrics:
 *   - VIX, VIX3M (volatility surface front + back)
 *   - Ratio (VIX3M / VIX) and slope (% gap)
 *   - Term structure label (contango / backwardation / flat)
 *   - SKEW (CBOE) + plain-English tail-risk label
 *   - DXY proxy via UUP (Invesco DB US Dollar Bullish ETF)
 *
 * Deferred for V2: 2Y / 10Y treasury yields + curve diff. Tradier doesn't
 * expose treasury yield symbols cleanly; would need FRED API or scraping.
 */

const TRADIER_BASE = "https://api.tradier.com/v1";

export interface MarketTapeMetric {
  /** Display label (uppercase, terse). */
  label: string;
  /** Primary value as a formatted string. */
  value: string;
  /** Optional secondary text (delta, qualifier). */
  hint?: string | null;
  /** Color tint for the value. */
  tone?: "pos" | "neg" | "neutral" | "warn";
}

export interface MarketTapeData {
  asOf: string;            // ISO timestamp
  metrics: MarketTapeMetric[];
  /** Anything that failed to fetch — surfaced for ops, not for users. */
  errors: string[];
}

interface TradierQuote {
  symbol: string;
  last: number | null;
  change: number | null;
  change_percentage: number | null;
  prevclose: number | null;
}

async function fetchTradierQuotes(symbols: string[]): Promise<Map<string, TradierQuote>> {
  const token = process.env.TRADIER_API_KEY;
  if (!token) throw new Error("TRADIER_API_KEY not set");
  const url = `${TRADIER_BASE}/markets/quotes?symbols=${encodeURIComponent(symbols.join(","))}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Tradier quotes → HTTP ${res.status}`);
  const body = (await res.json()) as {
    quotes?: { quote?: TradierQuote | TradierQuote[] };
  };
  const raw = body.quotes?.quote;
  const arr: TradierQuote[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = new Map<string, TradierQuote>();
  for (const q of arr) {
    if (q?.symbol) out.set(q.symbol.toUpperCase(), q);
  }
  return out;
}

function termStructureLabel(vix: number, vix3m: number): { label: string; tone: MarketTapeMetric["tone"] } {
  const slope = ((vix3m - vix) / vix) * 100;
  if (slope >= 5) return { label: "CONTANGO", tone: "pos" };       // calm; vol curve upward-sloping
  if (slope <= -5) return { label: "BACKWARDATION", tone: "neg" }; // stress; vol curve inverted
  return { label: "FLAT", tone: "warn" };
}

function skewTailLabel(skew: number): { label: string; tone: MarketTapeMetric["tone"] } {
  // CBOE SKEW typically 100-150. >130 = elevated, >145 = rich, >155 = extreme.
  if (skew >= 155) return { label: "extreme tails", tone: "neg" };
  if (skew >= 145) return { label: "rich tails", tone: "warn" };
  if (skew >= 130) return { label: "moderate tails", tone: "warn" };
  return { label: "normal tails", tone: "pos" };
}

function fmtSignedPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

export async function fetchMarketTape(): Promise<MarketTapeData> {
  const errors: string[] = [];
  let quotes: Map<string, TradierQuote> = new Map();
  try {
    quotes = await fetchTradierQuotes(["VIX", "VIX3M", "SKEW", "UUP"]);
  } catch (err) {
    errors.push(`Tradier fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const vix = quotes.get("VIX");
  const vix3m = quotes.get("VIX3M");
  const skew = quotes.get("SKEW");
  const uup = quotes.get("UUP");

  const metrics: MarketTapeMetric[] = [];

  if (vix?.last != null) {
    metrics.push({
      label: "VIX",
      value: vix.last.toFixed(2),
      hint: fmtSignedPct(vix.change_percentage),
      tone: (vix.change_percentage ?? 0) >= 0 ? "warn" : "pos",
    });
  }

  if (vix3m?.last != null) {
    metrics.push({
      label: "VIX3M",
      value: vix3m.last.toFixed(2),
      tone: "neutral",
    });
  }

  if (vix?.last != null && vix3m?.last != null && vix.last > 0) {
    const ratio = vix3m.last / vix.last;
    const slopePct = ((vix3m.last - vix.last) / vix.last) * 100;
    const term = termStructureLabel(vix.last, vix3m.last);
    metrics.push({ label: "Ratio", value: ratio.toFixed(3), tone: "neutral" });
    metrics.push({
      label: "Slope",
      value: fmtSignedPct(slopePct),
      tone: slopePct >= 0 ? "pos" : "neg",
    });
    metrics.push({
      label: "Term",
      value: term.label,
      tone: term.tone,
    });
  }

  if (skew?.last != null) {
    const tail = skewTailLabel(skew.last);
    metrics.push({
      label: "SKEW",
      value: skew.last.toFixed(1),
      hint: tail.label,
      tone: tail.tone,
    });
  }

  if (uup?.last != null) {
    metrics.push({
      label: "DXY (UUP)",
      value: `$${uup.last.toFixed(2)}`,
      hint: fmtSignedPct(uup.change_percentage),
      tone: (uup.change_percentage ?? 0) >= 0 ? "pos" : "neg",
    });
  }

  return {
    asOf: new Date().toISOString(),
    metrics,
    errors,
  };
}
