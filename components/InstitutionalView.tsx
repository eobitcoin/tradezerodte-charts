import Link from "next/link";
import type { InstitutionalPost, InstitutionalStock } from "@/lib/db/schema";

function fmtUsd(x: number | null | undefined, opts?: { compact?: boolean }): string {
  if (x == null || !Number.isFinite(x)) return "—";
  if (opts?.compact) {
    if (Math.abs(x) >= 1_000_000_000) return `$${(x / 1_000_000_000).toFixed(1)}B`;
    if (Math.abs(x) >= 1_000_000) return `$${(x / 1_000_000).toFixed(1)}M`;
    if (Math.abs(x) >= 1_000) return `$${(x / 1_000).toFixed(0)}K`;
  }
  return `$${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtShares(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  if (Math.abs(x) >= 1_000_000) return `${(x / 1_000_000).toFixed(1)}M`;
  if (Math.abs(x) >= 1_000) return `${(x / 1_000).toFixed(0)}K`;
  return x.toLocaleString();
}

function fmtPctSigned(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(1)}%`;
}

function priceDelta(entry: number | null, current: number | null): { pct: number; tone: "good" | "bad" | "neutral" } | null {
  if (entry == null || current == null || entry <= 0) return null;
  const pct = ((current - entry) / entry) * 100;
  if (Math.abs(pct) < 0.1) return { pct, tone: "neutral" };
  return { pct, tone: pct > 0 ? "good" : "bad" };
}

export default function InstitutionalView({ post }: { post: InstitutionalPost }) {
  const scanLabel = new Date(`${post.scanDay}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    <article className="space-y-6">
      {/* Header */}
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="text-[10px] uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
            Institutional Flow · Weekly Scan
          </div>
          <Link
            href="/learn/institutional-flow"
            className="text-xs text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:underline"
          >
            Help · how to read this →
          </Link>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          Smart money is quietly loading these {post.stocks.length}
          {post.stocks.length === 1 ? " stock" : " stocks"}
        </h1>
        <div className="text-xs text-black/55 dark:text-white/55">
          Scan day: {scanLabel}
          {post.runAt && (
            <>
              {" · Run at "}
              {new Date(post.runAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </>
          )}
        </div>
      </header>

      {/* Executive summary */}
      {post.summary && (
        <section className="prose prose-neutral dark:prose-invert max-w-none text-sm">
          {post.summary.split(/\n{2,}/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      )}

      {/* Stocks */}
      {post.stocks.length === 0 ? (
        <div className="rounded-lg border border-black/10 dark:border-white/10 p-6 text-sm text-black/60 dark:text-white/60">
          No candidates qualified this scan. See methodology below for what was checked.
        </div>
      ) : (
        <section className="space-y-4">
          {post.stocks.map((s, i) => (
            <StockCard key={s.ticker} stock={s} rank={i + 1} />
          ))}
        </section>
      )}

      {/* Methodology */}
      {post.methodology && (
        <section className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
            How this scan was built
          </div>
          <p className="text-xs text-black/70 dark:text-white/70 leading-relaxed">
            {post.methodology}
          </p>
        </section>
      )}

      {/* Disclaimer */}
      <footer className="text-[11px] text-black/45 dark:text-white/45 leading-relaxed border-t border-black/5 dark:border-white/5 pt-4">
        13F filings are quarterly and lag 45 days. Position sizes shown reflect
        the most recently filed quarter end, not real-time holdings. Quant
        managers (Renaissance Technologies, Two Sigma) trade heavily intra-quarter,
        so their 13F is a partial signal at best. Average entry price is an
        ESTIMATE derived from filing value ÷ shares held — 13F does not report
        cost basis. Not investment advice.
      </footer>
    </article>
  );
}

function StockCard({ stock, rank }: { stock: InstitutionalStock; rank: number }) {
  const delta = priceDelta(stock.avgEntryPriceEstimate, stock.currentPrice);
  const newPositions = stock.supportingFunds.filter((f) => f.isNewPosition).length;
  const addedPositions = stock.supportingFunds.filter(
    (f) => !f.isNewPosition && f.deltaPct != null && f.deltaPct > 0,
  ).length;

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 overflow-hidden">
      {/* Top bar */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 bg-black/[0.02] dark:bg-white/[0.02] border-b border-black/10 dark:border-white/10">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45">
            #{rank}
          </span>
          <h2 className="text-lg font-bold tracking-tight">{stock.ticker}</h2>
          <span className="text-sm text-black/70 dark:text-white/70">
            {stock.companyName}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {stock.sector && (
            <span className="px-2 py-0.5 rounded bg-black/[0.05] dark:bg-white/[0.05] text-black/65 dark:text-white/65">
              {stock.sector}
            </span>
          )}
          {stock.marketCapUsdB != null && (
            <span className="text-black/55 dark:text-white/55">
              ${stock.marketCapUsdB.toFixed(1)}B mkt cap
            </span>
          )}
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 px-4 py-3 text-sm">
        <Metric label="Avg entry est." value={fmtUsd(stock.avgEntryPriceEstimate)} />
        <Metric
          label="Current price"
          value={fmtUsd(stock.currentPrice)}
          suffix={
            delta && (
              <span
                className={
                  delta.tone === "good"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : delta.tone === "bad"
                      ? "text-rose-500"
                      : "text-black/50 dark:text-white/50"
                }
              >
                {fmtPctSigned(delta.pct)}
              </span>
            )
          }
        />
        <Metric label="Total shares held" value={fmtShares(stock.totalSharesHeld)} />
        <Metric label="Position value" value={fmtUsd(stock.totalSharesHeldUsd, { compact: true })} />
      </div>

      {/* Funds breakdown */}
      <div className="px-4 py-3 border-t border-black/5 dark:border-white/5">
        <div className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55 mb-2">
          Supporting funds · {newPositions} new · {addedPositions} added
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="text-black/55 dark:text-white/55 uppercase tracking-widest text-[10px]">
              <tr className="text-left">
                <th className="py-1">Fund</th>
                <th className="py-1 text-right">Now</th>
                <th className="py-1 text-right">Prior</th>
                <th className="py-1 text-right">Δ</th>
              </tr>
            </thead>
            <tbody>
              {stock.supportingFunds.map((f) => (
                <tr key={f.fund} className="border-t border-black/5 dark:border-white/5">
                  <td className="py-1.5 pr-2 font-sans">{f.fund}</td>
                  <td className="py-1.5 text-right">{fmtShares(f.sharesNow)}</td>
                  <td className="py-1.5 text-right">
                    {f.isNewPosition ? (
                      <span className="text-emerald-600 dark:text-emerald-400 text-[10px] uppercase tracking-widest">
                        new
                      </span>
                    ) : (
                      fmtShares(f.sharesPrior)
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    {f.isNewPosition ? (
                      <span className="text-emerald-600 dark:text-emerald-400">+∞</span>
                    ) : f.deltaPct != null && f.deltaPct > 0 ? (
                      <span className="text-emerald-600 dark:text-emerald-400">{fmtPctSigned(f.deltaPct)}</span>
                    ) : (
                      <span className="text-black/50 dark:text-white/50">{fmtPctSigned(f.deltaPct)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Retail attention */}
      <div className="px-4 py-3 border-t border-black/5 dark:border-white/5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
        <Metric
          label="Google Trends"
          value={
            stock.retailAttention.googleTrendsScore != null
              ? `${stock.retailAttention.googleTrendsScore}/100`
              : "—"
          }
          small
        />
        <Metric
          label="News 30d"
          value={
            stock.retailAttention.news30DayCount != null
              ? `${stock.retailAttention.news30DayCount}`
              : "—"
          }
          small
        />
        <Metric
          label="Retail hotlist"
          value={stock.retailAttention.isOnRetailHotlist ? "Yes" : "No"}
          tone={stock.retailAttention.isOnRetailHotlist ? "warn" : "good"}
          small
        />
        <Metric
          label="C/P OI ratio"
          value={
            stock.retailAttention.optionsCallPutOiRatio != null
              ? stock.retailAttention.optionsCallPutOiRatio.toFixed(2)
              : "—"
          }
          small
        />
        {stock.earningsNext && (
          <Metric
            label="Next earnings"
            value={stock.earningsNext}
            small
          />
        )}
      </div>

      {/* Thesis */}
      <div className="px-4 py-3 border-t border-black/5 dark:border-white/5">
        <div className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55 mb-2">
          Thesis
        </div>
        <p className="text-sm leading-relaxed">{stock.thesis}</p>
      </div>

      {/* Risks */}
      {stock.risks && (
        <div className="px-4 py-3 border-t border-black/5 dark:border-white/5 bg-rose-500/[0.02]">
          <div className="text-[10px] uppercase tracking-widest text-rose-500/80 mb-2">
            Risks
          </div>
          <p className="text-sm leading-relaxed text-black/75 dark:text-white/75">{stock.risks}</p>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  suffix,
  tone,
  small,
}: {
  label: string;
  value: string;
  suffix?: React.ReactNode;
  tone?: "good" | "bad" | "warn";
  small?: boolean;
}) {
  const valueTone =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "bad"
        ? "text-rose-500"
        : tone === "warn"
          ? "text-amber-600 dark:text-amber-400"
          : "";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45">
        {label}
      </span>
      <span className={[small ? "text-sm" : "text-base", "font-mono", valueTone].join(" ")}>
        {value}
        {suffix && <span className="ml-1 text-xs">{suffix}</span>}
      </span>
    </div>
  );
}
