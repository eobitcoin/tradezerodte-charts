import { renderMarkdown } from "@/lib/markdown";
import type { CryptoPost, CryptoTrade } from "@/lib/db/schema";

function biasPill(bias?: CryptoTrade["bias"]): { label: string; cls: string } {
  if (bias === "long") {
    return {
      label: "LONG",
      cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40",
    };
  }
  if (bias === "short") {
    return {
      label: "SHORT",
      cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40",
    };
  }
  if (bias === "neutral") {
    return {
      label: "NEUT",
      cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    };
  }
  if (bias === "avoid") {
    return {
      label: "AVOID",
      cls: "bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60 border-black/15",
    };
  }
  return {
    label: "—",
    cls: "bg-black/[0.04] dark:bg-white/[0.04] text-black/40 dark:text-white/40 border-black/10",
  };
}

function fmtPriceish(v: CryptoTrade["target1"]): string {
  if (v == null) return "—";
  if (typeof v === "number") {
    if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    if (v >= 10) return `$${v.toFixed(2)}`;
    if (v >= 1) return `$${v.toFixed(3)}`;
    return `$${v.toFixed(4)}`;
  }
  return String(v);
}

function displayCryptoTicker(t: string): string {
  // BTCUSDT -> "BTC / USDT"
  if (t.endsWith("USDT") && t.length > 4) return `${t.slice(0, -4)} / USDT`;
  return t;
}

export default async function CryptoResearchView({ post }: { post: CryptoPost }) {
  const html = await renderMarkdown(post.bodyMd, []);
  const trades = (post.trades ?? []) as CryptoTrade[];

  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50">
          Scan day · {post.scanDay}
          {post.runAt && (
            <>
              {" · Run at "}
              {new Date(post.runAt).toLocaleString("en-US", {
                timeZone: "America/New_York",
                dateStyle: "short",
                timeStyle: "short",
              })}
              {" ET"}
            </>
          )}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{post.title}</h1>
        {post.headline && (
          <p className="text-base text-black/70 dark:text-white/70 leading-snug">{post.headline}</p>
        )}
      </header>

      {trades.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide">Trade plans</h2>
          <div className="overflow-x-auto border border-black/10 dark:border-white/10 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
                <tr className="text-left">
                  <th className="px-3 py-2 w-32">Ticker</th>
                  <th className="px-3 py-2 w-20">Bias</th>
                  <th className="px-3 py-2">Entry</th>
                  <th className="px-3 py-2 w-24 text-right">Target 1</th>
                  <th className="px-3 py-2 w-24 text-right">Target 2</th>
                  <th className="px-3 py-2 w-24 text-right">Stop</th>
                  <th className="px-3 py-2">Rationale</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => {
                  const bp = biasPill(t.bias);
                  return (
                    <tr
                      key={`${t.ticker}-${i}`}
                      className="border-t border-black/10 dark:border-white/10 align-top"
                    >
                      <td className="px-3 py-2 font-mono font-semibold">
                        {displayCryptoTicker(t.ticker)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-mono font-semibold tracking-wide ${bp.cls}`}
                        >
                          {bp.label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs">{t.entry_zone || "—"}</div>
                        {t.entry_trigger && (
                          <div className="text-[11px] text-black/55 dark:text-white/55 mt-0.5">
                            Trigger: {t.entry_trigger}
                          </div>
                        )}
                        {t.time_horizon && (
                          <div className="text-[10px] uppercase tracking-wide text-black/40 dark:text-white/40 mt-0.5">
                            {t.time_horizon}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {fmtPriceish(t.target1)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {fmtPriceish(t.target2)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {fmtPriceish(t.stop)}
                      </td>
                      <td className="px-3 py-2 text-xs text-black/70 dark:text-white/70">
                        {t.rationale || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {post.bodyMd && (
        <section
          className="prose prose-neutral dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </article>
  );
}
