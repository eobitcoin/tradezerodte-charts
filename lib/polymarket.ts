/**
 * Polymarket public Data API client.
 *
 * Endpoints used (no auth required):
 *   - https://data-api.polymarket.com/trades?limit=N&offset=M
 *
 * Data API observations (probed 2026-05-09):
 *   - 1000 trades cover ~54 seconds of activity (firehose)
 *   - Median trade ≈ $6, only ~1% are ≥ $1K
 *   - No server-side size filtering — `minSize`, `filterAmount`, etc. are
 *     silently ignored. Filter client-side.
 *   - `offset` pagination works; `limit` max appears to be 1000
 *
 * Phase 1 strategy: paginate until we either (a) reach the requested time
 * window or (b) hit a hard page cap, then filter to whale trades.
 * Persistent storage of the full trade firehose comes in Phase 2.
 */

const POLY_DATA_BASE = "https://data-api.polymarket.com";

/**
 * One trade as returned by /trades. Keys mirror the API response.
 */
export interface PolymarketTrade {
  proxyWallet: string;
  side: "BUY" | "SELL";
  asset: string;
  conditionId: string;
  /** Number of shares (each share pays $1 if outcome resolves true). */
  size: number;
  /** Implied probability in [0, 1] = price per share in USDC. */
  price: number;
  /** Unix seconds. */
  timestamp: number;
  /** Market headline. */
  title: string;
  /** Market slug — link target /event/<slug>. */
  slug: string;
  icon: string;
  /** Event slug (an event can host multiple markets). */
  eventSlug: string;
  /** Specific outcome name e.g. "Yes", "Donald Trump", etc. */
  outcome: string;
  outcomeIndex: number;
  /** Trader's display name (often address-derived). */
  name: string;
  /** Trader's auto-generated pseudonym e.g. "Happy-Go-Lucky-Min". */
  pseudonym: string;
  bio: string;
  profileImage: string;
  profileImageOptimized: string;
  transactionHash: string;
}

/**
 * USD value of the trade = size * price (size is shares, price is per-share USDC).
 */
export function tradeUsdValue(t: { size: number; price: number }): number {
  return t.size * t.price;
}

interface FetchOptions {
  /** Min USD value to keep. Default $500. */
  minUsd?: number;
  /** Stop paginating once we've passed this Unix-seconds timestamp. */
  sinceTs?: number;
  /** Hard page cap (1 page = up to 1000 trades). Default 6. */
  maxPages?: number;
  /** Stop early once we've collected this many whales. Default 200. */
  maxWhales?: number;
}

interface FetchResult {
  /** Whale trades in newest-first order. */
  trades: PolymarketTrade[];
  /** How many pages we fetched (each = up to 1000 trades). */
  pagesFetched: number;
  /** Total trades scanned (sum across pages). */
  totalScanned: number;
  /** Oldest timestamp in the scanned window. */
  oldestTs: number | null;
  /** Newest timestamp in the scanned window. */
  newestTs: number | null;
}

/**
 * Pull the recent trade firehose, paginate until we hit the time window or
 * page cap, filter to whales (size * price >= minUsd), return newest-first.
 *
 * Polymarket's API responds in ~150-300ms. Six pages at 200ms each ≈ 1.5s
 * total — acceptable for a server-rendered page.
 */
export async function fetchPolymarketWhales(opts: FetchOptions = {}): Promise<FetchResult> {
  const minUsd = opts.minUsd ?? 500;
  const sinceTs = opts.sinceTs ?? 0;
  const maxPages = Math.min(Math.max(opts.maxPages ?? 6, 1), 30);
  const maxWhales = opts.maxWhales ?? 200;

  const whales: PolymarketTrade[] = [];
  let pagesFetched = 0;
  let totalScanned = 0;
  let newestTs: number | null = null;
  let oldestTs: number | null = null;

  for (let page = 0; page < maxPages; page++) {
    const offset = page * 1000;
    const url = `${POLY_DATA_BASE}/trades?limit=1000&offset=${offset}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      // Don't cache server-side — whale watching wants fresh data.
      cache: "no-store",
    });
    if (!res.ok) {
      // Soft failure: stop pagination, return what we have.
      break;
    }
    const batch = (await res.json()) as PolymarketTrade[];
    if (!Array.isArray(batch) || batch.length === 0) break;

    pagesFetched++;
    totalScanned += batch.length;

    if (newestTs === null) newestTs = batch[0].timestamp;
    oldestTs = batch[batch.length - 1].timestamp;

    for (const t of batch) {
      if (tradeUsdValue(t) >= minUsd) whales.push(t);
    }

    // Time-window early termination — stop if oldest trade in this batch is
    // older than the requested cutoff.
    if (sinceTs > 0 && oldestTs <= sinceTs) break;
    // Whale-count early termination.
    if (whales.length >= maxWhales) break;
    // Final page (got fewer than 1000 → no more data).
    if (batch.length < 1000) break;
  }

  // Filter to time window if requested (the loop above only stops when we
  // pass the cutoff; trim individual trades that fell outside).
  const filtered =
    sinceTs > 0 ? whales.filter((t) => t.timestamp >= sinceTs) : whales;
  filtered.sort((a, b) => b.timestamp - a.timestamp);

  return {
    trades: filtered.slice(0, maxWhales),
    pagesFetched,
    totalScanned,
    oldestTs,
    newestTs,
  };
}

/** Pretty truncation for wallet addresses: 0x1234…ABCD */
export function shortWallet(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** "12s", "5m", "2h" */
export function relAge(tsSec: number, nowSec = Math.floor(Date.now() / 1000)): string {
  const diff = nowSec - tsSec;
  if (diff < 0) return "0s";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

/** Format a number as compact USD: $1.2K, $14.8K, $1.05M */
export function fmtUsdCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/** Format implied probability as a percentage. price 0.62 → "62¢" / "62%" */
export function fmtProb(p: number): string {
  if (!Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(1)}¢`;
}

// ============================================================================
// Phase 2 — wallet positions & scoring
// ============================================================================

/**
 * One position entry from /positions?user=<wallet>. Polymarket returns both
 * open (unresolved) and recently-closed positions in this endpoint. The
 * `redeemable` field flags positions where the market has resolved and the
 * wallet can claim payout — useful as a "this position is realized" marker.
 */
export interface PolymarketPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  /** Number of outcome shares held. */
  size: number;
  /** Volume-weighted average entry price ∈ [0, 1]. */
  avgPrice: number;
  /** Cost basis in USDC: size * avgPrice. */
  initialValue: number;
  /** Mark-to-market value at curPrice. */
  currentValue: number;
  /** Mark-to-market PnL in USDC. (Includes both realized + unrealized for closed positions.) */
  cashPnl: number;
  /** Same as cashPnl but as a percentage of initialValue. */
  percentPnl: number;
  /** Cumulative shares bought across all entries. */
  totalBought: number;
  /** PnL component already realized (closed positions, partial exits). */
  realizedPnl: number;
  /** realizedPnl / initialValue * 100 */
  percentRealizedPnl: number;
  /** Current mark price for this outcome. */
  curPrice: number;
  /** True when the position has resolved and is claimable. */
  redeemable: boolean;
  mergeable: boolean;
  title: string;
  slug: string;
  icon: string;
  eventId: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  oppositeOutcome: string;
  oppositeAsset: string;
  endDate: string;
  negativeRisk: boolean;
}

/**
 * Pull all positions for a wallet. Polymarket's /positions endpoint accepts
 * the `user` param as a 0x address and returns all open + recently-closed
 * positions. Empty array means the wallet has no public positions (or
 * doesn't exist).
 */
export async function fetchPolymarketPositions(wallet: string): Promise<PolymarketPosition[]> {
  const addr = wallet.trim();
  if (!addr.startsWith("0x") || addr.length !== 42) {
    throw new Error(`bad wallet address: ${wallet}`);
  }
  const url = `${POLY_DATA_BASE}/positions?user=${addr.toLowerCase()}&limit=500`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Polymarket /positions ${addr.slice(0, 8)}… HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as PolymarketPosition[];
  return Array.isArray(json) ? json : [];
}

// ============================================================================
// Phase 4 — CLOB midpoint (current orderbook price for a token)
// ============================================================================

const POLY_CLOB_BASE = "https://clob.polymarket.com";

/**
 * Batch-fetch current midpoint price for multiple token (asset) IDs.
 * Returns a Map keyed by token_id → mid (number ∈ [0, 1]). Token IDs
 * not in the response are simply absent from the Map.
 *
 * Empirically tolerates 100+ ids per call; we cap at 80 just to be safe.
 */
export async function fetchCLOBMidpoints(tokenIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (tokenIds.length === 0) return out;
  const MAX_PER_CALL = 80;
  // Dedupe.
  const unique = Array.from(new Set(tokenIds));

  for (let i = 0; i < unique.length; i += MAX_PER_CALL) {
    const batch = unique.slice(i, i + MAX_PER_CALL);
    const body = batch.map((id) => ({ token_id: id }));
    try {
      const res = await fetch(`${POLY_CLOB_BASE}/midpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (!res.ok) continue; // soft fail per batch
      const data = (await res.json()) as Record<string, string | number>;
      for (const [id, val] of Object.entries(data)) {
        const n = typeof val === "number" ? val : Number(val);
        if (Number.isFinite(n)) out.set(id, n);
      }
    } catch {
      // Ignore batch errors — caller treats absence as "no current price."
    }
  }
  return out;
}

// ============================================================================
// Phase 4 — Gamma events + category derivation
// ============================================================================

const POLY_GAMMA_BASE = "https://gamma-api.polymarket.com";

export interface GammaTag {
  id: string;
  slug: string;
  label: string;
}

export interface GammaEvent {
  slug: string;
  title: string;
  category: string | null;
  tags: GammaTag[];
}

/**
 * Top-level category buckets we surface in the UI. Order matters — first
 * match wins when an event has tags spanning multiple buckets (e.g. a
 * crypto-policy event tagged both "crypto" and "politics" → Crypto).
 */
const CATEGORY_PRIORITY: Array<{ slug: string; label: string }> = [
  { slug: "politics",   label: "Politics" },
  { slug: "crypto",     label: "Crypto" },
  { slug: "economy",    label: "Macro" },
  { slug: "business",   label: "Business" },
  { slug: "tech",       label: "Tech" },
  { slug: "science",    label: "Science" },
  { slug: "sports",     label: "Sports" },
  { slug: "pop-culture", label: "Culture" },
  { slug: "culture",    label: "Culture" },
];

/**
 * Derive a top-level category from a Gamma event's tags. Matches against
 * a fixed priority list of slugs; falls back to the lowest-numeric-id tag
 * if no top-level slug is present.
 */
export function deriveCategory(tags: GammaTag[]): string | null {
  for (const cat of CATEGORY_PRIORITY) {
    if (tags.some((t) => t.slug === cat.slug)) {
      return cat.label;
    }
  }
  if (tags.length === 0) return null;
  // Fall back to the tag with the lowest numeric id (most general).
  const sorted = [...tags].sort((a, b) => Number(a.id) - Number(b.id));
  const lowest = sorted[0];
  if (!lowest) return null;
  return lowest.label || (lowest.slug ? lowest.slug.charAt(0).toUpperCase() + lowest.slug.slice(1) : null);
}

export const KNOWN_CATEGORIES: string[] = [
  ...new Set(CATEGORY_PRIORITY.map((c) => c.label)),
];

/**
 * Batch-fetch Gamma events by slug. Gamma's `?slug=A&slug=B` syntax returns
 * an array of events, one per slug found. Caps at MAX_PER_CALL slugs per
 * request to keep the URL under 8KB.
 */
export async function fetchGammaEvents(slugs: string[]): Promise<GammaEvent[]> {
  const MAX_PER_CALL = 30;
  const out: GammaEvent[] = [];
  for (let i = 0; i < slugs.length; i += MAX_PER_CALL) {
    const batch = slugs.slice(i, i + MAX_PER_CALL);
    const params = batch.map((s) => `slug=${encodeURIComponent(s)}`).join("&");
    const url = `${POLY_GAMMA_BASE}/events?${params}&limit=${batch.length}`;
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) {
      // Soft fail — return what we have, callers handle missing slugs.
      continue;
    }
    const data = (await res.json()) as Array<Partial<GammaEvent> & { slug?: string }>;
    if (!Array.isArray(data)) continue;
    for (const e of data) {
      if (!e.slug) continue;
      out.push({
        slug: e.slug,
        title: e.title ?? "",
        category: typeof e.category === "string" ? e.category : null,
        tags: Array.isArray(e.tags) ? (e.tags as GammaTag[]) : [],
      });
    }
  }
  return out;
}

/**
 * Aggregate metrics computed from a wallet's positions list. The composite
 * score balances absolute PnL with capital efficiency (ROI), with a
 * minimum-sample guard so a wallet with one $50 lucky bet doesn't outrank
 * a wallet with consistent six-figure performance.
 */
export interface WalletScoreResult {
  realizedPnl: number;
  unrealizedPnl: number;
  /** Total cost basis across all positions = Σ initialValue. */
  capitalDeployedUsd: number;
  /** realizedPnl / capitalDeployedUsd. Null if capitalDeployedUsd <= 0. */
  roi: number | null;
  positionCount: number;
  /** Number of positions Polymarket flags as redeemable (resolved). */
  resolvedCount: number;
  /** Composite score — see scoreFromMetrics() comment for the math. */
  compositeScore: number | null;
}

/**
 * Composite score formula:
 *
 *   pnlComponent = log10(max(realizedPnl, 1) + 1) * sign(realizedPnl)
 *   roiComponent = clamp(roi * 100, -50, 50)         // cap at ±50%
 *   sampleBonus  = min(positionCount / 20, 1)        // 0..1, full at 20+ pos
 *
 *   compositeScore = (0.6 * pnlComponent + 0.4 * roiComponent / 10) * sampleBonus
 *
 * Why this shape:
 *   - log10 on absolute PnL → diminishing returns (a $100K winner shouldn't
 *     be 100x a $1K winner; more like 5x)
 *   - sign() preserves losers as negative
 *   - ROI capped at ±50% prevents one lucky 10x from dominating
 *   - sampleBonus discounts wallets with too few positions to be meaningful
 *
 * The score is dimensionless and only meaningful in relative terms — it's
 * a ranking signal, not an investable estimate.
 */
export function scoreWallet(positions: PolymarketPosition[]): WalletScoreResult {
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let capital = 0;
  let resolvedCount = 0;

  for (const p of positions) {
    if (!Number.isFinite(p.cashPnl)) continue;
    capital += Number.isFinite(p.initialValue) ? p.initialValue : 0;
    if (p.redeemable) {
      realizedPnl += p.cashPnl;
      resolvedCount += 1;
    } else {
      unrealizedPnl += p.cashPnl;
      // Closed-but-not-redeemable also has realizedPnl set; pick that up too
      if (Number.isFinite(p.realizedPnl) && p.realizedPnl !== 0) {
        realizedPnl += p.realizedPnl;
      }
    }
  }

  const positionCount = positions.length;
  const roi = capital > 0 ? realizedPnl / capital : null;

  let compositeScore: number | null = null;
  if (positionCount >= 3) {
    const pnlSign = Math.sign(realizedPnl);
    const pnlMag = Math.log10(Math.max(Math.abs(realizedPnl), 1) + 1);
    const pnlComponent = pnlSign * pnlMag;

    const roiPct = roi != null ? Math.max(-50, Math.min(50, roi * 100)) : 0;
    const roiComponent = roiPct / 10;

    const sampleBonus = Math.min(positionCount / 20, 1);

    compositeScore = (0.6 * pnlComponent + 0.4 * roiComponent) * sampleBonus;
  }

  return {
    realizedPnl,
    unrealizedPnl,
    capitalDeployedUsd: capital,
    roi,
    positionCount,
    resolvedCount,
    compositeScore,
  };
}
