import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { polymarketWallets } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import PolymarketTabs from "@/components/PolymarketTabs";
import PolymarketWalletLeaderboard, {
  type LeaderboardRow,
} from "@/components/PolymarketWalletLeaderboard";

export const dynamic = "force-dynamic";

interface RawRow {
  address: string;
  pseudonym: string | null;
  display_name: string | null;
  total_volume_usd: string;
  whale_trades_seen: number;
  last_seen: string | Date;
  realized_pnl: string | null;
  unrealized_pnl: string | null;
  capital_deployed_usd: string | null;
  roi: string | null;
  position_count: number | null;
  composite_score: string | null;
  scored_at: string | Date | null;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNumber(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default async function PolymarketWalletsPage() {
  // DISTINCT ON pulls latest score per wallet, joined to wallet metadata.
  // Wallets without any score row are excluded from the ranking.
  const result = await db.execute(sql`
    SELECT DISTINCT ON (w.address)
      w.address,
      w.pseudonym,
      w.display_name,
      w.total_volume_usd::text AS total_volume_usd,
      w.whale_trades_seen,
      w.last_seen,
      s.realized_pnl::text AS realized_pnl,
      s.unrealized_pnl::text AS unrealized_pnl,
      s.capital_deployed_usd::text AS capital_deployed_usd,
      s.roi::text AS roi,
      s.position_count,
      s.composite_score::text AS composite_score,
      s.scored_at
    FROM polymarket_wallets w
    INNER JOIN polymarket_wallet_scores s ON s.wallet = w.address
    WHERE s.composite_score IS NOT NULL
    ORDER BY w.address, s.scored_at DESC
  `);
  const allRowsRaw = [...result] as unknown as RawRow[];

  // Sort by composite score desc and take top 100.
  const rows: LeaderboardRow[] = allRowsRaw
    .map((r) => ({
      address: r.address,
      pseudonym: r.pseudonym,
      displayName: r.display_name,
      realizedPnl: toNumber(r.realized_pnl),
      unrealizedPnl: toNumber(r.unrealized_pnl),
      capitalDeployedUsd: toNumber(r.capital_deployed_usd),
      roi: toNumber(r.roi),
      positionCount: r.position_count ?? 0,
      compositeScore: toNumber(r.composite_score),
      scoredAt: toDate(r.scored_at),
      totalVolumeUsd: Number(r.total_volume_usd) || 0,
      whaleTradesSeen: r.whale_trades_seen,
      lastSeen: toDate(r.last_seen) ?? new Date(),
    }))
    .sort((a, b) => (b.compositeScore ?? -Infinity) - (a.compositeScore ?? -Infinity))
    .slice(0, 100);

  // Population stats for the header.
  const stats = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM polymarket_wallets)::text AS total_wallets,
      (SELECT COUNT(*) FROM polymarket_wallets WHERE last_scored_at IS NOT NULL)::text AS scored_wallets
  `);
  const sRow = ([...stats] as unknown as Array<{ total_wallets: string; scored_wallets: string }>)[0];
  const totalWallets = Number(sRow?.total_wallets ?? 0);
  const scoredCount = Number(sRow?.scored_wallets ?? 0);

  const nowSec = Math.floor(Date.now() / 1000);

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Polymarket</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Top wallets ranked by composite score (realized PnL + ROI, sample-size weighted). Built
            from continuous trade-firehose ingestion + per-wallet /positions scoring.
          </p>
        </header>
        <PolymarketTabs active="wallets" />

        <PolymarketWalletLeaderboard
          rows={rows}
          nowSec={nowSec}
          totalWallets={totalWallets}
          scoredCount={scoredCount}
        />
      </div>
    </>
  );
}
