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

async function polygonGet<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${POLYGON_BASE}${path}${sep}apiKey=${apiKey()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Polygon ${path} → HTTP ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
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
