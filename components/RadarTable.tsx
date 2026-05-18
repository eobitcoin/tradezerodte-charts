import {
  RADAR_TIMEFRAMES,
  TIMEFRAME_LABEL,
  type RadarRow,
  type RadarCell,
  type EquityQuote,
  relativeTime,
} from "@/lib/radar";

function signalPillClasses(signal: RadarCell["signal"]): string {
  if (signal === "buy") {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40";
  }
  if (signal === "sell") {
    return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40";
  }
  if (signal === "neutral") {
    return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
  }
  return "bg-black/[0.04] dark:bg-white/[0.04] text-black/40 dark:text-white/40 border-black/10 dark:border-white/10";
}

function signalLabel(signal: RadarCell["signal"]): string {
  if (signal === "buy") return "BUY";
  if (signal === "sell") return "SELL";
  if (signal === "neutral") return "NEUT";
  return "—";
}

function rowAccent(allAgree: RadarRow["allAgree"]): string {
  if (allAgree === "buy") return "bg-emerald-500/[0.06] hover:bg-emerald-500/[0.10]";
  if (allAgree === "sell") return "bg-rose-500/[0.06] hover:bg-rose-500/[0.10]";
  return "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]";
}

function fmtPrice(p: number | null): string | null {
  if (p == null || !Number.isFinite(p)) return null;
  return `$${p.toFixed(2)}`;
}

function fmtCurrentPrice(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return "—";
  if (p >= 1000) return `$${p.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${p.toFixed(2)}`;
}

function ChangePct({ pct }: { pct: number | null }) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const cls =
    pct > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : pct < 0
      ? "text-rose-600 dark:text-rose-400"
      : "text-black/50 dark:text-white/50";
  const sign = pct > 0 ? "+" : "";
  return <span className={`text-[11px] font-mono ${cls}`}>{sign}{pct.toFixed(2)}%</span>;
}

function CellView({ cell }: { cell: RadarCell }) {
  const ts = cell.signalAt ?? cell.createdAt;
  const sub = cell.indicator ?? (cell.signal ? "" : "no signal yet");
  const priceStr = fmtPrice(cell.price);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-1.5">
        <span
          className={[
            "inline-block px-2 py-0.5 rounded-full border text-[11px] font-mono font-semibold tracking-wide",
            signalPillClasses(cell.signal),
          ].join(" ")}
        >
          {signalLabel(cell.signal)}
        </span>
        {priceStr && (
          <span
            className="font-mono text-[11px] font-semibold text-black/75 dark:text-white/75"
            title="Price at the time the signal fired"
          >
            {priceStr}
          </span>
        )}
      </div>
      {(sub || ts) && (
        <div className="text-[10px] leading-tight text-black/55 dark:text-white/55 max-w-[180px]">
          {sub && <div className="truncate" title={sub}>{sub}</div>}
          {ts && <div className="text-black/40 dark:text-white/40">{relativeTime(ts)}</div>}
        </div>
      )}
    </div>
  );
}

export default function RadarTable({
  rows,
  quotes,
  now,
}: {
  rows: RadarRow[];
  quotes: EquityQuote[];
  now: Date;
}) {
  const quoteByTicker = new Map(quotes.map((q) => [q.ticker, q]));

  // Stable display order: rows where all 3 agree first (buy then sell), then alpha by ticker.
  const sorted = [...rows].sort((a, b) => {
    const rank = (r: RadarRow) =>
      r.allAgree === "buy" ? 0 : r.allAgree === "sell" ? 1 : 2;
    const rDiff = rank(a) - rank(b);
    if (rDiff !== 0) return rDiff;
    return a.ticker.localeCompare(b.ticker);
  });

  const buyAgreeCount = rows.filter((r) => r.allAgree === "buy").length;
  const sellAgreeCount = rows.filter((r) => r.allAgree === "sell").length;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        {buyAgreeCount > 0 && (
          <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
            {buyAgreeCount} all-bullish
          </span>
        )}
        {sellAgreeCount > 0 && (
          <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
            {sellAgreeCount} all-bearish
          </span>
        )}
        <span className="text-xs text-black/50 dark:text-white/50">
          Live spot prices via Tradier · refresh the page for newer signals
        </span>
      </div>

      <div className="overflow-x-auto border border-black/10 dark:border-white/10 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
            <tr className="text-left">
              <th className="px-3 py-2 w-24">Ticker</th>
              <th className="px-3 py-2 w-32">Current Price</th>
              {RADAR_TIMEFRAMES.map((tf) => (
                <th key={tf} className="px-3 py-2">
                  {TIMEFRAME_LABEL[tf]}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Last update</th>
              <th className="px-3 py-2 w-20 text-center">All agree</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const q = quoteByTicker.get(row.ticker);
              return (
              <tr
                key={row.ticker}
                className={[
                  "border-t border-black/10 dark:border-white/10 align-top transition-colors",
                  rowAccent(row.allAgree),
                ].join(" ")}
              >
                <td className="px-3 py-2 font-mono font-semibold">{row.ticker}</td>
                <td className="px-3 py-2">
                  <div className="font-mono text-sm font-semibold">{fmtCurrentPrice(q?.last ?? null)}</div>
                  <ChangePct pct={q?.change_pct ?? null} />
                </td>
                {RADAR_TIMEFRAMES.map((tf) => (
                  <td key={tf} className="px-3 py-2">
                    <CellView cell={row.cells[tf]} />
                  </td>
                ))}
                <td className="px-3 py-2 text-right text-xs text-black/55 dark:text-white/55">
                  {relativeTime(row.latestAt, now)}
                </td>
                <td className="px-3 py-2 text-center">
                  {row.allAgree === "buy" && (
                    <span className="text-emerald-600 dark:text-emerald-400 text-lg" title="All 3 timeframes BUY">
                      ▲▲▲
                    </span>
                  )}
                  {row.allAgree === "sell" && (
                    <span className="text-rose-600 dark:text-rose-400 text-lg" title="All 3 timeframes SELL">
                      ▼▼▼
                    </span>
                  )}
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-black/50 dark:text-white/50 leading-relaxed">
        <p className="mb-1"><strong>How it works:</strong> &quot;Current Price&quot; is fetched live from Tradier at page load. Signals are sent from TradingView alerts (per ticker × timeframe) via webhook. Each cell shows the latest signal for that timeframe. Rows where all 3 timeframes agree appear at the top.</p>
        <p>Color: <span className="text-emerald-600 dark:text-emerald-400 font-semibold">BUY</span> = bullish, <span className="text-rose-600 dark:text-rose-400 font-semibold">SELL</span> = bearish, <span className="text-amber-600 dark:text-amber-400 font-semibold">NEUT</span> = neutral/exit, <span className="text-black/40 dark:text-white/40">—</span> = no signal received yet.</p>
      </div>
    </div>
  );
}
