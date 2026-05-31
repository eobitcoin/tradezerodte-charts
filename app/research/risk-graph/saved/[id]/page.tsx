import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tradeIdeas, type TradeIdeaLeg } from "@/lib/db/schema";
import { fetchOptionChain } from "@/lib/polygon";
import SiteHeader from "@/components/SiteHeader";
import OptionsSubNav from "@/components/OptionsSubNav";
import RiskGraphBuilder, {
  type ChainResponse,
  type PositionLeg,
} from "@/components/RiskGraph/RiskGraphBuilder";
import DeleteTradeButton from "@/components/RiskGraph/DeleteTradeButton";
import CloseTradeButton from "@/components/RiskGraph/CloseTradeButton";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * /research/risk-graph/saved/[id] — recreates the saved trade idea
 * against the latest live chain. The Risk Graph UI renders identically
 * to the new-trade builder; the position is pre-filled with the saved
 * legs. User can adjust qty / entry price / shift IV to see what-ifs.
 *
 * Server-side: fetches the trade row, fetches the chain for its ticker,
 * formats both for the client builder. Wave 2 will also fetch the
 * latest marks for a performance section.
 */
export default async function SavedTradeIdeaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [row] = await db
    .select()
    .from(tradeIdeas)
    .where(eq(tradeIdeas.id, id))
    .limit(1);
  if (!row) notFound();

  // Pull the chain so the user can compare entry prices to current
  // market AND extend the position with more legs if they want.
  let chain: ChainResponse | null = null;
  try {
    const raw = await fetchOptionChain(row.ticker);
    if (raw.length > 0) {
      let spot: number | null = null;
      for (const c of raw) {
        const p = c.underlying_asset?.price;
        if (typeof p === "number" && Number.isFinite(p) && p > 0) {
          spot = p;
          break;
        }
      }
      if (spot != null) {
        // Group by expiry — same shape as /api/options/chain endpoint.
        type ChainRow = {
          contractTicker: string;
          strike: number;
          bid: number | null;
          ask: number | null;
          mid: number | null;
          iv: number | null;
          delta: number | null;
          gamma: number | null;
          theta: number | null;
          vega: number | null;
          openInterest: number | null;
          volume: number | null;
        };
        const byExpiry = new Map<
          string,
          { calls: ChainRow[]; puts: ChainRow[] }
        >();
        for (const c of raw) {
          const expiry = c.details.expiration_date;
          if (!byExpiry.has(expiry))
            byExpiry.set(expiry, { calls: [], puts: [] });
          const bid = c.last_quote?.bid ?? null;
          const ask = c.last_quote?.ask ?? null;
          const mid =
            typeof bid === "number" && typeof ask === "number" && ask >= bid
              ? (bid + ask) / 2
              : null;
          const rec: ChainRow = {
            contractTicker: c.details.ticker,
            strike: c.details.strike_price,
            bid,
            ask,
            mid,
            iv: c.implied_volatility ?? null,
            delta: c.greeks?.delta ?? null,
            gamma: c.greeks?.gamma ?? null,
            theta: c.greeks?.theta ?? null,
            vega: c.greeks?.vega ?? null,
            openInterest: c.open_interest ?? null,
            volume: c.day?.volume ?? null,
          };
          if (c.details.contract_type === "call") {
            byExpiry.get(expiry)!.calls.push(rec);
          } else {
            byExpiry.get(expiry)!.puts.push(rec);
          }
        }
        const today = new Date().getTime();
        const expiries = [...byExpiry.entries()]
          .map(([expiration, { calls, puts }]) => {
            const dteDays = Math.max(
              0,
              Math.round(
                (new Date(`${expiration}T00:00:00Z`).getTime() - today) /
                  86_400_000,
              ),
            );
            calls.sort((a, b) => a.strike - b.strike);
            puts.sort((a, b) => a.strike - b.strike);
            return { expiration, dteDays, calls, puts };
          })
          .sort((a, b) => a.expiration.localeCompare(b.expiration));
        chain = {
          ticker: row.ticker,
          spot,
          asOf: new Date().toISOString().slice(0, 10),
          expiries,
        };
      }
    }
  } catch {
    // Leave chain null — builder will show without it.
  }

  const legs: PositionLeg[] = (row.legs as TradeIdeaLeg[]).map((l) => ({
    type: l.type,
    side: l.side,
    strike: l.strike,
    expiration: l.expiration,
    qty: l.qty,
    entryPrice: l.entryPrice,
    entryIv: l.entryIv,
    contractTicker: l.contractTicker ?? "",
    entryBid: l.entryBid ?? null,
    entryAsk: l.entryAsk ?? null,
  }));

  return (
    <>
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <OptionsSubNav active="risk-graph" />
        <header className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[10px] uppercase tracking-widest text-amber-400">
              Saved trade idea · {row.ticker}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Link
                href="/research/risk-graph/saved"
                className="text-xs text-amber-300 hover:underline"
              >
                ← All saved
              </Link>
              {row.status === "open" && (
                <CloseTradeButton id={row.id} name={row.name} />
              )}
              <DeleteTradeButton id={row.id} name={row.name} variant="header" />
            </div>
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight">{row.name}</h1>
            {row.status === "closed" && row.realizedPnl != null && (
              <span
                className={[
                  "px-2.5 py-0.5 rounded border text-sm font-mono font-bold uppercase tracking-widest",
                  Number(row.realizedPnl) >= 0
                    ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/[0.10]"
                    : "border-rose-500/50 text-rose-300 bg-rose-500/[0.10]",
                ].join(" ")}
              >
                {Number(row.realizedPnl) >= 0 ? "+" : "−"}$
                {Math.abs(Number(row.realizedPnl)).toFixed(0)} realized
              </span>
            )}
            {row.status === "expired" && (
              <span className="px-2.5 py-0.5 rounded border text-sm font-mono font-bold uppercase tracking-widest border-white/20 text-white/55 bg-white/[0.04]">
                Expired
              </span>
            )}
          </div>
          <p className="text-sm text-white/55">
            Saved {row.createdAt.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
            {" · "}
            Entry spot ${Number(row.underlyingSpotAtEntry).toFixed(2)}
            {" · "}
            {Number(row.entryDebit) > 0
              ? `Debit $${Math.abs(Number(row.entryDebit)).toFixed(0)}`
              : `Credit $${Math.abs(Number(row.entryDebit)).toFixed(0)}`}
            {row.status === "closed" && row.closedAt && (
              <>
                {" · "}
                Closed{" "}
                {row.closedAt.toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </>
            )}
          </p>
          {row.notes && (
            <p className="text-sm text-white/65 max-w-3xl pt-2 italic">
              {row.notes}
            </p>
          )}
        </header>

        {chain ? (
          <RiskGraphBuilder
            initial={{ chain, legs, name: row.name }}
            resultsFirst
          />
        ) : (
          <div className="rounded border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300">
            Could not load live chain for {row.ticker}. The saved legs
            are preserved — try refreshing in a moment.
          </div>
        )}
      </main>
    </>
  );
}
