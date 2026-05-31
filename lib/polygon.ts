/**
 * Polygon.io client + IV-surface extraction utilities for the Options
 * Edge scanner.
 *
 * Three things this module owns:
 *   1. Authenticated fetch wrappers for Polygon's v3 endpoints we use.
 *   2. Surface-point extraction: given a raw option chain at one as_of
 *      date, compute constant-maturity IV at the points we care about
 *      (30d ATM, 60d ATM, 30d 25-delta put, 30d 25-delta call).
 *   3. Realized-vol computation from underlying daily bars.
 *
 * Why "constant maturity"? Polygon lists discrete expiries (e.g. Fridays).
 * To z-score IV across history meaningfully, we need a stable tenor —
 * always exactly 30 days out. We linearly interpolate between the two
 * listed expiries that bracket the target DTE.
 *
 * Why 25-delta strikes? They define the put-call skew. Strike selection
 * is by greeks not price, so it auto-adjusts to changes in IV and time
 * decay — comparing "the 25Δ put IV today vs 25Δ put IV a year ago" is
 * a stable measure across regimes.
 */

const POLYGON_BASE = "https://api.polygon.io";

function apiKey(): string {
  const k = process.env.POLYGON_API_KEY;
  if (!k) {
    throw new Error("POLYGON_API_KEY not set");
  }
  return k;
}

// ---------------------------------------------------------------------------
// Raw API shapes (subset of what Polygon returns).
// ---------------------------------------------------------------------------

interface PolygonContract {
  details: {
    ticker: string;
    expiration_date: string;
    strike_price: number;
    contract_type: "call" | "put";
  };
  greeks?: {
    delta?: number;
    gamma?: number;
    vega?: number;
    theta?: number;
  };
  implied_volatility?: number;
  last_quote?: {
    bid?: number;
    ask?: number;
    midpoint?: number;
    timeframe?: "REAL-TIME" | "DELAYED";
    last_updated?: number;
  };
  /** Day aggregate — present on chain snapshot rows for actively-traded
   *  contracts. UOA uses `day.volume` to pre-filter which contracts are
   *  worth fetching trades for. */
  day?: {
    volume?: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    previous_close?: number;
  };
  open_interest?: number;
  underlying_asset?: {
    price?: number;
    ticker?: string;
  };
}

interface PolygonChainResponse {
  status?: string;
  results?: PolygonContract[];
  next_url?: string;
  message?: string;
}

interface PolygonAggsResponse {
  status?: string;
  results?: Array<{
    t: number; // timestamp ms
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
  }>;
}

// ---------------------------------------------------------------------------
// HTTP wrappers.
// ---------------------------------------------------------------------------

/**
 * Authenticated GET against Polygon with automatic retry on 429 (and 5xx).
 *
 * Polygon's Options Advanced tier is generous but not infinite — when
 * the daily IV-snapshot cron sweeps 25 tickers back-to-back (≈75 calls in
 * 90 seconds), the per-minute limit can clip the tail. We retry up to 4
 * times with exponential backoff, honoring the `Retry-After` header when
 * Polygon supplies one. Anything else propagates as-is so callers can log
 * + report it.
 */
async function polygonGet<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${POLYGON_BASE}${path}${sep}apiKey=${apiKey()}`;

  const maxAttempts = 4;
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) return (await res.json()) as T;

    const body = await res.text().catch(() => "");
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);

    if (retryable && attempt < maxAttempts) {
      // Prefer the server's hint, fall back to exponential backoff with
      // jitter. Polygon's 429 doesn't always include Retry-After, so cap
      // the floor at 2s × 2^(attempt-1) to give the bucket time to refill.
      const retryAfterHdr = res.headers.get("retry-after");
      const retryAfterSec = retryAfterHdr ? Number(retryAfterHdr) : NaN;
      const backoffMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.min(retryAfterSec * 1000, 30_000)
        : 2_000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, backoffMs));
      continue;
    }

    lastErr = new Error(
      `Polygon ${path} → HTTP ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
    );
    throw lastErr;
  }

  // Exhausted retries.
  throw lastErr ?? new Error(`Polygon ${path}: retries exhausted`);
}

/**
 * Fetch an underlying's option chain at a given as_of date (defaults to
 * latest). Pages through Polygon's next_url until we have everything for
 * the requested expiries.
 *
 * `expirations` filters the chain server-side — pass a list of dates to
 * keep the response tight. When undefined, returns ALL listed expiries
 * (can be 30+ pages for SPY).
 */
export async function fetchOptionChain(
  underlying: string,
  opts: {
    asOf?: string; // YYYY-MM-DD
    expirations?: string[]; // YYYY-MM-DD list
    limit?: number;
  } = {},
): Promise<PolygonContract[]> {
  const all: PolygonContract[] = [];
  const limit = opts.limit ?? 250;

  // Polygon only takes ONE expiration_date filter — if we want multiple,
  // we have to call once per expiry.
  const expiriesToQuery: Array<string | undefined> = opts.expirations?.length
    ? opts.expirations
    : [undefined];

  for (const exp of expiriesToQuery) {
    const qs = new URLSearchParams();
    qs.set("limit", String(limit));
    if (opts.asOf) qs.set("as_of", opts.asOf);
    if (exp) qs.set("expiration_date", exp);
    let next: string | null = `/v3/snapshot/options/${encodeURIComponent(underlying)}?${qs}`;
    let pages = 0;
    while (next && pages < 30) {
      // Pagination — Polygon returns next_url as a full URL; strip the host.
      const path = next.startsWith("http")
        ? next.replace(/^https?:\/\/api\.polygon\.io/, "")
        : next;
      const body: PolygonChainResponse = await polygonGet(path);
      if (body.results) all.push(...body.results);
      next = body.next_url ?? null;
      pages++;
    }
  }
  return all;
}

/**
 * Fetch daily underlying bars from Polygon's aggregates endpoint. Used
 * for the realized-vol calc. Returns close prices keyed by ISO date.
 */
export async function fetchUnderlyingDailyBars(
  ticker: string,
  fromDate: string,
  toDate: string,
): Promise<Map<string, number>> {
  const path = `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=50000`;
  const body: PolygonAggsResponse = await polygonGet(path);
  const out = new Map<string, number>();
  for (const r of body.results ?? []) {
    const iso = new Date(r.t).toISOString().slice(0, 10);
    out.set(iso, r.c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Surface extraction.
// ---------------------------------------------------------------------------

/** One usable surface point pulled from the chain at a given as_of. */
export interface SurfacePoint {
  /** The as_of date this snapshot is for. */
  asOf: string;
  /** Underlying price observed in the snapshot. */
  underlyingPrice: number | null;
  /** Constant-maturity 30-day ATM IV (interpolated). */
  atmIv30d: number | null;
  /** Constant-maturity 60-day ATM IV (interpolated). */
  atmIv60d: number | null;
  /** 25-delta put IV at the 30-day tenor. */
  put25dIv30d: number | null;
  /** 25-delta call IV at the 30-day tenor. */
  call25dIv30d: number | null;
  /** Diagnostic counters — number of contracts that fed each metric. */
  meta: {
    contractsScanned: number;
    listedExpiries: string[];
    atmFitNote?: string;
    skewFitNote?: string;
  };
}

/** Day-difference helper. Polygon dates are ISO YYYY-MM-DD. */
function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / (24 * 3600 * 1000));
}

/** Group contracts by expiration date. */
function groupByExpiry(
  contracts: PolygonContract[],
): Map<string, PolygonContract[]> {
  const m = new Map<string, PolygonContract[]>();
  for (const c of contracts) {
    const e = c.details?.expiration_date;
    if (!e) continue;
    const arr = m.get(e) ?? [];
    arr.push(c);
    m.set(e, arr);
  }
  return m;
}

/**
 * Find the ATM IV at one listed expiry. Defined as the average IV of the
 * call and put at the strike closest to the underlying price. Falls back
 * to whichever side has a valid IV when only one is populated.
 */
function atmIvAtExpiry(
  contracts: PolygonContract[],
  underlying: number,
): number | null {
  if (!contracts.length || !Number.isFinite(underlying)) return null;
  // Find strike closest to underlying.
  const strikes = new Set<number>();
  for (const c of contracts) strikes.add(c.details.strike_price);
  let closest = NaN;
  let bestDist = Infinity;
  for (const s of strikes) {
    const d = Math.abs(s - underlying);
    if (d < bestDist) {
      bestDist = d;
      closest = s;
    }
  }
  if (!Number.isFinite(closest)) return null;
  const atStrike = contracts.filter((c) => c.details.strike_price === closest);
  const ivs = atStrike
    .map((c) => c.implied_volatility)
    .filter((v): v is number => typeof v === "number" && v > 0);
  if (!ivs.length) return null;
  return ivs.reduce((s, v) => s + v, 0) / ivs.length;
}

/**
 * Find the IV at the contract whose delta is closest to the target
 * delta. Used for the 25Δ put and 25Δ call skew measurements.
 */
function ivAtTargetDelta(
  contracts: PolygonContract[],
  targetDelta: number,
  type: "put" | "call",
): number | null {
  const matching = contracts.filter(
    (c) =>
      c.details.contract_type === type &&
      typeof c.greeks?.delta === "number" &&
      typeof c.implied_volatility === "number" &&
      c.implied_volatility > 0,
  );
  if (!matching.length) return null;
  // Put delta is negative — compare |delta| to |target|.
  const absTarget = Math.abs(targetDelta);
  let best: PolygonContract | null = null;
  let bestDist = Infinity;
  for (const c of matching) {
    const d = Math.abs(Math.abs(c.greeks!.delta!) - absTarget);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best?.implied_volatility ?? null;
}

/** Linear interpolation between two (DTE, IV) points to a target DTE. */
function interpolateIv(
  point1: { dte: number; iv: number } | null,
  point2: { dte: number; iv: number } | null,
  targetDte: number,
): number | null {
  if (!point1 && !point2) return null;
  if (!point1) return point2!.iv;
  if (!point2) return point1.iv;
  if (point1.dte === point2.dte) return point1.iv;
  // Standard linear interpolation in vol space. For tenors this short
  // (30-60d) vol is roughly linear; full-surface implementations would
  // interpolate variance (IV²·t) instead.
  const t = (targetDte - point1.dte) / (point2.dte - point1.dte);
  return point1.iv + t * (point2.iv - point1.iv);
}

/** Find the two listed expiries that bracket a target DTE. */
function bracketingExpiries(
  expiries: string[],
  fromDate: string,
  targetDte: number,
): { before: string | null; after: string | null } {
  const withDte = expiries
    .map((e) => ({ e, dte: daysBetween(fromDate, e) }))
    .filter((x) => x.dte > 0)
    .sort((a, b) => a.dte - b.dte);
  let before: { e: string; dte: number } | null = null;
  let after: { e: string; dte: number } | null = null;
  for (const x of withDte) {
    if (x.dte <= targetDte) before = x;
    else if (x.dte > targetDte) {
      after = x;
      break;
    }
  }
  return { before: before?.e ?? null, after: after?.e ?? null };
}

/**
 * From a raw chain, extract the four constant-maturity surface points we
 * track for the anomaly scanner. Returns nulls when the chain doesn't
 * have enough data to fit (e.g. weekend snapshots, expired contracts).
 */
export function extractSurfacePoints(
  contracts: PolygonContract[],
  asOf: string,
): SurfacePoint {
  const byExpiry = groupByExpiry(contracts);
  const expiries = [...byExpiry.keys()].sort();

  // Underlying price — take the first contract's underlying_asset.
  const underlyingPrice = (() => {
    for (const c of contracts) {
      const p = c.underlying_asset?.price;
      if (typeof p === "number" && p > 0) return p;
    }
    return null;
  })();

  if (!underlyingPrice) {
    return {
      asOf,
      underlyingPrice: null,
      atmIv30d: null,
      atmIv60d: null,
      put25dIv30d: null,
      call25dIv30d: null,
      meta: {
        contractsScanned: contracts.length,
        listedExpiries: expiries,
        atmFitNote: "no underlying price found in chain",
      },
    };
  }

  // ----- 30d ATM IV via interpolation -----
  const b30 = bracketingExpiries(expiries, asOf, 30);
  const iv30Before = b30.before
    ? atmIvAtExpiry(byExpiry.get(b30.before)!, underlyingPrice)
    : null;
  const iv30After = b30.after
    ? atmIvAtExpiry(byExpiry.get(b30.after)!, underlyingPrice)
    : null;
  const atmIv30d = interpolateIv(
    b30.before && iv30Before != null
      ? { dte: daysBetween(asOf, b30.before), iv: iv30Before }
      : null,
    b30.after && iv30After != null
      ? { dte: daysBetween(asOf, b30.after), iv: iv30After }
      : null,
    30,
  );

  // ----- 60d ATM IV via interpolation -----
  const b60 = bracketingExpiries(expiries, asOf, 60);
  const iv60Before = b60.before
    ? atmIvAtExpiry(byExpiry.get(b60.before)!, underlyingPrice)
    : null;
  const iv60After = b60.after
    ? atmIvAtExpiry(byExpiry.get(b60.after)!, underlyingPrice)
    : null;
  const atmIv60d = interpolateIv(
    b60.before && iv60Before != null
      ? { dte: daysBetween(asOf, b60.before), iv: iv60Before }
      : null,
    b60.after && iv60After != null
      ? { dte: daysBetween(asOf, b60.after), iv: iv60After }
      : null,
    60,
  );

  // ----- 25Δ skew at 30 DTE -----
  // Use whichever 30-DTE-ish expiry we have most data for — favor `after`
  // since it's closer to canonical 30d and usually has more flow.
  const skewExpiry = b30.after ?? b30.before;
  const skewContracts = skewExpiry ? byExpiry.get(skewExpiry)! : [];
  const put25dIv30d = skewExpiry
    ? ivAtTargetDelta(skewContracts, 0.25, "put")
    : null;
  const call25dIv30d = skewExpiry
    ? ivAtTargetDelta(skewContracts, 0.25, "call")
    : null;

  return {
    asOf,
    underlyingPrice,
    atmIv30d,
    atmIv60d,
    put25dIv30d,
    call25dIv30d,
    meta: {
      contractsScanned: contracts.length,
      listedExpiries: expiries,
      atmFitNote: b30.before && b30.after ? "interpolated 30d" : "single-side",
      skewFitNote: skewExpiry ? `from expiry ${skewExpiry}` : "no skew expiry",
    },
  };
}

// ---------------------------------------------------------------------------
// Realized volatility from underlying daily bars.
// ---------------------------------------------------------------------------

/**
 * Annualized 30-day historical volatility computed from log returns on
 * daily close prices. Standard √252 scaling.
 *
 * `prices` should be the underlying's daily closes from at least 31
 * sessions ending on (or before) the snapshot date — the function uses
 * the most recent 31 to compute 30 log returns.
 */
export function computeHv30d(prices: number[]): number | null {
  if (prices.length < 21) return null; // need enough to be meaningful
  const window = prices.slice(-31); // most recent 31 closes → 30 returns
  const returns: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const r = Math.log(window[i] / window[i - 1]);
    if (Number.isFinite(r)) returns.push(r);
  }
  if (returns.length < 15) return null;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const dailySd = Math.sqrt(variance);
  return dailySd * Math.sqrt(252);
}

/**
 * Convenience wrapper — pull bars from Polygon + compute HV in one call.
 * `asOf` is the date the HV is "as of"; we look back 45 calendar days
 * to ensure we have ~31 trading sessions.
 */
/**
 * Fetch the current snapshot for a single option contract. Used by
 * the LEAPs mark cron to refresh historical picks' market data
 * without re-pulling the entire chain.
 *
 * Polygon path: `/v3/snapshot/options/{underlying}/{contract_ticker}`
 *
 * Returns null when the contract is unknown/expired or Polygon
 * returns no usable result. Caller skips and logs.
 */
interface PolygonContractSnapshotResponse {
  results?: PolygonContract;
}
export async function fetchContractSnapshot(
  underlying: string,
  contractTicker: string,
): Promise<PolygonContract | null> {
  try {
    const body: PolygonContractSnapshotResponse = await polygonGet(
      `/v3/snapshot/options/${encodeURIComponent(underlying)}/${encodeURIComponent(contractTicker)}`,
    );
    return body.results ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch the current value of a Polygon index ticker (e.g. "I:SPX",
 * "I:NDX", "I:VIX"). Equity option chain responses embed
 * `underlying_asset.price` on each contract; index chain responses
 * do NOT — so we hit the indices snapshot endpoint separately when
 * we need spot for a cash-settled index.
 *
 * Returns null if Polygon returns no usable value (entitlement issue,
 * stale data, etc.). Caller should skip GEX computation when null.
 */
interface PolygonIndexSnapshotResponse {
  results?: Array<{
    ticker?: string;
    value?: number;
    session?: { close?: number; previous_close?: number };
  }>;
}
export async function fetchIndexSpot(indexTicker: string): Promise<number | null> {
  const body: PolygonIndexSnapshotResponse = await polygonGet(
    `/v3/snapshot/indices?tickers=${encodeURIComponent(indexTicker)}`,
  );
  const r = body.results?.[0];
  // Prefer the live `value` field; fall back to session close (last
  // settled value) when markets are closed and `value` is stale.
  const v = r?.value ?? r?.session?.close ?? r?.session?.previous_close ?? null;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

export async function hv30dForDate(
  ticker: string,
  asOf: string,
): Promise<number | null> {
  const from = new Date(asOf);
  from.setUTCDate(from.getUTCDate() - 45);
  const bars = await fetchUnderlyingDailyBars(
    ticker,
    from.toISOString().slice(0, 10),
    asOf,
  );
  const prices = [...bars.values()];
  return computeHv30d(prices);
}

// ---------------------------------------------------------------------------
// Options trades (tape) — used by the UOA scanner.
// ---------------------------------------------------------------------------

/** One trade print from Polygon's /v3/trades/{options_ticker}. */
export interface PolygonOptionTrade {
  /** Nanoseconds since epoch — Polygon native. Convert via /1e6 for ms. */
  sip_timestamp?: number;
  participant_timestamp?: number;
  price: number;
  size: number;
  /** Condition codes — see Polygon docs. We care about 41 (intermarket
   *  sweep order). */
  conditions?: number[];
  /** Exchange ID. */
  exchange?: number;
  sequence_number?: number;
}

interface PolygonTradesResponse {
  status?: string;
  results?: PolygonOptionTrade[];
  next_url?: string;
}

/**
 * Fetch the day's option trades for one contract. Returns trades in
 * descending timestamp order (newest first), capped at `limit` per page.
 *
 * `contractTicker` is the Polygon-format OPRA symbol, e.g.
 * "O:SPY261016C00600000". The chain endpoint we already use returns
 * these in `contract.details.ticker`.
 *
 * The optional time window narrows the result — pass `tsGteNs` /
 * `tsLteNs` in NANOSECONDS (Polygon native) to pull just the last
 * intraday window for the 5-min UOA cron.
 */
export async function fetchOptionTrades(
  contractTicker: string,
  opts: {
    tsGteNs?: number; // nanoseconds since epoch
    tsLteNs?: number;
    limit?: number;
    maxPages?: number;
  } = {},
): Promise<PolygonOptionTrade[]> {
  const limit = opts.limit ?? 1000;
  const maxPages = opts.maxPages ?? 10;
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  qs.set("order", "desc");
  qs.set("sort", "timestamp");
  if (opts.tsGteNs) qs.set("timestamp.gte", String(opts.tsGteNs));
  if (opts.tsLteNs) qs.set("timestamp.lte", String(opts.tsLteNs));

  let next: string | null = `/v3/trades/${encodeURIComponent(contractTicker)}?${qs}`;
  const all: PolygonOptionTrade[] = [];
  let pages = 0;
  while (next && pages < maxPages) {
    const path = next.startsWith("http")
      ? next.replace(/^https?:\/\/api\.polygon\.io/, "")
      : next;
    const body: PolygonTradesResponse = await polygonGet(path);
    if (body.results) all.push(...body.results);
    next = body.next_url ?? null;
    pages++;
  }
  return all;
}

// ---------------------------------------------------------------------------
// UOA classification helpers.
// ---------------------------------------------------------------------------

/** Polygon condition code 41 = "Intermarket Sweep Order". A single
 *  order routed to multiple venues at once, conventionally read as
 *  urgent / institutional. The UOA scanner flags any trade carrying
 *  this condition. */
export const SWEEP_CONDITION_CODE = 41;

/** Detect whether a trade's condition array marks it as a sweep. */
export function isSweep(conditions: number[] | undefined): boolean {
  return Array.isArray(conditions) && conditions.includes(SWEEP_CONDITION_CODE);
}

/**
 * Classify a trade's aggressor side based on where the print landed
 * relative to the NBBO at trade time:
 *
 *   - price ≥ ask          → "buy"        (aggressive buyer hit the ask)
 *   - price ≤ bid          → "sell"       (aggressive seller hit the bid)
 *   - between bid and ask  → "ambiguous"  (midmarket fill, hard to call)
 *
 * Tolerates a tiny epsilon on the ask/bid touch (rounding noise).
 * Returns "ambiguous" when quotes are missing or invalid — caller can
 * choose to drop these from the UOA scan.
 */
export function classifyAggressor(
  price: number,
  bid: number | null | undefined,
  ask: number | null | undefined,
): "buy" | "sell" | "ambiguous" {
  if (!Number.isFinite(price) || price <= 0) return "ambiguous";
  if (
    bid == null || !Number.isFinite(bid) || bid <= 0 ||
    ask == null || !Number.isFinite(ask) || ask <= 0 ||
    ask < bid
  ) {
    return "ambiguous";
  }
  // 1c epsilon — fills that land within a cent of the bid/ask count as
  // a touch. Helps when the trade price is reported rounded.
  const eps = 0.01;
  if (price >= ask - eps) return "buy";
  if (price <= bid + eps) return "sell";
  return "ambiguous";
}
