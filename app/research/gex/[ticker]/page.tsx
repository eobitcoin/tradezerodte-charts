import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gexSnapshots, type GexStrikeRow } from "@/lib/db/schema";
import { GEX_WATCHLIST } from "@/lib/gex";
import SiteHeader from "@/components/SiteHeader";
import OptionsSubNav from "@/components/OptionsSubNav";
import GexProfileChart from "@/components/GexProfileChart";

export const dynamic = "force-dynamic";

/**
 * /research/gex/[ticker] — per-ticker detail with the latest profile
 * chart and the headline regime numbers.
 *
 * Only watchlist tickers are valid (the cron only writes those rows).
 * Unknown tickers 404. URLs are case-insensitive — we upper-case in.
 */
export default async function GexTickerPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: raw } = await params;
  const ticker = raw.toUpperCase();
  if (!(GEX_WATCHLIST as readonly string[]).includes(ticker)) {
    notFound();
  }

  const [snap] = await db
    .select()
    .from(gexSnapshots)
    .where(eq(gexSnapshots.ticker, ticker))
    .orderBy(desc(gexSnapshots.ts))
    .limit(1);

  return (
    <>
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        <OptionsSubNav active="gex" />
        <header className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-amber-400">
            Dealer GEX · {ticker}
          </div>
          <div className="flex items-baseline gap-4">
            <h1 className="text-4xl font-bold tracking-tight font-mono">
              {ticker}
            </h1>
            {snap && (
              <span className="text-xl text-white/85 font-mono">
                ${Number(snap.spot).toFixed(Number(snap.spot) >= 200 ? 0 : 2)}
              </span>
            )}
          </div>
          {snap && (
            <p className="text-sm text-white/55">
              Snapshot {snap.ts.toLocaleString("en-US", {
                timeZone: "America/New_York",
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              ET · {snap.contractsScanned.toLocaleString()} contracts
              across {snap.expiriesScanned} expiries
            </p>
          )}
        </header>

        {!snap ? (
          <p className="text-sm text-white/55 italic">
            No GEX snapshots for {ticker} yet. The cron populates this
            page during regular trading hours.
          </p>
        ) : (
          <>
            <HeadlineGrid snap={snap} />
            <section className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-widest text-white/65">
                Per-strike profile
              </h2>
              <GexProfileChart
                rows={snap.gexByStrike as GexStrikeRow[]}
                spot={Number(snap.spot)}
                zeroGammaStrike={
                  snap.zeroGammaStrike ? Number(snap.zeroGammaStrike) : null
                }
              />
              <p className="text-xs text-white/45 leading-relaxed">
                Bars: <span className="text-emerald-300">emerald</span> = positive
                net γ (long γ at that strike, dealers pin),{" "}
                <span className="text-rose-300">rose</span> = negative net γ (short
                γ at that strike, dealers chase).{" "}
                <span className="text-amber-300">Amber dashed</span> = zero-γ flip.
                Solid white = spot. Strikes clipped to ±15% of spot.
              </p>
            </section>
          </>
        )}

        <footer className="border-t border-white/10 pt-4">
          <Link
            href="/research/gex"
            className="text-sm text-white/55 hover:text-white hover:underline"
          >
            ← Back to GEX universe
          </Link>
        </footer>
      </main>
    </>
  );
}

function HeadlineGrid({ snap }: { snap: typeof gexSnapshots.$inferSelect }) {
  const total = Number(snap.totalGex);
  const regime =
    total > 0
      ? { label: "Long γ — pin regime", tone: "text-emerald-300" }
      : { label: "Short γ — squeeze regime", tone: "text-rose-300" };
  const zg = snap.zeroGammaStrike ? Number(snap.zeroGammaStrike) : null;
  const zgPct = snap.zeroGammaPct ? Number(snap.zeroGammaPct) : null;
  return (
    <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <HeadlineCell
        label="Regime"
        value={regime.label}
        valueClass={`text-sm font-semibold ${regime.tone}`}
      />
      <HeadlineCell
        label="Total γ"
        value={fmtBigDollars(total)}
        valueClass={`text-base font-mono font-bold ${
          total >= 0 ? "text-emerald-300" : "text-rose-300"
        }`}
      />
      <HeadlineCell
        label="Zero-γ strike"
        value={zg != null ? `$${zg.toFixed(zg >= 200 ? 0 : 2)}` : "—"}
        valueClass="text-base font-mono font-bold text-amber-300"
      />
      <HeadlineCell
        label="Distance from spot"
        value={
          zgPct != null
            ? `${zgPct >= 0 ? "+" : ""}${zgPct.toFixed(2)}%`
            : "—"
        }
        valueClass="text-base font-mono font-bold text-white/85"
      />
    </section>
  );
}

function HeadlineCell({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-widest text-white/45">
        {label}
      </div>
      <div className={`mt-1 ${valueClass}`}>{value}</div>
    </div>
  );
}

function fmtBigDollars(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "+";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}
