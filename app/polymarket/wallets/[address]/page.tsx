import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, and, eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  polymarketWallets,
  polymarketWalletScores,
  polymarketTrades,
} from "@/lib/db/schema";
import {
  fetchPolymarketPositions,
  type PolymarketPosition,
} from "@/lib/polymarket";
import SiteHeader from "@/components/SiteHeader";
import PolymarketTabs from "@/components/PolymarketTabs";
import PolymarketWalletDetail, {
  type WalletHeader,
  type ScoreSnapshot,
  type RecentTradeRow,
} from "@/components/PolymarketWalletDetail";

export const dynamic = "force-dynamic";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function toDate(v: string | Date | null | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function PolymarketWalletDetailPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address: rawAddress } = await params;
  if (!ADDRESS_RE.test(rawAddress)) notFound();
  const address = rawAddress.toLowerCase();

  // 1. Wallet record (must exist).
  const [walletRow] = await db
    .select()
    .from(polymarketWallets)
    .where(eq(polymarketWallets.address, address))
    .limit(1);
  if (!walletRow) {
    return (
      <>
        <SiteHeader />
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
          <header className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Polymarket</h1>
          </header>
          <PolymarketTabs active="wallets" />
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm space-y-2">
            <p>Wallet not in our roster yet.</p>
            <p className="text-xs font-mono break-all">{address}</p>
            <p className="text-xs text-black/55 dark:text-white/55">
              We only persist wallets that have appeared in a whale-sized trade (≥ $500). If this
              wallet is real but small-time, it&apos;ll show up on Polymarket directly:
            </p>
            <p>
              <a
                href={`https://polymarket.com/profile/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                polymarket.com/profile/{address.slice(0, 10)}…
              </a>
            </p>
            <p>
              <Link href="/polymarket/wallets" className="underline">← Top Wallets</Link>
            </p>
          </div>
        </div>
      </>
    );
  }

  // 2. Latest score snapshot (may be null if never scored).
  const [scoreRow] = await db
    .select()
    .from(polymarketWalletScores)
    .where(eq(polymarketWalletScores.wallet, address))
    .orderBy(desc(polymarketWalletScores.scoredAt))
    .limit(1);

  // 3. Recent persisted trades (last 30) from our DB.
  const tradeRows = await db
    .select()
    .from(polymarketTrades)
    .where(eq(polymarketTrades.wallet, address))
    .orderBy(desc(polymarketTrades.timestamp))
    .limit(30);

  // 4. Live open positions from Polymarket /positions (degrade gracefully).
  let positions: PolymarketPosition[] = [];
  let positionsError: string | null = null;
  try {
    positions = await fetchPolymarketPositions(address);
  } catch (err) {
    positionsError = err instanceof Error ? err.message : String(err);
  }

  // Suppress unused import warnings.
  void and; void sql;

  const header: WalletHeader = {
    address: walletRow.address,
    pseudonym: walletRow.pseudonym,
    displayName: walletRow.displayName,
    totalVolumeUsd: Number(walletRow.totalVolumeUsd),
    whaleTradesSeen: walletRow.whaleTradesSeen,
    firstSeen: walletRow.firstSeen,
    lastSeen: walletRow.lastSeen,
  };

  const score: ScoreSnapshot | null = scoreRow
    ? {
        scoredAt: scoreRow.scoredAt,
        realizedPnl: Number(scoreRow.realizedPnl),
        unrealizedPnl: Number(scoreRow.unrealizedPnl),
        capitalDeployedUsd: Number(scoreRow.capitalDeployedUsd),
        roi: scoreRow.roi != null ? Number(scoreRow.roi) : null,
        positionCount: scoreRow.positionCount,
        compositeScore:
          scoreRow.compositeScore != null ? Number(scoreRow.compositeScore) : null,
      }
    : null;

  const recentTrades: RecentTradeRow[] = tradeRows.map((t) => ({
    transactionHash: t.transactionHash,
    asset: t.asset,
    conditionId: t.conditionId,
    side: t.side as "BUY" | "SELL",
    size: Number(t.size),
    price: Number(t.price),
    usdValue: Number(t.usdValue),
    outcome: t.outcome,
    title: t.title,
    slug: t.slug,
    eventSlug: t.eventSlug,
    timestamp: toDate(t.timestamp) ?? new Date(),
  }));

  const nowSec = Math.floor(Date.now() / 1000);

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Polymarket</h1>
        </header>
        <PolymarketTabs active="wallets" />
        <div>
          <Link href="/polymarket/wallets" className="text-sm underline">
            ← Top Wallets
          </Link>
        </div>
        <PolymarketWalletDetail
          header={header}
          score={score}
          positions={positions}
          recentTrades={recentTrades}
          positionsError={positionsError}
          nowSec={nowSec}
        />
      </div>
    </>
  );
}
