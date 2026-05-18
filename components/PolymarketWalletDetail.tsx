import {
  fmtUsdCompact,
  relAge,
  shortWallet,
  type PolymarketPosition,
} from "@/lib/polymarket";

export interface WalletHeader {
  address: string;
  pseudonym: string | null;
  displayName: string | null;
  totalVolumeUsd: number;
  whaleTradesSeen: number;
  firstSeen: Date;
  lastSeen: Date;
}

export interface ScoreSnapshot {
  scoredAt: Date;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  capitalDeployedUsd: number | null;
  roi: number | null;
  positionCount: number;
  compositeScore: number | null;
}

export interface RecentTradeRow {
  transactionHash: string;
  asset: string;
  conditionId: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  usdValue: number;
  outcome: string | null;
  title: string | null;
  slug: string | null;
  eventSlug: string | null;
  timestamp: Date;
}

function fmtSignedUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : n > 0 ? "+" : "";
  return sign + fmtUsdCompact(abs);
}

function fmtRoi(roi: number | null): string {
  if (roi == null || !Number.isFinite(roi)) return "—";
  const pct = roi * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function pnlClasses(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "text-black/40 dark:text-white/40";
  if (n > 0) return "text-emerald-600 dark:text-emerald-400";
  if (n < 0) return "text-rose-600 dark:text-rose-400";
  return "text-black/55 dark:text-white/55";
}

function fmtProb(p: number): string {
  if (!Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(1)}¢`;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-black/55 dark:text-white/55">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-base font-semibold">{value}</div>
      {sub && <div className="text-[10px] text-black/50 dark:text-white/50">{sub}</div>}
    </div>
  );
}

export default function PolymarketWalletDetail({
  header,
  score,
  positions,
  recentTrades,
  positionsError,
  nowSec,
}: {
  header: WalletHeader;
  score: ScoreSnapshot | null;
  positions: PolymarketPosition[];
  recentTrades: RecentTradeRow[];
  positionsError: string | null;
  nowSec: number;
}) {
  const profileUrl = `https://polymarket.com/profile/${header.address}`;

  const sortedPositions = [...positions].sort((a, b) => b.cashPnl - a.cashPnl);

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight">
            {header.pseudonym || header.displayName || shortWallet(header.address)}
          </h1>
          {score?.compositeScore != null && (
            <span className="inline-block px-2.5 py-0.5 text-xs rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 font-mono font-semibold">
              score {score.compositeScore.toFixed(2)}
            </span>
          )}
        </div>
        <div className="text-xs font-mono text-black/55 dark:text-white/55 break-all">
          {header.address}
          {" · "}
          <a
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            polymarket.com profile ↗
          </a>
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide">Score snapshot</h2>
        {score ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <StatTile
              label="Composite"
              value={score.compositeScore != null ? score.compositeScore.toFixed(2) : "—"}
              sub={`${relAge(Math.floor(score.scoredAt.getTime() / 1000), nowSec)} ago`}
            />
            <StatTile
              label="Realized PnL"
              value={fmtSignedUsd(score.realizedPnl)}
            />
            <StatTile
              label="Unrealized PnL"
              value={fmtSignedUsd(score.unrealizedPnl)}
            />
            <StatTile label="ROI" value={fmtRoi(score.roi)} />
            <StatTile
              label="Capital"
              value={
                score.capitalDeployedUsd != null
                  ? fmtUsdCompact(score.capitalDeployedUsd)
                  : "—"
              }
            />
            <StatTile label="Positions" value={String(score.positionCount)} />
          </div>
        ) : (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            No score snapshot yet. The wallet has been seen but not scored — usually
            scoring happens within ~12h of discovery.
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatTile
            label="Whale trades seen"
            value={header.whaleTradesSeen.toLocaleString()}
            sub={`since ${header.firstSeen.toISOString().slice(0, 10)}`}
          />
          <StatTile
            label="Total whale volume"
            value={fmtUsdCompact(header.totalVolumeUsd)}
          />
          <StatTile
            label="Last seen"
            value={`${relAge(Math.floor(header.lastSeen.getTime() / 1000), nowSec)} ago`}
          />
          <StatTile
            label="First seen"
            value={`${relAge(Math.floor(header.firstSeen.getTime() / 1000), nowSec)} ago`}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide flex items-baseline gap-2">
          Open positions
          <span className="text-xs font-normal text-black/55 dark:text-white/55">
            live from Polymarket /positions
          </span>
        </h2>
        {positionsError ? (
          <div className="rounded border border-rose-500/30 bg-rose-500/10 p-3 text-sm font-mono">
            {positionsError}
          </div>
        ) : positions.length === 0 ? (
          <div className="rounded border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-3 text-sm">
            No open positions.
          </div>
        ) : (
          <div className="overflow-x-auto border border-black/10 dark:border-white/10 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
                <tr className="text-left">
                  <th className="px-3 py-2">Market · Outcome</th>
                  <th className="px-3 py-2 w-20 text-right">Size</th>
                  <th className="px-3 py-2 w-16 text-right">Avg Px</th>
                  <th className="px-3 py-2 w-16 text-right">Cur Px</th>
                  <th className="px-3 py-2 w-20 text-right">Cost</th>
                  <th className="px-3 py-2 w-20 text-right">Value</th>
                  <th className="px-3 py-2 w-24 text-right">PnL</th>
                  <th className="px-3 py-2 w-16 text-right">PnL%</th>
                  <th className="px-3 py-2 w-12 text-right">End</th>
                </tr>
              </thead>
              <tbody>
                {sortedPositions.map((p) => {
                  const eventUrl = `https://polymarket.com/event/${p.eventSlug || p.slug}`;
                  return (
                    <tr
                      key={p.asset}
                      className={[
                        "border-t border-black/10 dark:border-white/10 align-top transition-colors",
                        p.redeemable
                          ? "bg-emerald-500/[0.04]"
                          : "hover:bg-black/[0.02] dark:hover:bg-white/[0.04]",
                      ].join(" ")}
                    >
                      <td className="px-3 py-1.5 min-w-0">
                        <a
                          href={eventUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline block truncate max-w-[420px] font-medium"
                          title={p.title}
                        >
                          {p.title}
                        </a>
                        <div className="text-[11px] text-black/55 dark:text-white/55">
                          Outcome: <span className="font-medium">{p.outcome}</span>
                          {p.redeemable && (
                            <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                              REDEEMABLE
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">
                        {p.size.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">
                        {fmtProb(p.avgPrice)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">
                        {fmtProb(p.curPrice)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs text-black/65 dark:text-white/65">
                        {fmtUsdCompact(p.initialValue)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">
                        {fmtUsdCompact(p.currentValue)}
                      </td>
                      <td className={`px-3 py-1.5 text-right font-mono font-semibold ${pnlClasses(p.cashPnl)}`}>
                        {fmtSignedUsd(p.cashPnl)}
                      </td>
                      <td className={`px-3 py-1.5 text-right font-mono text-xs ${pnlClasses(p.percentPnl)}`}>
                        {p.percentPnl >= 0 ? "+" : ""}
                        {p.percentPnl.toFixed(1)}%
                      </td>
                      <td className="px-3 py-1.5 text-right text-[10px] text-black/45 dark:text-white/45 font-mono">
                        {p.endDate ? p.endDate.slice(5) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide flex items-baseline gap-2">
          Recent whale trades
          <span className="text-xs font-normal text-black/55 dark:text-white/55">
            from our ingestion firehose · whale-sized only (≥ $500)
          </span>
        </h2>
        {recentTrades.length === 0 ? (
          <div className="rounded border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-3 text-sm">
            No whale trades persisted for this wallet yet.
          </div>
        ) : (
          <div className="overflow-x-auto border border-black/10 dark:border-white/10 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
                <tr className="text-left">
                  <th className="px-3 py-2 w-14 text-right">Age</th>
                  <th className="px-3 py-2">Market · Outcome</th>
                  <th className="px-3 py-2 w-16">Side</th>
                  <th className="px-3 py-2 w-16 text-right">Px</th>
                  <th className="px-3 py-2 w-20 text-right">Size</th>
                  <th className="px-3 py-2 w-20 text-right">USD</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map((t) => {
                  const tsSec = Math.floor(t.timestamp.getTime() / 1000);
                  const eventUrl = `https://polymarket.com/event/${t.eventSlug || t.slug || ""}`;
                  return (
                    <tr
                      key={t.transactionHash + "-" + t.asset}
                      className="border-t border-black/10 dark:border-white/10 align-top hover:bg-black/[0.02] dark:hover:bg-white/[0.04] transition-colors"
                    >
                      <td className="px-3 py-1.5 text-right font-mono text-xs text-black/55 dark:text-white/55">
                        {relAge(tsSec, nowSec)}
                      </td>
                      <td className="px-3 py-1.5 min-w-0">
                        <a
                          href={eventUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline block truncate max-w-[420px]"
                          title={t.title ?? ""}
                        >
                          {t.title || t.conditionId.slice(0, 12)}
                        </a>
                        <div className="text-[11px] text-black/55 dark:text-white/55">
                          Outcome: <span className="font-medium">{t.outcome ?? "—"}</span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={[
                            "inline-block px-2 py-0.5 rounded-full border text-[11px] font-mono font-semibold tracking-wide",
                            t.side === "BUY"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40"
                              : "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40",
                          ].join(" ")}
                        >
                          {t.side}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">
                        {fmtProb(t.price)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">
                        {t.size.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold">
                        {fmtUsdCompact(t.usdValue)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
