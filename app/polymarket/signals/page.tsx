import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fetchCLOBMidpoints } from "@/lib/polymarket";
import SiteHeader from "@/components/SiteHeader";
import PolymarketTabs from "@/components/PolymarketTabs";
import PolymarketConvergenceTable, {
  type ConvergenceSignal,
  type ConvergenceWalletRef,
} from "@/components/PolymarketConvergenceTable";
import PolymarketSoloSignalsTable, {
  type SoloSignal,
} from "@/components/PolymarketSoloSignalsTable";

export const dynamic = "force-dynamic";

const WINDOWS: Record<string, { hours: number; label: string }> = {
  "6h":  { hours: 6,   label: "6h" },
  "24h": { hours: 24,  label: "24h" },
  "7d":  { hours: 168, label: "7d" },
};

function parseWindow(raw: string | undefined): keyof typeof WINDOWS {
  if (raw && raw in WINDOWS) return raw as keyof typeof WINDOWS;
  return "24h";
}

function parseCategory(raw: string | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed && trimmed !== "all" ? trimmed : null;
}

function pillCls(active: boolean): string {
  return active
    ? "px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40"
    : "px-2.5 py-1 text-xs font-medium rounded-full border border-black/15 dark:border-white/15 text-black/60 dark:text-white/60 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]";
}

interface ConvergenceRow {
  condition_id: string;
  title: string | null;
  slug: string | null;
  event_slug: string | null;
  asset: string | null;
  category: string | null;
  outcome: string | null;
  outcome_index: number | null;
  side: "BUY" | "SELL";
  wallet_count: string;
  total_usd: string;
  avg_price: string;
  first_entry_ts: string | Date;
  last_entry_ts: string | Date;
  // PostgreSQL array_agg returns these as JSON strings or arrays depending on driver.
  wallet_addresses: string[] | string;
  wallet_pseudonyms: (string | null)[] | string;
  wallet_scores: (string | null)[] | string;
  wallet_usds: string[] | string;
  wallet_prices: string[] | string;
}

interface SoloRow {
  transaction_hash: string;
  asset: string;
  wallet: string;
  pseudonym: string | null;
  composite_score: string | null;
  condition_id: string;
  title: string | null;
  slug: string | null;
  event_slug: string | null;
  category: string | null;
  outcome: string | null;
  side: "BUY" | "SELL";
  size: string;
  price: string;
  usd_value: string;
  timestamp: string | Date;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseArr<T>(v: T[] | string | null | undefined): T[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

const CONVERGENCE_MIN_SCORE = 0.5;
const SOLO_MIN_SCORE = 1.0;
const SOLO_MIN_USD = 1000;

export default async function PolymarketSignalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const windowKey = parseWindow(typeof sp.window === "string" ? sp.window : undefined);
  const category = parseCategory(typeof sp.cat === "string" ? sp.cat : undefined);
  const w = WINDOWS[windowKey];
  const cutoffSql = sql.raw(`now() - interval '${w.hours} hours'`);

  // Build a category filter clause we splice into both queries via sql.raw.
  const categoryFilter = category
    ? sql`AND COALESCE(e.category, '__none__') = ${category}`
    : sql``;

  // Distinct categories present in our events table — for the filter UI.
  // ORDER BY references the underlying COUNT(*) (not the text-cast alias)
  // because Postgres can't apply ::int back to a text-cast aliased column.
  const catRowsRaw = await db.execute(sql`
    SELECT category, COUNT(*)::text AS n
    FROM polymarket_events
    WHERE category IS NOT NULL
    GROUP BY category
    ORDER BY COUNT(*) DESC
  `);
  const categories = ([...catRowsRaw] as Array<{ category: string; n: string }>).map(
    (r) => ({ label: r.category, count: Number(r.n) }),
  );

  // -- CONVERGENCE: ≥2 top-scored wallets entering the same market+side, last N hours.
  // Latest score per wallet via DISTINCT ON, then JOIN trades.
  const convergenceResult = await db.execute(sql`
    WITH latest_scores AS (
      SELECT DISTINCT ON (wallet)
        wallet, composite_score, scored_at
      FROM polymarket_wallet_scores
      ORDER BY wallet, scored_at DESC
    ),
    top_wallets AS (
      SELECT w.address, w.pseudonym, ls.composite_score
      FROM polymarket_wallets w
      JOIN latest_scores ls ON ls.wallet = w.address
      WHERE ls.composite_score >= ${CONVERGENCE_MIN_SCORE}
    ),
    convergent_trades AS (
      SELECT
        t.condition_id,
        t.outcome,
        t.outcome_index,
        t.side,
        MIN(t.title) AS title,
        MIN(t.slug) AS slug,
        MIN(t.event_slug) AS event_slug,
        MIN(t.asset) AS asset,
        MIN(e.category) AS category,
        COUNT(DISTINCT t.wallet)::text AS wallet_count,
        SUM(t.usd_value)::text AS total_usd,
        AVG(t.price)::text AS avg_price,
        MIN(t.timestamp) AS first_entry_ts,
        MAX(t.timestamp) AS last_entry_ts,
        array_agg(t.wallet ORDER BY t.usd_value DESC) AS wallet_addresses,
        array_agg(tw.pseudonym ORDER BY t.usd_value DESC) AS wallet_pseudonyms,
        array_agg(tw.composite_score::text ORDER BY t.usd_value DESC) AS wallet_scores,
        array_agg(t.usd_value::text ORDER BY t.usd_value DESC) AS wallet_usds,
        array_agg(t.price::text ORDER BY t.usd_value DESC) AS wallet_prices
      FROM polymarket_trades t
      JOIN top_wallets tw ON tw.address = t.wallet
      LEFT JOIN polymarket_events e ON e.event_slug = t.event_slug
      WHERE t.timestamp > ${cutoffSql}
        AND t.side = 'BUY'
        ${categoryFilter}
      GROUP BY t.condition_id, t.outcome, t.outcome_index, t.side
      HAVING COUNT(DISTINCT t.wallet) >= 2
    )
    SELECT * FROM convergent_trades
    ORDER BY total_usd::numeric DESC
    LIMIT 30
  `);
  const convRowsRaw = [...convergenceResult] as unknown as ConvergenceRow[];

  const convergenceSignals: ConvergenceSignal[] = convRowsRaw.map((r) => {
    const addresses = parseArr<string>(r.wallet_addresses);
    const pseudonyms = parseArr<string | null>(r.wallet_pseudonyms);
    const scores = parseArr<string | null>(r.wallet_scores);
    const usds = parseArr<string>(r.wallet_usds);
    const prices = parseArr<string>(r.wallet_prices);
    const wallets: ConvergenceWalletRef[] = addresses.map((addr, i) => ({
      address: addr,
      pseudonym: pseudonyms[i] ?? null,
      compositeScore: scores[i] != null ? Number(scores[i]) : null,
      usdValue: Number(usds[i] ?? 0),
      price: Number(prices[i] ?? 0),
    }));
    return {
      conditionId: r.condition_id,
      title: r.title,
      slug: r.slug,
      eventSlug: r.event_slug,
      category: r.category,
      outcome: r.outcome,
      outcomeIndex: r.outcome_index,
      side: r.side,
      walletCount: Number(r.wallet_count),
      totalUsd: Number(r.total_usd),
      avgPrice: Number(r.avg_price),
      firstEntryTs: toDate(r.first_entry_ts) ?? new Date(),
      lastEntryTs: toDate(r.last_entry_ts) ?? new Date(),
      wallets,
      // Asset id is needed for the CLOB midpoint lookup but the type
      // doesn't expose it; we attach via a sidecar Map below.
      currentPrice: null,
    };
  });

  // Sidecar: condition_id+side → asset (for CLOB lookup) coming from query.
  const convAssets = new Map<string, string>();
  for (const r of convRowsRaw) {
    if (r.asset) {
      convAssets.set(`${r.condition_id}|${r.outcome_index}|${r.side}`, r.asset);
    }
  }

  // -- SOLO: high-scorer × big bet in last N hours.
  const soloResult = await db.execute(sql`
    WITH latest_scores AS (
      SELECT DISTINCT ON (wallet)
        wallet, composite_score, scored_at
      FROM polymarket_wallet_scores
      ORDER BY wallet, scored_at DESC
    )
    SELECT
      t.transaction_hash, t.asset,
      t.wallet,
      w.pseudonym,
      ls.composite_score::text AS composite_score,
      t.condition_id, t.title, t.slug, t.event_slug,
      e.category AS category,
      t.outcome, t.side,
      t.size::text AS size,
      t.price::text AS price,
      t.usd_value::text AS usd_value,
      t.timestamp
    FROM polymarket_trades t
    JOIN polymarket_wallets w ON w.address = t.wallet
    JOIN latest_scores ls ON ls.wallet = t.wallet
    LEFT JOIN polymarket_events e ON e.event_slug = t.event_slug
    WHERE t.timestamp > ${cutoffSql}
      AND t.side = 'BUY'
      AND t.usd_value >= ${SOLO_MIN_USD}
      AND ls.composite_score >= ${SOLO_MIN_SCORE}
      ${categoryFilter}
    ORDER BY (ls.composite_score * t.usd_value) DESC
    LIMIT 50
  `);
  const soloRowsRaw = [...soloResult] as unknown as SoloRow[];
  const soloSignals: SoloSignal[] = soloRowsRaw.map((r) => ({
    transactionHash: r.transaction_hash,
    asset: r.asset,
    wallet: r.wallet,
    pseudonym: r.pseudonym,
    compositeScore: r.composite_score != null ? Number(r.composite_score) : null,
    conditionId: r.condition_id,
    title: r.title,
    slug: r.slug,
    eventSlug: r.event_slug,
    category: r.category,
    outcome: r.outcome,
    side: r.side,
    size: Number(r.size),
    price: Number(r.price),
    usdValue: Number(r.usd_value),
    timestamp: toDate(r.timestamp) ?? new Date(),
    currentPrice: null,
  }));

  // Batch-fetch CLOB midpoints for every distinct asset across both signal sets.
  const allAssets = [
    ...Array.from(convAssets.values()),
    ...soloSignals.map((s) => s.asset),
  ];
  if (allAssets.length > 0) {
    const midpoints = await fetchCLOBMidpoints(allAssets);
    for (const sig of convergenceSignals) {
      const key = `${sig.conditionId}|${sig.outcomeIndex}|${sig.side}`;
      const asset = convAssets.get(key);
      if (asset) {
        const mid = midpoints.get(asset);
        if (mid != null) sig.currentPrice = mid;
      }
    }
    for (const sig of soloSignals) {
      const mid = midpoints.get(sig.asset);
      if (mid != null) sig.currentPrice = mid;
    }
  }

  // Stats for the header.
  const statsRes = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM polymarket_trades WHERE timestamp > ${cutoffSql})::text AS trades_in_window,
      (SELECT COUNT(*) FROM polymarket_trades)::text AS trades_total
  `);
  const stats = ([...statsRes] as unknown as Array<{
    trades_in_window: string;
    trades_total: string;
  }>)[0];
  const tradesInWindow = Number(stats?.trades_in_window ?? 0);
  const tradesTotal = Number(stats?.trades_total ?? 0);

  const nowSec = Math.floor(Date.now() / 1000);

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Polymarket</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Tradable signals from the top-wallet roster. Convergence (multiple top wallets entering
            the same side) on top, fresh single-wallet whale buys below.
          </p>
        </header>
        <PolymarketTabs active="signals" />

        <div className="flex items-baseline gap-x-6 gap-y-3 flex-wrap">
          <div className="flex items-baseline gap-2">
            <span className="text-xs uppercase tracking-wide text-black/55 dark:text-white/55">
              Window
            </span>
            {(Object.keys(WINDOWS) as Array<keyof typeof WINDOWS>).map((key) => (
              <Link
                key={key}
                href={`/polymarket/signals?window=${key}${category ? `&cat=${encodeURIComponent(category)}` : ""}`}
                className={pillCls(key === windowKey)}
              >
                {WINDOWS[key].label}
              </Link>
            ))}
          </div>
          {categories.length > 0 && (
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-xs uppercase tracking-wide text-black/55 dark:text-white/55">
                Category
              </span>
              <Link
                href={`/polymarket/signals?window=${windowKey}`}
                className={pillCls(category === null)}
              >
                All
              </Link>
              {categories.map((c) => (
                <Link
                  key={c.label}
                  href={`/polymarket/signals?window=${windowKey}&cat=${encodeURIComponent(c.label)}`}
                  className={pillCls(c.label === category)}
                  title={`${c.count} cached events in this category`}
                >
                  {c.label}
                </Link>
              ))}
            </div>
          )}
          <span className="text-xs text-black/40 dark:text-white/40 ml-auto">
            {tradesInWindow.toLocaleString()} whale trades in last {w.label} ·{" "}
            {tradesTotal.toLocaleString()} total persisted
          </span>
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide flex items-baseline gap-2">
            Convergence
            <span className="text-xs font-normal text-black/55 dark:text-white/55">
              ≥2 top wallets (score ≥ {CONVERGENCE_MIN_SCORE}), same market + side, last {w.label}
            </span>
          </h2>
          <PolymarketConvergenceTable
            signals={convergenceSignals}
            nowSec={nowSec}
            windowLabel={w.label}
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide flex items-baseline gap-2">
            Top-Wallet Buys
            <span className="text-xs font-normal text-black/55 dark:text-white/55">
              wallets with score ≥ {SOLO_MIN_SCORE}, BUY size ≥ ${SOLO_MIN_USD.toLocaleString()},
              last {w.label} · ranked by score × size
            </span>
          </h2>
          <PolymarketSoloSignalsTable
            signals={soloSignals}
            nowSec={nowSec}
            windowLabel={w.label}
          />
        </section>

        <div className="text-xs text-black/55 dark:text-white/55 leading-relaxed max-w-3xl space-y-1">
          <p>
            <strong>How signals are computed:</strong> persisted whale trades (≥ $500) JOIN the
            latest composite score per wallet, filtered to BUYs in the chosen window. Convergence
            groups by (market, outcome, side) and keeps groups with ≥ 2 distinct top wallets.
          </p>
          <p>
            <strong>Caveat:</strong> a fresh trade from a high-scorer is a signal of <em>their</em>{" "}
            conviction, not of guaranteed edge — and the price has often already moved past their
            entry. Click through to Polymarket for current midpoint before sizing.
          </p>
          <p>
            <strong>Coming in Phase 4:</strong> per-wallet detail page, category filter
            (Politics/Sports/Crypto), &quot;has price moved past entry&quot; column from CLOB
            midpoint, push notifications when convergence fires.
          </p>
        </div>
      </div>
    </>
  );
}
