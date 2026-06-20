#!/usr/bin/env node
/**
 * Backfill sector_flow_bars from the most recent N trading days so the
 * /sector Bubbles chart has real data to render before the live cron
 * starts producing fresh bars (e.g. on a weekend, or right after
 * deploy).
 *
 * Pulls every RTH (9:30 AM – 4:00 PM ET) trade + NBBO quote for each
 * ticker over the requested days, bucketizes into 5-min windows in
 * memory, classifies every trade via the same aggressor rule the live
 * cron uses, and bulk-upserts one row per (ticker, window_start).
 *
 * Throughput notes:
 *   - SPY alone is ~1M trades + ~3M quotes per day (60–80 paginated calls).
 *   - Median sector ETF is ~50k trades / ~100k quotes (1–3 pages).
 *   - Per-day total ≈ 350 polygon calls; with 250ms spacing that's
 *     ~5–7 minutes wall-clock per backfill day.
 *   - DEFAULT IS 1 DAY. Bump --days for more history but expect linear
 *     wall-clock cost.
 *
 * RTH window: hard-coded to America/New_York 9:30am–4:00pm. Handles DST
 * by deriving the UTC offset for the date via Intl.DateTimeFormat —
 * works correctly through both EST and EDT.
 *
 * Env:
 *   DATABASE_URL          required — DB connection string (use the
 *                                    Postgres service's DATABASE_PUBLIC_URL)
 *   POLYGON_API_KEY       required — Polygon Advanced key
 *   BACKFILL_DAYS         optional — trading days to backfill (default 1)
 *   BACKFILL_TICKERS      optional — comma-separated override (default = full 22-name universe)
 *   BACKFILL_PER_CALL_MS  optional — delay between polygon pages (default 200)
 *
 * Usage (example for 1 day):
 *   DATABASE_URL="postgresql://..." \
 *     POLYGON_API_KEY="..." \
 *     node scripts/backfill-sector-flow.mjs
 *
 * Usage (5 trading days):
 *   BACKFILL_DAYS=5 DATABASE_URL=... POLYGON_API_KEY=... \
 *     node scripts/backfill-sector-flow.mjs
 */

import postgres from "postgres";

// 22-name sector + index + Mag 7 universe. Kept in sync with
// lib/sector-flow.ts → SECTOR_FLOW_UNIVERSE.
const UNIVERSE = [
  "XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLB", "XLU", "XLRE", "XLC",
  "SPY", "QQQ", "IWM", "DIA",
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA",
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

const BACKFILL_DAYS = Number(process.env.BACKFILL_DAYS ?? 1);
const PER_CALL_MS = Number(process.env.BACKFILL_PER_CALL_MS ?? 200);
const TICKER_OVERRIDE = process.env.BACKFILL_TICKERS;

const TICKERS = TICKER_OVERRIDE
  ? TICKER_OVERRIDE.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
  : UNIVERSE;

const POLYGON_BASE = "https://api.polygon.io";
const NS_PER_MS = 1_000_000;
const WINDOW_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// Polygon helpers
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPaginated(initialPath, maxPages = 200) {
  let next = initialPath;
  const all = [];
  let pages = 0;
  while (next && pages < maxPages) {
    const path = next.startsWith("http")
      ? next.replace(/^https?:\/\/api\.polygon\.io/, "")
      : next;
    const body = await polygonGet(path);
    if (body.results) all.push(...body.results);
    next = body.next_url ?? null;
    pages++;
    if (next) await sleep(PER_CALL_MS);
  }
  return { results: all, pages };
}

async function fetchStockTrades(ticker, tsGteNs, tsLteNs) {
  const qs = new URLSearchParams();
  qs.set("limit", "50000");
  qs.set("order", "asc");
  qs.set("sort", "timestamp");
  qs.set("timestamp.gte", String(tsGteNs));
  qs.set("timestamp.lte", String(tsLteNs));
  return fetchPaginated(`/v3/trades/${encodeURIComponent(ticker)}?${qs}`);
}

async function fetchStockQuotes(ticker, tsGteNs, tsLteNs) {
  const qs = new URLSearchParams();
  qs.set("limit", "50000");
  qs.set("order", "asc");
  qs.set("sort", "timestamp");
  qs.set("timestamp.gte", String(tsGteNs));
  qs.set("timestamp.lte", String(tsLteNs));
  return fetchPaginated(`/v3/quotes/${encodeURIComponent(ticker)}?${qs}`);
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/**
 * Derive the UTC ms timestamp for `${dateStr}T${hh}:${mm}` in America/New_York.
 * Handles EST/EDT correctly by reading the IANA tz offset for that date.
 */
function nyTimeToUtcMs(dateStr, hh, mm) {
  // Construct a candidate UTC instant and ask Intl what NY-tz time that
  // corresponds to. The delta between the requested NY time and the
  // observed NY time tells us the offset, which we then apply.
  const naive = new Date(`${dateStr}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(naive);
  const nyHh = Number(parts.find((p) => p.type === "hour").value);
  const nyMm = Number(parts.find((p) => p.type === "minute").value);
  const offsetMin = (hh - nyHh) * 60 + (mm - nyMm);
  return naive.getTime() + offsetMin * 60_000;
}

/** Return the YYYY-MM-DD calendar dates of the last N trading days (Mon-Fri)
 *  ending at the most recent completed session. Excludes today if it's a
 *  weekday session — pulls only days where trading is fully done. Skips
 *  Sat/Sun. Does NOT skip US market holidays — Polygon returns empty arrays
 *  on those, so the script just writes nothing and moves on. */
function recentTradingDays(n) {
  const out = [];
  const now = new Date();
  // Start from yesterday so we never try to backfill a still-open session.
  const cursor = new Date(now.getTime() - 24 * 60 * 60_000);
  while (out.length < n) {
    const dow = cursor.getUTCDay(); // 0=Sun, 6=Sat (UTC ≈ NY date for our purposes)
    if (dow !== 0 && dow !== 6) {
      const y = cursor.getUTCFullYear();
      const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
      const d = String(cursor.getUTCDate()).padStart(2, "0");
      out.push(`${y}-${m}-${d}`);
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out.reverse(); // oldest → newest
}

function pickTs(t) {
  const ts = t.sip_timestamp ?? t.participant_timestamp;
  return typeof ts === "number" && ts > 0 ? ts : null;
}

// ---------------------------------------------------------------------------
// Classification + aggregation — mirrors lib/sector-flow.ts exactly.
// ---------------------------------------------------------------------------

function classifyAggressor(price, bid, ask) {
  if (!Number.isFinite(price) || price <= 0) return "ambiguous";
  if (bid == null || !Number.isFinite(bid) || bid <= 0 ||
      ask == null || !Number.isFinite(ask) || ask <= 0 || ask < bid) {
    return "ambiguous";
  }
  const eps = 0.01;
  if (price >= ask - eps) return "buy";
  if (price <= bid + eps) return "sell";
  return "ambiguous";
}

/** Walk trades + quotes for one window. */
function aggregateWindow(windowStartMs, windowEndMs, trades, quotes) {
  let buy = 0, sell = 0, ambig = 0, notional = 0, count = 0;
  let openPrice = null, closePrice = null;
  let qi = -1, curBid = null, curAsk = null;

  for (const t of trades) {
    const tsNs = pickTs(t);
    if (tsNs == null) continue;
    if (t.size <= 0 || !Number.isFinite(t.price) || t.price <= 0) continue;
    while (qi + 1 < quotes.length) {
      const nextQ = pickTs(quotes[qi + 1]);
      if (nextQ == null || nextQ > tsNs) break;
      qi++;
      const q = quotes[qi];
      curBid = typeof q.bid_price === "number" && q.bid_price > 0 ? q.bid_price : curBid;
      curAsk = typeof q.ask_price === "number" && q.ask_price > 0 ? q.ask_price : curAsk;
    }
    const side = classifyAggressor(t.price, curBid, curAsk);
    if (side === "buy") buy += t.size;
    else if (side === "sell") sell += t.size;
    else ambig += t.size;
    notional += t.price * t.size;
    count++;
    if (openPrice == null) openPrice = t.price;
    closePrice = t.price;
  }
  return {
    windowStartMs, windowEndMs,
    buy, sell, ambig, total: buy + sell + ambig,
    notional: Math.round(notional * 100) / 100,
    openPrice, closePrice, count,
  };
}

/** Bucket pre-sorted trades by window_start. Trades crossing the bucket
 *  boundary land in the bucket their timestamp falls into. */
function bucketByWindow(items, sessionStartMs, sessionEndMs) {
  const buckets = new Map();
  for (let ws = sessionStartMs; ws < sessionEndMs; ws += WINDOW_MS) {
    buckets.set(ws, []);
  }
  for (const item of items) {
    const tsNs = pickTs(item);
    if (tsNs == null) continue;
    const tsMs = tsNs / NS_PER_MS;
    if (tsMs < sessionStartMs || tsMs >= sessionEndMs) continue;
    const ws = Math.floor((tsMs - sessionStartMs) / WINDOW_MS) * WINDOW_MS + sessionStartMs;
    buckets.get(ws).push(item);
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Per-ticker backfill for one session day
// ---------------------------------------------------------------------------

async function backfillTickerDay(sql, ticker, dateStr) {
  // RTH window: 9:30 AM – 4:00 PM America/New_York.
  const sessionStartMs = nyTimeToUtcMs(dateStr, 9, 30);
  const sessionEndMs = nyTimeToUtcMs(dateStr, 16, 0);
  const tsGteNs = sessionStartMs * NS_PER_MS;
  const tsLteNs = (sessionEndMs - 1) * NS_PER_MS;

  const t0 = Date.now();
  const [tradesRes, quotesRes] = await Promise.all([
    fetchStockTrades(ticker, tsGteNs, tsLteNs),
    fetchStockQuotes(ticker, tsGteNs, tsLteNs),
  ]);
  const tFetch = Date.now() - t0;

  if (tradesRes.results.length === 0) {
    // Likely a market holiday — no trades to write. Don't error.
    return { ticker, dateStr, windows: 0, trades: 0, quotes: 0, tFetch, tWrite: 0 };
  }

  // Window-bucket both arrays, then walk per-window. Quote NBBO state
  // needs to span buckets so we maintain it across the iteration.
  const tradeBuckets = bucketByWindow(tradesRes.results, sessionStartMs, sessionEndMs);
  // Walk quotes once in order — for each window, slice the portion of
  // quotes <= windowEnd and pass that. We pass cumulative quotes so the
  // NBBO walk inside aggregateWindow sees the right state at trade time.
  // This is O(W × Q) at worst but Q is bounded per window — sufficient.
  const sortedQuotes = quotesRes.results;

  const rows = [];
  for (const [windowStartMs, trades] of tradeBuckets) {
    if (trades.length === 0) continue;
    const windowEndMs = windowStartMs + WINDOW_MS;
    // Slice quotes that fall up to the window end. (Cheaper: binary
    // search; with 60k quotes a linear scan still finishes in tens of ms.)
    const endNs = windowEndMs * NS_PER_MS;
    let cutoff = sortedQuotes.length;
    for (let i = 0; i < sortedQuotes.length; i++) {
      const qts = pickTs(sortedQuotes[i]);
      if (qts != null && qts >= endNs) { cutoff = i; break; }
    }
    const agg = aggregateWindow(windowStartMs, windowEndMs, trades, sortedQuotes.slice(0, cutoff));
    if (agg.count === 0) continue;
    rows.push(agg);
  }

  const tWriteStart = Date.now();
  for (const r of rows) {
    await sql`
      INSERT INTO sector_flow_bars (
        ticker, window_start, window_end,
        buy_volume, sell_volume, ambiguous_volume, total_volume,
        notional_usd, open_price, close_price, trade_count
      ) VALUES (
        ${ticker},
        ${new Date(r.windowStartMs).toISOString()},
        ${new Date(r.windowEndMs).toISOString()},
        ${r.buy}, ${r.sell}, ${r.ambig}, ${r.total},
        ${r.notional},
        ${r.openPrice}, ${r.closePrice}, ${r.count}
      )
      ON CONFLICT (ticker, window_start) DO UPDATE SET
        window_end = EXCLUDED.window_end,
        buy_volume = EXCLUDED.buy_volume,
        sell_volume = EXCLUDED.sell_volume,
        ambiguous_volume = EXCLUDED.ambiguous_volume,
        total_volume = EXCLUDED.total_volume,
        notional_usd = EXCLUDED.notional_usd,
        open_price = EXCLUDED.open_price,
        close_price = EXCLUDED.close_price,
        trade_count = EXCLUDED.trade_count,
        captured_at = now()
    `;
  }
  const tWrite = Date.now() - tWriteStart;

  return {
    ticker, dateStr,
    windows: rows.length,
    trades: tradesRes.results.length,
    quotes: quotesRes.results.length,
    tFetch, tWrite,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sql = postgres(DB_URL, { max: 1 });
  const days = recentTradingDays(BACKFILL_DAYS);

  console.log(`Sector Flow backfill`);
  console.log(`  Tickers: ${TICKERS.length} (${TICKERS.join(", ")})`);
  console.log(`  Days:    ${days.length} (${days.join(", ")})`);
  console.log("");

  let totalRows = 0;
  let totalErr = 0;

  for (const dateStr of days) {
    console.log(`=== ${dateStr} ===`);
    for (const ticker of TICKERS) {
      try {
        const r = await backfillTickerDay(sql, ticker, dateStr);
        totalRows += r.windows;
        console.log(
          `  ${ticker.padEnd(5)}  windows=${String(r.windows).padStart(3)}  ` +
          `trades=${String(r.trades).padStart(7)}  quotes=${String(r.quotes).padStart(7)}  ` +
          `fetch=${(r.tFetch / 1000).toFixed(1)}s  write=${(r.tWrite / 1000).toFixed(1)}s`,
        );
      } catch (err) {
        totalErr++;
        console.error(`  ${ticker.padEnd(5)}  ERROR: ${err.message ?? err}`);
      }
    }
    console.log("");
  }

  console.log(`Done. Wrote ${totalRows} window rows across ${days.length} day(s). ${totalErr} ticker-day errors.`);
  await sql.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
