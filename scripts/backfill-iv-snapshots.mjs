#!/usr/bin/env node
/**
 * 12-month backfill of IV surface snapshots for the Options Edge scanner.
 *
 * For each ticker in WATCHLIST × each business day in the past N days
 * (default 252 trading sessions ≈ 1 year):
 *   1. Fetch full option chain at that as_of date from Polygon
 *   2. Extract constant-maturity surface points (30d/60d ATM IV, 25Δ skew)
 *   3. Compute realized HV from underlying daily bars
 *   4. UPSERT into iv_snapshots by (ticker, snapshot_date)
 *
 * Runs in concurrent ticker workers (default 3) with a per-call delay so
 * we don't hammer Polygon. Idempotent — re-running fills in any gaps,
 * existing rows update meta but keep their original values stable.
 *
 * Env:
 *   DATABASE_URL          required — DB connection string
 *   POLYGON_API_KEY       required — Polygon Advanced key
 *   BACKFILL_DAYS         optional — sessions to backfill (default 252)
 *   BACKFILL_CONCURRENCY  optional — tickers in parallel (default 3)
 *   BACKFILL_TICKERS      optional — comma-separated; defaults to full watchlist
 *   BACKFILL_PER_CALL_MS  optional — delay between chain fetches (default 200)
 *
 * Usage:
 *   DATABASE_URL=... POLYGON_API_KEY=... node scripts/backfill-iv-snapshots.mjs
 */

import postgres from "postgres";

// The 25-name Options Edge watchlist. Kept in sync with the routine prompt.
const WATCHLIST = [
  // Indexes
  "SPY", "QQQ", "IWM",
  // Mega-cap tech
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA",
  // Semis
  "AMD", "INTC", "MU", "AVGO", "MRVL",
  // High-IV / retail favorites
  "COIN", "MSTR", "GME", "PLTR", "NFLX",
  // Bank + bonds + commodities + sector ETFs
  "BAC", "TLT", "GLD", "XLE", "XLF",
];

const DB_URL = process.env.DATABASE_URL;
const POLYGON_KEY = process.env.POLYGON_API_KEY;
if (!DB_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
if (!POLYGON_KEY) {
  console.error("POLYGON_API_KEY is required.");
  process.exit(1);
}

const BACKFILL_DAYS = Number(process.env.BACKFILL_DAYS ?? 252);
const CONCURRENCY = Number(process.env.BACKFILL_CONCURRENCY ?? 3);
const PER_CALL_MS = Number(process.env.BACKFILL_PER_CALL_MS ?? 200);
const TICKER_OVERRIDE = process.env.BACKFILL_TICKERS;

const TICKERS = TICKER_OVERRIDE
  ? TICKER_OVERRIDE.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
  : WATCHLIST;

const POLYGON_BASE = "https://api.polygon.io";

// ---------------------------------------------------------------------------
// Lightweight inline copy of the surface extractor — keeps this script
// runnable without TS compilation. Mirrors lib/polygon.ts logic exactly.
// ---------------------------------------------------------------------------

async function polygonGet(path) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${POLYGON_BASE}${path}${sep}apiKey=${POLYGON_KEY}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Polygon ${path} → HTTP ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  return await res.json();
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchOptionChain(underlying, asOf) {
  const all = [];
  const qs = new URLSearchParams();
  qs.set("limit", "250");
  if (asOf) qs.set("as_of", asOf);
  let next = `/v3/snapshot/options/${encodeURIComponent(underlying)}?${qs}`;
  let pages = 0;
  while (next && pages < 30) {
    const path = next.startsWith("http")
      ? next.replace(/^https?:\/\/api\.polygon\.io/, "")
      : next;
    const body = await polygonGet(path);
    if (body.results) all.push(...body.results);
    next = body.next_url ?? null;
    pages++;
    if (next) await sleep(PER_CALL_MS);
  }
  return all;
}

function daysBetween(from, to) {
  return Math.round(
    (new Date(to + "T00:00:00Z") - new Date(from + "T00:00:00Z")) /
      (24 * 3600 * 1000),
  );
}

function groupByExpiry(contracts) {
  const m = new Map();
  for (const c of contracts) {
    const e = c.details?.expiration_date;
    if (!e) continue;
    const arr = m.get(e) ?? [];
    arr.push(c);
    m.set(e, arr);
  }
  return m;
}

function atmIvAtExpiry(contracts, underlying) {
  if (!contracts.length || !Number.isFinite(underlying)) return null;
  const strikes = new Set(contracts.map((c) => c.details.strike_price));
  let closest = NaN, bestDist = Infinity;
  for (const s of strikes) {
    const d = Math.abs(s - underlying);
    if (d < bestDist) { bestDist = d; closest = s; }
  }
  if (!Number.isFinite(closest)) return null;
  const ivs = contracts
    .filter((c) => c.details.strike_price === closest)
    .map((c) => c.implied_volatility)
    .filter((v) => typeof v === "number" && v > 0);
  if (!ivs.length) return null;
  return ivs.reduce((s, v) => s + v, 0) / ivs.length;
}

function ivAtTargetDelta(contracts, targetDelta, type) {
  const matching = contracts.filter(
    (c) =>
      c.details.contract_type === type &&
      typeof c.greeks?.delta === "number" &&
      typeof c.implied_volatility === "number" &&
      c.implied_volatility > 0,
  );
  if (!matching.length) return null;
  const absTarget = Math.abs(targetDelta);
  let best = null, bestDist = Infinity;
  for (const c of matching) {
    const d = Math.abs(Math.abs(c.greeks.delta) - absTarget);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best?.implied_volatility ?? null;
}

function interpolateIv(p1, p2, target) {
  if (!p1 && !p2) return null;
  if (!p1) return p2.iv;
  if (!p2) return p1.iv;
  if (p1.dte === p2.dte) return p1.iv;
  const t = (target - p1.dte) / (p2.dte - p1.dte);
  return p1.iv + t * (p2.iv - p1.iv);
}

function bracketingExpiries(expiries, asOf, target) {
  const withDte = expiries
    .map((e) => ({ e, dte: daysBetween(asOf, e) }))
    .filter((x) => x.dte > 0)
    .sort((a, b) => a.dte - b.dte);
  let before = null, after = null;
  for (const x of withDte) {
    if (x.dte <= target) before = x;
    else if (x.dte > target) { after = x; break; }
  }
  return { before: before?.e ?? null, after: after?.e ?? null };
}

function extractSurfacePoints(contracts, asOf) {
  const byExpiry = groupByExpiry(contracts);
  const expiries = [...byExpiry.keys()].sort();
  const underlying = (() => {
    for (const c of contracts) {
      const p = c.underlying_asset?.price;
      if (typeof p === "number" && p > 0) return p;
    }
    return null;
  })();
  if (!underlying) {
    return { asOf, underlyingPrice: null, atmIv30d: null, atmIv60d: null, put25dIv30d: null, call25dIv30d: null, meta: { contractsScanned: contracts.length, listedExpiries: expiries, atmFitNote: "no underlying" } };
  }
  const b30 = bracketingExpiries(expiries, asOf, 30);
  const iv30b = b30.before ? atmIvAtExpiry(byExpiry.get(b30.before), underlying) : null;
  const iv30a = b30.after ? atmIvAtExpiry(byExpiry.get(b30.after), underlying) : null;
  const atmIv30d = interpolateIv(
    b30.before && iv30b != null ? { dte: daysBetween(asOf, b30.before), iv: iv30b } : null,
    b30.after && iv30a != null ? { dte: daysBetween(asOf, b30.after), iv: iv30a } : null,
    30,
  );
  const b60 = bracketingExpiries(expiries, asOf, 60);
  const iv60b = b60.before ? atmIvAtExpiry(byExpiry.get(b60.before), underlying) : null;
  const iv60a = b60.after ? atmIvAtExpiry(byExpiry.get(b60.after), underlying) : null;
  const atmIv60d = interpolateIv(
    b60.before && iv60b != null ? { dte: daysBetween(asOf, b60.before), iv: iv60b } : null,
    b60.after && iv60a != null ? { dte: daysBetween(asOf, b60.after), iv: iv60a } : null,
    60,
  );
  const skewExpiry = b30.after ?? b30.before;
  const skewContracts = skewExpiry ? byExpiry.get(skewExpiry) : [];
  const put25dIv30d = skewExpiry ? ivAtTargetDelta(skewContracts, 0.25, "put") : null;
  const call25dIv30d = skewExpiry ? ivAtTargetDelta(skewContracts, 0.25, "call") : null;
  return {
    asOf,
    underlyingPrice: underlying,
    atmIv30d,
    atmIv60d,
    put25dIv30d,
    call25dIv30d,
    meta: {
      contractsScanned: contracts.length,
      listedExpiries: expiries.length,
      atmFitNote: b30.before && b30.after ? "interpolated 30d" : "single-side",
      skewExpiry: skewExpiry ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Underlying bars + HV (pulls a single ticker's full range once, slices
// per as_of date so we only hit Polygon's aggregates endpoint once per
// ticker instead of once per date).
// ---------------------------------------------------------------------------

async function fetchDailyBarsRange(ticker, fromDate, toDate) {
  const path = `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=50000`;
  const body = await polygonGet(path);
  const out = new Map();
  for (const r of body.results ?? []) {
    const iso = new Date(r.t).toISOString().slice(0, 10);
    out.set(iso, r.c);
  }
  return out;
}

function hv30dFromCloses(closesUpThroughAsOf) {
  // Take the last 31 closes (oldest → newest). Need ~30 returns.
  const window = closesUpThroughAsOf.slice(-31);
  if (window.length < 21) return null;
  const returns = [];
  for (let i = 1; i < window.length; i++) {
    const r = Math.log(window[i] / window[i - 1]);
    if (Number.isFinite(r)) returns.push(r);
  }
  if (returns.length < 15) return null;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

// ---------------------------------------------------------------------------
// Trading-day calendar — naive Mon-Fri (skips US holidays imperfectly but
// is good enough for IV snapshot dates; we filter by what Polygon
// actually returns).
// ---------------------------------------------------------------------------

function tradingDaysBack(days) {
  const out = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  let added = 0;
  while (added < days) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      out.push(cursor.toISOString().slice(0, 10));
      added++;
    }
  }
  // oldest first (we iterate forward in history)
  return out.reverse();
}

// ---------------------------------------------------------------------------
// Worker — backfills one ticker.
// ---------------------------------------------------------------------------

async function backfillTicker(sql, ticker, dates) {
  console.log(`[${ticker}] starting (${dates.length} dates)`);
  // Pull all underlying daily closes for the full backfill window once.
  // We need ~45 days of lookback before the earliest as_of for the HV calc.
  const earliest = new Date(dates[0]);
  earliest.setUTCDate(earliest.getUTCDate() - 45);
  const fromDate = earliest.toISOString().slice(0, 10);
  const toDate = dates[dates.length - 1];
  let allCloses;
  try {
    allCloses = await fetchDailyBarsRange(ticker, fromDate, toDate);
  } catch (err) {
    console.error(`[${ticker}] aggs fetch failed: ${err.message}`);
    return { ticker, written: 0, failed: dates.length };
  }
  const sortedDates = [...allCloses.keys()].sort();

  let written = 0, failed = 0, skipped = 0;
  for (const asOf of dates) {
    // Check if we already have a row for this date.
    const existing = await sql`
      SELECT id FROM iv_snapshots
      WHERE ticker = ${ticker} AND snapshot_date = ${asOf}
      LIMIT 1
    `;
    if (existing.length > 0) { skipped++; continue; }

    let surface;
    try {
      const chain = await fetchOptionChain(ticker, asOf);
      surface = extractSurfacePoints(chain, asOf);
    } catch (err) {
      console.error(`[${ticker}] ${asOf} chain fetch failed: ${err.message}`);
      failed++;
      await sleep(PER_CALL_MS * 3);
      continue;
    }

    // Compute HV from closes up through this as_of date.
    const closesThrough = sortedDates
      .filter((d) => d <= asOf)
      .map((d) => allCloses.get(d));
    const hv = hv30dFromCloses(closesThrough);

    try {
      await sql`
        INSERT INTO iv_snapshots (
          ticker, snapshot_date, underlying_price,
          atm_iv_30d, atm_iv_60d,
          put_25d_iv_30d, call_25d_iv_30d,
          hv_30d, meta
        ) VALUES (
          ${ticker}, ${asOf}, ${surface.underlyingPrice},
          ${surface.atmIv30d}, ${surface.atmIv60d},
          ${surface.put25dIv30d}, ${surface.call25dIv30d},
          ${hv}, ${sql.json(surface.meta)}
        )
        ON CONFLICT (ticker, snapshot_date) DO UPDATE SET
          underlying_price = EXCLUDED.underlying_price,
          atm_iv_30d = EXCLUDED.atm_iv_30d,
          atm_iv_60d = EXCLUDED.atm_iv_60d,
          put_25d_iv_30d = EXCLUDED.put_25d_iv_30d,
          call_25d_iv_30d = EXCLUDED.call_25d_iv_30d,
          hv_30d = EXCLUDED.hv_30d,
          meta = EXCLUDED.meta
      `;
      written++;
    } catch (err) {
      console.error(`[${ticker}] ${asOf} insert failed: ${err.message}`);
      failed++;
    }
    if (written % 25 === 0 && written > 0) {
      console.log(`[${ticker}] ${written}/${dates.length} done`);
    }
    await sleep(PER_CALL_MS);
  }
  console.log(`[${ticker}] DONE — written:${written} skipped:${skipped} failed:${failed}`);
  return { ticker, written, failed, skipped };
}

// ---------------------------------------------------------------------------
// Driver.
// ---------------------------------------------------------------------------

async function runWithConcurrency(items, n, worker) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: n }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      try {
        const r = await worker(item, idx);
        results.push(r);
      } catch (err) {
        console.error(`Worker failed on ${item}: ${err.message}`);
        results.push({ ticker: item, written: 0, failed: -1 });
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log(`Options Edge backfill — ${TICKERS.length} tickers × ${BACKFILL_DAYS} days`);
  console.log(`Tickers: ${TICKERS.join(", ")}`);
  console.log(`Concurrency: ${CONCURRENCY}, per-call delay: ${PER_CALL_MS}ms\n`);

  const sql = postgres(DB_URL, { ssl: "require", max: CONCURRENCY + 2 });
  const dates = tradingDaysBack(BACKFILL_DAYS);
  console.log(`Date range: ${dates[0]} → ${dates[dates.length - 1]}\n`);

  const t0 = Date.now();
  const results = await runWithConcurrency(TICKERS, CONCURRENCY, (ticker) =>
    backfillTicker(sql, ticker, dates),
  );
  const elapsedMin = ((Date.now() - t0) / 60000).toFixed(1);

  console.log("\n=== SUMMARY ===");
  console.table(results);
  const total = results.reduce(
    (acc, r) => ({
      written: acc.written + (r.written || 0),
      failed: acc.failed + (r.failed || 0),
      skipped: acc.skipped + (r.skipped || 0),
    }),
    { written: 0, failed: 0, skipped: 0 },
  );
  console.log(`Total: ${total.written} written, ${total.skipped} skipped, ${total.failed} failed in ${elapsedMin} min`);

  await sql.end();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
