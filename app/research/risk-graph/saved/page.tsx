import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { tradeIdeas, type TradeIdeaLeg } from "@/lib/db/schema";
import SiteHeader from "@/components/SiteHeader";
import OptionsSubNav from "@/components/OptionsSubNav";
import DeleteTradeButton from "@/components/RiskGraph/DeleteTradeButton";
import CloseTradeButton from "@/components/RiskGraph/CloseTradeButton";

export const dynamic = "force-dynamic";

/**
 * /research/risk-graph/saved — list of every saved trade idea.
 *
 * Wave 1: shows name, ticker, leg count, entry debit/credit, created
 * date. Click any row → detail page recreates the chart.
 *
 * Wave 2 (next session): adds latest mark + P&L % per row.
 */
export default async function SavedTradeIdeasPage() {
  const rows = await db
    .select()
    .from(tradeIdeas)
    .orderBy(desc(tradeIdeas.createdAt))
    .limit(100);

  return (
    <>
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <OptionsSubNav active="risk-graph" />
        <header className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[10px] uppercase tracking-widest text-amber-400">
              Risk Graph · Saved trade ideas
            </div>
            <Link
              href="/research/risk-graph"
              className="text-xs text-amber-300 hover:underline"
            >
              ← Build new
            </Link>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Saved ideas</h1>
          <p className="text-sm text-white/55">
            Every trade idea you&apos;ve saved. Click a row to recreate
            the risk graph against the latest live chain.
          </p>
        </header>

        {rows.length === 0 ? (
          <div className="text-sm text-white/55 italic text-center py-12">
            No saved ideas yet. Build one on the{" "}
            <Link
              href="/research/risk-graph"
              className="text-amber-300 hover:underline"
            >
              Risk Graph
            </Link>{" "}
            page and click Save.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-white/55 bg-white/[0.02]">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Ticker</th>
                  <th className="px-3 py-2 text-left">Legs</th>
                  <th className="px-3 py-2 text-right">Entry</th>
                  <th className="px-3 py-2 text-right">Spot @ entry</th>
                  <th className="px-3 py-2 text-right">Realized P&amp;L</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Created</th>
                  <th className="px-3 py-2 text-right" />
                  <th className="px-3 py-2 text-right" />
                  <th className="px-3 py-2 text-right" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const legs = r.legs as TradeIdeaLeg[];
                  const entryDebit = Number(r.entryDebit);
                  const debitTone =
                    entryDebit > 0
                      ? "text-rose-300"
                      : entryDebit < 0
                        ? "text-emerald-300"
                        : "text-white/85";
                  const summary = legs
                    .map(
                      (l) =>
                        `${l.side === "long" ? "+" : "−"}${l.qty} ${l.strike}${l.type === "call" ? "C" : "P"}`,
                    )
                    .join(" / ");
                  return (
                    <tr
                      key={r.id}
                      className="border-t border-white/5 hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="px-3 py-2">
                        <Link
                          href={`/research/risk-graph/saved/${r.id}`}
                          className="font-semibold hover:underline"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 font-mono font-bold">{r.ticker}</td>
                      <td className="px-3 py-2 font-mono text-xs text-white/75">
                        {summary.length > 60 ? summary.slice(0, 60) + "…" : summary}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono ${debitTone}`}>
                        {entryDebit > 0 ? "−" : entryDebit < 0 ? "+" : ""}$
                        {Math.abs(entryDebit).toFixed(0)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-white/75">
                        ${Number(r.underlyingSpotAtEntry).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {r.realizedPnl != null ? (
                          <span
                            className={
                              Number(r.realizedPnl) >= 0
                                ? "text-emerald-300 font-bold"
                                : "text-rose-300 font-bold"
                            }
                          >
                            {Number(r.realizedPnl) >= 0 ? "+" : "−"}$
                            {Math.abs(Number(r.realizedPnl)).toFixed(0)}
                          </span>
                        ) : (
                          <span className="text-white/30">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span
                          className={[
                            "px-2 py-0.5 rounded border uppercase tracking-widest text-[10px]",
                            r.status === "open"
                              ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/[0.08]"
                              : r.status === "closed"
                                ? "border-white/15 text-white/55 bg-white/[0.04]"
                                : "border-rose-500/40 text-rose-300 bg-rose-500/[0.08]",
                          ].join(" ")}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-white/55">
                        {r.createdAt.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.status === "open" ? (
                          <CloseTradeButton
                            id={r.id}
                            name={r.name}
                            variant="row"
                          />
                        ) : (
                          <span className="text-white/30 text-[10px]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/research/risk-graph/saved/${r.id}#risk-graph`}
                          className="inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-widest text-amber-300 hover:bg-amber-500/15 transition-colors"
                          title="Open the risk graph for this trade"
                        >
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 12 12"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            aria-hidden="true"
                          >
                            <path
                              d="M1 10 L4 7 L7 9 L11 2"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              fill="none"
                            />
                          </svg>
                          Risk Graph
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <DeleteTradeButton
                          id={r.id}
                          name={r.name}
                          variant="row"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
