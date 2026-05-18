import Link from "next/link";
import { renderMarkdown } from "@/lib/markdown";
import { gradeColors, sortTradesByGrade, tickerAnchor, cleanStrikeDisplay } from "@/lib/grade";
import type { Post, Trade, PostImage } from "@/lib/db/schema";

function fmt(v: number | string | undefined): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return v;
}

function dirLabel(d?: Trade["direction"]): string {
  if (!d) return "—";
  if (d === "avoid") return "AVOID";
  return d.toUpperCase();
}

function dirClass(d?: Trade["direction"]): string {
  if (d === "call" || d === "long")
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  if (d === "put" || d === "short")
    return "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30";
  if (d === "avoid")
    return "bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50 border-black/10 dark:border-white/10";
  return "bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60 border-black/10 dark:border-white/10";
}

export default async function PostView({ post }: { post: Post }) {
  const trades = (post.trades || []) as Trade[];
  const sortedTrades = sortTradesByGrade(trades);
  const tickers = sortedTrades.map((t) => t.ticker);
  const html = await renderMarkdown(post.bodyMd, tickers);
  const images = (post.images || []) as PostImage[];

  return (
    <article className="max-w-4xl lg:max-w-5xl mx-auto px-4 py-8 space-y-8">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50">
            Trading day · {post.tradingDay}
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
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/calendar/economic"
              className="text-xs text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:underline"
            >
              Economic Calendar →
            </Link>
            <Link
              href="/help"
              className="text-xs text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:underline"
            >
              Help · how to read this →
            </Link>
          </div>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{post.title}</h1>
        {(post.sentiment || post.bias) && (
          <div className="flex gap-2 flex-wrap pt-1">
            {post.sentiment && (
              <span className="inline-block px-2 py-0.5 text-xs rounded-full border border-black/15 dark:border-white/15">
                Sentiment: {post.sentiment}
              </span>
            )}
            {post.bias && (
              <span className="inline-block px-2 py-0.5 text-xs rounded-full border border-black/15 dark:border-white/15">
                Bias: {post.bias}
              </span>
            )}
          </div>
        )}
      </header>

      {sortedTrades.length > 0 && (
        <section aria-labelledby="trade-summary" className="space-y-3">
          <h2 id="trade-summary" className="text-sm font-semibold uppercase tracking-wide">
            Trade summary
          </h2>
          <div className="overflow-x-auto border border-black/10 dark:border-white/10 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
                <tr className="text-left">
                  <th className="px-3 py-2 w-10">#</th>
                  <th className="px-3 py-2">Ticker</th>
                  <th className="px-3 py-2">Grade</th>
                  <th className="px-3 py-2">Dir</th>
                  <th className="px-3 py-2">Strike</th>
                  <th className="px-3 py-2">Entry</th>
                  <th className="px-3 py-2">T1</th>
                  <th className="px-3 py-2">T2</th>
                  <th className="px-3 py-2">Stop</th>
                  <th className="px-3 py-2">Time stop</th>
                </tr>
              </thead>
              <tbody>
                {sortedTrades.map((t, i) => {
                  const gc = gradeColors(t.grade);
                  return (
                    <tr
                      key={t.ticker + i}
                      className="border-t border-black/10 dark:border-white/10 align-top"
                    >
                      <td className="px-3 py-2 text-black/50 dark:text-white/50">{i + 1}</td>
                      <td className="px-3 py-2 font-mono font-semibold">
                        <a
                          href={`#${tickerAnchor(t.ticker)}`}
                          className="hover:underline underline-offset-4"
                        >
                          {t.ticker}
                        </a>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-semibold rounded border ${gc.pill}`}
                        >
                          {t.grade ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs rounded border ${dirClass(t.direction)}`}
                        >
                          {dirLabel(t.direction)}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono">{cleanStrikeDisplay(t.strike)}</td>
                      <td className="px-3 py-2 font-mono">{t.entry_zone || fmt(undefined)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(t.target1)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(t.target2)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(t.stop)}</td>
                      <td className="px-3 py-2">{t.time_stop || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sortedTrades.some((t) => t.rationale) && (
            <ul className="space-y-1 text-sm text-black/80 dark:text-white/80">
              {sortedTrades
                .filter((t) => t.rationale)
                .map((t, i) => {
                  const gc = gradeColors(t.grade);
                  return (
                    <li key={t.ticker + i} className="flex items-baseline gap-2">
                      <span
                        className={`shrink-0 inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded border ${gc.pill}`}
                      >
                        {t.grade}
                      </span>
                      <a
                        href={`#${tickerAnchor(t.ticker)}`}
                        className="font-mono font-semibold hover:underline underline-offset-4"
                      >
                        {t.ticker}
                      </a>
                      <span>·</span>
                      <span>{t.rationale}</span>
                    </li>
                  );
                })}
            </ul>
          )}
        </section>
      )}

      <section
        className="prose prose-neutral dark:prose-invert max-w-none dte-post"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {images.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide">Charts</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {images.map((img) => (
              <figure key={img.key} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.alt || ""}
                  loading="lazy"
                  className="w-full rounded-lg border border-black/10 dark:border-white/10"
                />
                {img.alt && (
                  <figcaption className="text-xs text-black/60 dark:text-white/60">
                    {img.alt}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
