import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import PolymarketTabs from "@/components/PolymarketTabs";
import PolymarketWhaleFeed from "@/components/PolymarketWhaleFeed";
import { fetchPolymarketWhales } from "@/lib/polymarket";

export const dynamic = "force-dynamic";

const WINDOWS: Record<string, { seconds: number; label: string; pages: number }> = {
  "5m":  { seconds: 5 * 60,    label: "5m",  pages: 6 },
  "15m": { seconds: 15 * 60,   label: "15m", pages: 18 },
  "1h":  { seconds: 60 * 60,   label: "1h",  pages: 30 },
};

const MIN_USDS = [200, 500, 1000, 5000, 10000];

function parseWindow(raw: string | undefined): keyof typeof WINDOWS {
  if (raw && raw in WINDOWS) return raw as keyof typeof WINDOWS;
  return "5m";
}

function parseMinUsd(raw: string | undefined): number {
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && MIN_USDS.includes(n)) return n;
  return 500;
}

function pillCls(active: boolean): string {
  return active
    ? "px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40"
    : "px-2.5 py-1 text-xs font-medium rounded-full border border-black/15 dark:border-white/15 text-black/60 dark:text-white/60 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]";
}

export default async function PolymarketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const windowKey = parseWindow(typeof sp.window === "string" ? sp.window : undefined);
  const minUsd = parseMinUsd(typeof sp.min === "string" ? sp.min : undefined);
  const w = WINDOWS[windowKey];
  const nowSec = Math.floor(Date.now() / 1000);
  const sinceTs = nowSec - w.seconds;

  const result = await fetchPolymarketWhales({
    minUsd,
    sinceTs,
    maxPages: w.pages,
    maxWhales: 200,
  });

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Polymarket</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Live whale-trade snapshot from the Polymarket Data API. Sized bets only.
          </p>
        </header>
        <PolymarketTabs active="live" />

        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-3">
          <div className="flex items-baseline gap-2">
            <span className="text-xs uppercase tracking-wide text-black/55 dark:text-white/55">
              Window
            </span>
            {(Object.keys(WINDOWS) as Array<keyof typeof WINDOWS>).map((key) => (
              <Link
                key={key}
                href={`/polymarket?window=${key}&min=${minUsd}`}
                className={pillCls(key === windowKey)}
              >
                {WINDOWS[key].label}
              </Link>
            ))}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xs uppercase tracking-wide text-black/55 dark:text-white/55">
              Min size
            </span>
            {MIN_USDS.map((amt) => (
              <Link
                key={amt}
                href={`/polymarket?window=${windowKey}&min=${amt}`}
                className={pillCls(amt === minUsd)}
              >
                {amt >= 1000 ? `$${amt / 1000}K` : `$${amt}`}
              </Link>
            ))}
          </div>
        </div>

        <PolymarketWhaleFeed
          trades={result.trades}
          windowLabel={w.label}
          minUsd={minUsd}
          nowSec={nowSec}
          totalScanned={result.totalScanned}
          pagesFetched={result.pagesFetched}
          oldestTs={result.oldestTs}
          newestTs={result.newestTs}
        />
      </div>
    </>
  );
}
