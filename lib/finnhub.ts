/**
 * Finnhub economic-calendar client.
 *
 * Free-tier API (60 calls/min) at https://finnhub.io/api/v1.
 * One call per ingest covers the entire upcoming week, so we're well under
 * the rate limit.
 *
 * Docs: https://finnhub.io/docs/api/economic-calendar
 */

const FINNHUB_BASE = "https://finnhub.io/api/v1";

interface FinnhubEventRaw {
  country?: string;          // "US", "EU", "JP", "GB", "CN", ...
  event?: string;             // "CPI YoY", "Fed Chair Powell Speaks", ...
  time?: string;              // "2026-05-15 12:30:00" (UTC)
  actual?: number | null;
  estimate?: number | null;
  prev?: number | null;
  unit?: string;
  /** Finnhub uses 0..3 for impact level. We map: 0 → low, 1 → low, 2 → medium, 3 → high. */
  impact?: number;
}

interface FinnhubCalendarResponse {
  economicCalendar?: {
    events?: FinnhubEventRaw[];
  };
}

export interface FinnhubEvent {
  country: string;
  title: string;
  time: Date;
  actual: number | null;
  estimate: number | null;
  prior: number | null;
  unit: string | null;
  importance: "low" | "medium" | "high";
  raw: FinnhubEventRaw;
}

function mapImportance(n: number | undefined): "low" | "medium" | "high" {
  if (n == null) return "low";
  if (n >= 3) return "high";
  if (n >= 2) return "medium";
  return "low";
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull economic events between [from, to] dates inclusive (YYYY-MM-DD UTC).
 * Returns parsed events with a normalized importance level. Caller is
 * responsible for filtering by country.
 */
export async function fetchFinnhubEconomicCalendar(opts: {
  from: string; // YYYY-MM-DD
  to: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<FinnhubEvent[]> {
  const apiKey = opts.apiKey ?? process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error("FINNHUB_API_KEY is not set");
  const fetchFn = opts.fetchImpl ?? fetch;

  const url = new URL(`${FINNHUB_BASE}/calendar/economic`);
  url.searchParams.set("from", opts.from);
  url.searchParams.set("to", opts.to);
  url.searchParams.set("token", apiKey);

  const res = await fetchFn(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Finnhub HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as FinnhubCalendarResponse;
  const events = data.economicCalendar?.events ?? [];

  const out: FinnhubEvent[] = [];
  for (const e of events) {
    if (!e.time || !e.event) continue;
    // Finnhub returns "YYYY-MM-DD HH:mm:ss" without a TZ suffix — it's UTC.
    // Normalize to a Date by appending Z.
    const iso = e.time.replace(" ", "T") + "Z";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    out.push({
      country: e.country ?? "",
      title: e.event.trim(),
      time: d,
      actual: toNum(e.actual),
      estimate: toNum(e.estimate),
      prior: toNum(e.prev),
      unit: e.unit && e.unit.trim() !== "" ? e.unit : null,
      importance: mapImportance(e.impact),
      raw: e,
    });
  }
  return out;
}

// ============================================================================
// Earnings calendar — for the Earnings Scans feature.
// ============================================================================

/** One upcoming earnings event. `hour` indicates BMO (before-market-open),
 *  AMC (after-market-close), or DMH (during market hours / unknown). */
export interface FinnhubEarningsEvent {
  symbol: string;
  date: string; // YYYY-MM-DD
  hour: "bmo" | "amc" | "dmh";
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  quarter: number | null;
  year: number | null;
}

interface FinnhubEarningsCalendarRaw {
  earningsCalendar?: Array<{
    symbol?: string;
    date?: string;
    hour?: string;
    epsEstimate?: number | null;
    epsActual?: number | null;
    revenueEstimate?: number | null;
    revenueActual?: number | null;
    quarter?: number | null;
    year?: number | null;
  }>;
}

function key(): string {
  const k = process.env.FINNHUB_API_KEY;
  if (!k) throw new Error("FINNHUB_API_KEY not set");
  return k;
}

/**
 * Fetch the earnings calendar for a date range. Returns every US-listed
 * company reporting between `from` and `to` (inclusive). The full week's
 * calendar typically returns 100-300 events.
 *
 * One Finnhub call per range. Well under the 60/min free-tier limit.
 */
export async function fetchUpcomingEarnings(opts: {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  symbol?: string;
}): Promise<FinnhubEarningsEvent[]> {
  const qs = new URLSearchParams({
    from: opts.from,
    to: opts.to,
    token: key(),
  });
  if (opts.symbol) qs.set("symbol", opts.symbol);
  const url = `${FINNHUB_BASE}/calendar/earnings?${qs}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Finnhub earnings calendar → HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const body: FinnhubEarningsCalendarRaw = await res.json();
  const out: FinnhubEarningsEvent[] = [];
  for (const e of body.earningsCalendar ?? []) {
    if (!e.symbol || !e.date) continue;
    const rawHour = (e.hour ?? "").toLowerCase();
    const hour: "bmo" | "amc" | "dmh" =
      rawHour === "bmo" ? "bmo" : rawHour === "amc" ? "amc" : "dmh";
    out.push({
      symbol: e.symbol.toUpperCase(),
      date: e.date,
      hour,
      epsEstimate: typeof e.epsEstimate === "number" ? e.epsEstimate : null,
      epsActual: typeof e.epsActual === "number" ? e.epsActual : null,
      revenueEstimate:
        typeof e.revenueEstimate === "number" ? e.revenueEstimate : null,
      revenueActual: typeof e.revenueActual === "number" ? e.revenueActual : null,
      quarter: typeof e.quarter === "number" ? e.quarter : null,
      year: typeof e.year === "number" ? e.year : null,
    });
  }
  return out;
}

/**
 * Past earnings dates for one ticker — used by the Earnings Scans to
 * compute EE history (price/IV changes around each past earnings).
 *
 * Returns the most recent `limit` earnings events, newest first. Date
 * is the announcement date; `hour` indicates BMO/AMC so we can offset
 * the price-change window correctly (BMO uses prior close → same-day
 * close; AMC uses same-day close → next-day close).
 *
 * Source preference:
 *   1. Polygon /vX/reference/financials — covers 5+ years of history
 *      via 10-Q/10-K filing dates. Free under our Options Advanced
 *      plan. Used as primary because Finnhub's free tier caps at ~1y.
 *   2. Finnhub /calendar/earnings — fallback for tickers Polygon
 *      doesn't have (rare: foreign issuers, very recent IPOs, OTC
 *      names). Capped at ~1y on free tier.
 *
 * Both sources are normalized to the same FinnhubEarningsEvent shape
 * so callers don't need to change.
 */
export async function fetchEarningsHistory(
  symbol: string,
  limit = 10,
): Promise<FinnhubEarningsEvent[]> {
  // Primary: Polygon financials (5+ years history)
  try {
    const { fetchEarningsHistoryFromPolygon } = await import("@/lib/polygon");
    const polyEvents = await fetchEarningsHistoryFromPolygon(symbol, limit);
    if (polyEvents.length > 0) {
      return polyEvents.map((e) => ({
        symbol,
        date: e.earningsDate,
        hour: e.hour,
        epsEstimate: null,
        epsActual: null,
        revenueEstimate: null,
        revenueActual: null,
        quarter: e.fiscalPeriod
          ? Number(e.fiscalPeriod.replace(/\D/g, "")) || null
          : null,
        year: e.fiscalYear ? Number(e.fiscalYear) || null : null,
      }));
    }
  } catch {
    // Fall through to Finnhub.
  }

  // Fallback: Finnhub (1 year max on free tier)
  const today = new Date();
  const past = new Date();
  past.setUTCFullYear(today.getUTCFullYear() - 5);
  const events = await fetchUpcomingEarnings({
    symbol,
    from: past.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  });
  return events
    .filter((e) => e.date <= today.toISOString().slice(0, 10))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}
