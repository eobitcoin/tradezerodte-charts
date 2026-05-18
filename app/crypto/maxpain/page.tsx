import SiteHeader from "@/components/SiteHeader";
import CryptoTabs from "@/components/CryptoTabs";
import CryptoMaxPainView from "@/components/CryptoMaxPainView";
import { fetchCryptoMaxPain, type CryptoMaxPainStats } from "@/lib/crypto-maxpain";
import type { DeribitCurrency } from "@/lib/deribit";

export const dynamic = "force-dynamic";

const CURRENCIES: DeribitCurrency[] = ["BTC", "ETH"];

interface Result {
  currency: DeribitCurrency;
  stats: CryptoMaxPainStats | null;
  error: string | null;
}

async function safeFetch(currency: DeribitCurrency): Promise<Result> {
  try {
    const stats = await fetchCryptoMaxPain(currency);
    return { currency, stats, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { currency, stats: null, error: message };
  }
}

export default async function CryptoMaxPainPage() {
  // Fetch BTC and ETH in parallel.
  const results = await Promise.all(CURRENCIES.map(safeFetch));

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Crypto</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Live max pain + GEX for BTC and ETH options. Sourced from Deribit (~85% of crypto
            options OI). Refresh the page for the latest read — Deribit data is cached server-side
            for 60 seconds.
          </p>
        </header>
        <CryptoTabs active="maxpain" />

        <div className="space-y-8">
          {results.map((r) =>
            r.stats ? (
              <CryptoMaxPainView key={r.currency} stats={r.stats} />
            ) : (
              <div
                key={r.currency}
                className="rounded border border-rose-500/30 bg-rose-500/10 p-3 text-sm space-y-1"
              >
                <div className="font-semibold">{r.currency} unavailable</div>
                <div className="text-xs text-black/65 dark:text-white/65 font-mono">{r.error}</div>
              </div>
            ),
          )}
        </div>

        <div className="text-xs text-black/55 dark:text-white/55 leading-relaxed space-y-1 max-w-3xl">
          <p>
            <strong>Why no SOL?</strong> SOL options have been delisted from both Deribit and OKX —
            no major venue currently has live SOL options. We&apos;ll add it back if/when listing
            resumes.
          </p>
          <p>
            <strong>Caveats for crypto.</strong> Crypto dealer flow is more mixed than equity (more
            yield-seekers writing covered calls, more retail buying outright). The POS/NEG GEX
            label is less mechanically tied to dealer hedging than in equity. Treat call wall / put
            wall as &quot;sticky strikes&quot; (where dealer-style hedging would resist a move),
            not as a hard floor / ceiling.
          </p>
          <p>
            <strong>Settlement.</strong> Deribit options expire at 08:00 UTC on the expiry date.
            Today&apos;s &quot;front max pain&quot; only matters until that bar — after settlement
            it&apos;s the next expiry that takes over.
          </p>
        </div>
      </div>
    </>
  );
}
