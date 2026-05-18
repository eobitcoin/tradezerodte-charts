/**
 * Deribit public market-data client. Used by the Crypto Max Pain page to
 * pull options chains for BTC and ETH (the two crypto underlyings with
 * deep enough OI to make max-pain analysis meaningful — SOL options have
 * been delisted from both Deribit and OKX as of the build date).
 *
 * Endpoint: https://www.deribit.com/api/v2/public
 * Auth: none required for public endpoints.
 *
 * The book-summary endpoint returns per-instrument: bid/ask, mark price,
 * mark IV, OI, volume — but NOT greeks. Greeks are computed in
 * lib/crypto-maxpain.ts via Black-Scholes from mark_iv + parsed strike +
 * time to expiry. (Deribit's per-instrument /ticker DOES include greeks
 * but only one instrument at a time, which would be 1000+ requests.)
 */

const DERIBIT_BASE = "https://www.deribit.com/api/v2/public";

export type DeribitCurrency = "BTC" | "ETH";

export interface DeribitBookSummary {
  /** Instrument name encodes everything: "BTC-25DEC26-100000-C" */
  instrument_name: string;
  /** Per-contract IV in percent (e.g. 60.28 = 60.28% annualized) */
  mark_iv: number | null;
  /** Mark price in BASE currency units (BTC for BTC options, ETH for ETH options) */
  mark_price: number | null;
  bid_price: number | null;
  ask_price: number | null;
  mid_price: number | null;
  /** Open interest in number of contracts (each contract = 1 BTC or 1 ETH). */
  open_interest: number;
  /** 24h volume in contracts. */
  volume: number;
  /** Underlying spot at the time of the response, in USD. */
  underlying_price: number;
  /** Risk-free rate Deribit uses for greek computation. Usually ~0. */
  interest_rate: number;
  base_currency: string;
  quote_currency: string;
}

interface DeribitEnvelope<T> {
  jsonrpc?: string;
  result?: T;
  error?: { code: number; message: string };
}

/**
 * Fetch every active option for a currency in one call. Response is
 * 700-1000 instruments for BTC/ETH (~1-3 MB JSON). Cached for 60s — max
 * pain changes slowly enough that this is fine.
 */
export async function getBookSummaryByCurrency(
  currency: DeribitCurrency,
): Promise<DeribitBookSummary[]> {
  const url = `${DERIBIT_BASE}/get_book_summary_by_currency?currency=${currency}&kind=option`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 60 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Deribit ${currency} book_summary HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as DeribitEnvelope<DeribitBookSummary[]>;
  if (json.error) {
    throw new Error(`Deribit ${currency} book_summary api error ${json.error.code}: ${json.error.message}`);
  }
  return json.result ?? [];
}

export interface ParsedInstrument {
  currency: DeribitCurrency;
  /** "25DEC26" -> Date for that day at 08:00 UTC (Deribit settlement time). */
  expiry: Date;
  expiryRaw: string;        // "25DEC26"
  strike: number;           // 100000
  optionType: "call" | "put";
}

const MONTH_MAP: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/**
 * Parse a Deribit instrument name like "BTC-25DEC26-100000-C" into
 * structured fields. Returns null if the name doesn't match the
 * expected pattern (skip those rows — they're irrelevant).
 */
export function parseInstrumentName(name: string): ParsedInstrument | null {
  // Format: <CURRENCY>-<DDMMMYY>-<STRIKE>-<C|P>
  const match = /^([A-Z]+)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:\.\d+)?)-([CP])$/.exec(name);
  if (!match) return null;
  const [, ccy, ddRaw, monAbbr, yyRaw, strikeRaw, cp] = match;
  if (ccy !== "BTC" && ccy !== "ETH") return null;
  const dd = Number(ddRaw);
  const mon = MONTH_MAP[monAbbr];
  const yy = Number(yyRaw);
  if (!Number.isFinite(dd) || mon == null || !Number.isFinite(yy)) return null;
  const fullYear = 2000 + yy;
  // Deribit options expire at 08:00 UTC.
  const expiry = new Date(Date.UTC(fullYear, mon, dd, 8, 0, 0));
  return {
    currency: ccy,
    expiry,
    expiryRaw: `${ddRaw}${monAbbr}${yyRaw}`,
    strike: Number(strikeRaw),
    optionType: cp === "C" ? "call" : "put",
  };
}

/** Group instruments by their expiry date (ISO YYYY-MM-DD in UTC). */
export function groupByExpiry<T extends { instrument_name: string }>(
  rows: T[],
): Map<string, Array<T & { parsed: ParsedInstrument }>> {
  const out = new Map<string, Array<T & { parsed: ParsedInstrument }>>();
  for (const r of rows) {
    const parsed = parseInstrumentName(r.instrument_name);
    if (!parsed) continue;
    const key = parsed.expiry.toISOString().slice(0, 10);
    const arr = out.get(key);
    const enriched = { ...r, parsed };
    if (arr) arr.push(enriched);
    else out.set(key, [enriched]);
  }
  return out;
}
