import Link from "next/link";
import { renderMarkdown } from "@/lib/markdown";
import type { InsiderPost, InsiderBuy } from "@/lib/db/schema";

function fmtUsd(n?: number): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtShares(n?: number): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function positionPill(pt?: InsiderBuy["position_type"]): { label: string; cls: string } {
  if (pt === "new") {
    return {
      label: "NEW",
      cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    };
  }
  if (pt === "addition") {
    return {
      label: "ADD",
      cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
    };
  }
  return {
    label: "—",
    cls: "bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60 border-black/10 dark:border-white/10",
  };
}

export default async function InsiderView({ post }: { post: InsiderPost }) {
  const buys = (post.buys || []) as InsiderBuy[];
  // Sort by total_value descending (largest buys first)
  const sortedBuys = [...buys].sort((a, b) => (b.total_value ?? 0) - (a.total_value ?? 0));
  const html = await renderMarkdown(post.bodyMd, []);
  const totalValue = buys.reduce((sum, b) => sum + (b.total_value ?? 0), 0);

  return (
    <article className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50">
            Scan day · {post.scanDay}
            {post.runAt && (
              <>
                {" · Run at "}
                {new Date(post.runAt).toLocaleString("en-US", {
                  timeZone: "America/New_York",
                  dateStyle: "short",
                  timeStyle: "short",
                })}{" ET"}
              </>
            )}
          </div>
          <Link
            href="/learn/insider-buys"
            className="text-xs text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:underline"
          >
            Help · how to read this →
          </Link>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{post.title}</h1>
        {buys.length > 0 && (
          <div className="flex gap-3 pt-1 text-sm">
            <span className="inline-block px-2 py-0.5 text-xs rounded-full border border-black/15 dark:border-white/15">
              {buys.length} qualifying {buys.length === 1 ? "buy" : "buys"}
            </span>
            {totalValue > 0 && (
              <span className="inline-block px-2 py-0.5 text-xs rounded-full border border-black/15 dark:border-white/15">
                Total: {fmtUsd(totalValue)}
              </span>
            )}
          </div>
        )}
      </header>

      {sortedBuys.length > 0 && (
        <section aria-labelledby="insider-buys" className="space-y-3">
          <h2 id="insider-buys" className="text-sm font-semibold uppercase tracking-wide">
            Insider purchases (largest first)
          </h2>
          <div className="overflow-x-auto border border-black/10 dark:border-white/10 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
                <tr className="text-left">
                  <th className="px-3 py-2 w-10">#</th>
                  <th className="px-3 py-2">Ticker</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Executive</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2 text-right">Shares</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Filing</th>
                </tr>
              </thead>
              <tbody>
                {sortedBuys.map((b, i) => {
                  const pp = positionPill(b.position_type);
                  return (
                    <tr key={b.ticker + i} className="border-t border-black/10 dark:border-white/10 align-top">
                      <td className="px-3 py-2 text-black/50 dark:text-white/50">{i + 1}</td>
                      <td className="px-3 py-2 font-mono font-semibold">{b.ticker}</td>
                      <td className="px-3 py-2">{b.company}</td>
                      <td className="px-3 py-2">{b.executive}</td>
                      <td className="px-3 py-2 text-black/70 dark:text-white/70">{b.title || "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtShares(b.shares)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{fmtUsd(b.total_value)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 text-xs rounded border ${pp.cls}`}>
                          {pp.label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {b.filing_url ? (
                          <a
                            href={b.filing_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs underline underline-offset-4"
                          >
                            view
                          </a>
                        ) : (
                          <span className="text-black/40 dark:text-white/40 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section
        className="prose prose-neutral dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
