import Link from "next/link";
import type { EarningsPost, EarningsStock } from "@/lib/db/schema";

function fmtPct(x: number | null | undefined, opts?: { signed?: boolean; places?: number }): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const places = opts?.places ?? 1;
  const sign = opts?.signed && x > 0 ? "+" : "";
  return `${sign}${x.toFixed(places)}%`;
}

function fmtUsd(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `$${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtBcap(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `$${x.toFixed(1)}B`;
}

function fmtEarningsTime(t: EarningsStock["earningsTime"]): string {
  if (t === "bmo") return "BMO";
  if (t === "amc") return "AMC";
  return "—";
}

function fmtEarningsDate(d: string): string {
  // d is YYYY-MM-DD; format for compact display.
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  const dt = new Date(`${d}T12:00:00Z`);
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function EarningsView({ post }: { post: EarningsPost }) {
  const scanLabel = new Date(`${post.scanDay}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const flagged = post.stocks.filter((s) => s.isFlagged);
  const unflagged = post.stocks.filter((s) => !s.isFlagged);

  return (
    <article className="space-y-6">
      {/* Header */}
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="text-[10px] uppercase tracking-widest text-amber-600 dark:text-amber-400">
            Earnings Whiplash Map · Weekly Scan
          </div>
          <Link
            href="/learn/earnings-whiplash"
            className="text-xs text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:underline"
          >
            Help · how to read this →
          </Link>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {post.stocks.length} earnings setups · {flagged.length} flagged as asymmetric
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

      {/* Flagged asymmetric setups */}
      {flagged.length > 0 && (
        <section className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-amber-600 dark:text-amber-400">
            Flagged · IV cheap vs historical realized
          </div>
          {flagged.map((s) => (
            <StockCard key={s.ticker} stock={s} flaggedSection />
          ))}
        </section>
      )}

      {/* Full ranked list */}
      {unflagged.length > 0 && (
        <section className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-black/55 dark:text-white/55">
            Full ranked list · highest historical post-earnings volatility
          </div>
          {unflagged.map((s, i) => (
            <StockCard key={s.ticker} stock={s} rank={flagged.length + i + 1} />
          ))}
        </section>
      )}

      {post.stocks.length === 0 && (
        <div className="rounded-lg border border-black/10 dark:border-white/10 p-6 text-sm text-black/60 dark:text-white/60">
          No earnings setups qualified this scan. See methodology below.
        </div>
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
        Historical post-earnings move = absolute % gap between the prior close and the next session
        close, averaged over the configured lookback (typically 8 quarters). Implied move is
        derived from the front-month at-the-money straddle premium ÷ underlying price.
        &ldquo;Asymmetric&rdquo; means implied move materially understates the historical realized move —
        it does NOT mean a directional bet. Earnings outcomes are binary; treat these as
        candidates for long-volatility structures (straddles, strangles), not directional plays.
        Not investment advice.
      </footer>
    </article>
  );
}

function StockCard({
  stock,
  rank,
  flaggedSection,
}: {
  stock: EarningsStock;
  rank?: number;
  flaggedSection?: boolean;
}) {
  const flagTone = flaggedSection
    ? "border-amber-500/40 bg-amber-500/[0.04]"
    : "border-black/10 dark:border-white/10";

  return (
    <div className={`rounded-lg border ${flagTone} overflow-hidden`}>
      {/* Top bar */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 bg-black/[0.02] dark:bg-white/[0.02] border-b border-black/10 dark:border-white/10">
        <div className="flex items-baseline gap-3">
          {!flaggedSection && rank != null && (
            <span className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45">
              #{rank}
            </span>
          )}
          {flaggedSection && (
            <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
              Flagged
            </span>
          )}
          <h2 className="text-lg font-bold tracking-tight">{stock.ticker}</h2>
          <span className="text-sm text-black/70 dark:text-white/70">{stock.companyName}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {stock.sector && (
            <span className="px-2 py-0.5 rounded bg-black/[0.05] dark:bg-white/[0.05] text-black/65 dark:text-white/65">
              {stock.sector}
            </span>
          )}
          {stock.marketCapUsdB != null && (
            <span className="text-black/55 dark:text-white/55">{fmtBcap(stock.marketCapUsdB)} mkt cap</span>
          )}
        </div>
      </div>

      {/* Earnings + IV vs HV side-by-side */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 px-4 py-3 text-sm">
        <Metric
          label="Earnings"
          value={fmtEarningsDate(stock.earningsDate)}
          suffix={
            <span className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45">
              {fmtEarningsTime(stock.earningsTime)}
            </span>
          }
        />
        <Metric label="Current price" value={fmtUsd(stock.currentPrice)} />
        <Metric
          label="Implied move"
          value={fmtPct(stock.impliedMovePct)}
          suffix={
            <span className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45">
              from straddle
            </span>
          }
        />
        <Metric
          label="Historical avg"
          value={fmtPct(stock.historicalAvgMovePct)}
          suffix={
            stock.lookbackQuarters != null && (
              <span className="text-[10px] uppercase tracking-widest text-black/45 dark:text-white/45">
                {stock.lookbackQuarters}Q
              </span>
            )
          }
        />
      </div>

      {/* Asymmetry row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 px-4 py-3 text-xs border-t border-black/5 dark:border-white/5">
        <Metric
          label="IV − HV gap"
          value={fmtPct(stock.ivVsHvDeltaPct, { signed: true })}
          tone={
            stock.ivVsHvDeltaPct != null && stock.ivVsHvDeltaPct < -1
              ? "good"
              : stock.ivVsHvDeltaPct != null && stock.ivVsHvDeltaPct > 1
                ? "bad"
                : undefined
          }
          small
        />
        <Metric label="Historical max" value={fmtPct(stock.historicalMaxMovePct)} small />
        <Metric
          label="Moves ≥ 8%"
          value={
            stock.historicalMovesAbove8Pct != null
              ? `${stock.historicalMovesAbove8Pct}${stock.lookbackQuarters != null ? ` / ${stock.lookbackQuarters}` : ""}`
              : "—"
          }
          small
        />
        <Metric
          label="Setup"
          value={
            stock.ivVsHvDeltaPct != null && stock.ivVsHvDeltaPct < 0
              ? "Long vol"
              : stock.ivVsHvDeltaPct != null && stock.ivVsHvDeltaPct > 0
                ? "Short vol"
                : "Neutral"
          }
          tone={
            stock.ivVsHvDeltaPct != null && stock.ivVsHvDeltaPct < -1
              ? "good"
              : stock.ivVsHvDeltaPct != null && stock.ivVsHvDeltaPct > 1
                ? "warn"
                : undefined
          }
          small
        />
      </div>

      {/* Flag reason (flagged section only) */}
      {flaggedSection && stock.flagReason && (
        <div className="px-4 py-3 border-t border-black/5 dark:border-white/5 bg-amber-500/[0.04]">
          <div className="text-[10px] uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-1">
            Why flagged
          </div>
          <p className="text-sm leading-relaxed">{stock.flagReason}</p>
        </div>
      )}

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
          <div className="text-[10px] uppercase tracking-widest text-rose-500/80 mb-2">Risks</div>
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
