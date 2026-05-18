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
