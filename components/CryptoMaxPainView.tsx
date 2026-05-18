import type { CryptoMaxPainStats } from "@/lib/crypto-maxpain";

function fmtUsd(n: number | undefined | null, opts: { compact?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (opts.compact && n >= 1000) {
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  if (n >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (n >= 10) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

function fmtSignedB(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)} $B/1%`;
}

function fmtSignedM(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)} $M`;
}

function fmtPct(n: number | undefined | null, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(decimals)}%`;
}

function deltaPct(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b === 0) return undefined;
  return ((a - b) / b) * 100;
}

function fmtNumber(n: number | undefined | null, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function regimePill(regime: CryptoMaxPainStats["regime"]): { label: string; cls: string } {
  if (regime === "POS") {
    return { label: "POS GEX", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40" };
  }
  if (regime === "NEG") {
    return { label: "NEG GEX", cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40" };
  }
  return { label: "NEAR FLIP", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40" };
}

function KeyTile({
  label,
  value,
  delta,
  highlight,
}: {
  label: string;
  value: string;
  delta?: string;
  highlight?: "buy" | "sell" | "neutral";
}) {
  const ring =
    highlight === "buy"
      ? "ring-1 ring-emerald-500/30"
      : highlight === "sell"
      ? "ring-1 ring-rose-500/30"
      : "";
  return (
    <div className={`rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 ${ring}`}>
      <div className="text-[10px] uppercase tracking-wide text-black/55 dark:text-white/55">{label}</div>
      <div className="mt-0.5 font-mono text-base font-semibold">{value}</div>
      {delta && (
        <div className="text-[10px] text-black/50 dark:text-white/50">{delta}</div>
      )}
    </div>
  );
}

export default function CryptoMaxPainView({ stats }: { stats: CryptoMaxPainStats }) {
  const { currency, spot, frontMaxPain, totalGEX, flipStrike, callWall, putWall, regime, expirations, totalOI } = stats;
  const rp = regimePill(regime);

  return (
    <section className="space-y-3">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-xl font-bold tracking-tight">{currency}</h2>
        <span className="font-mono text-base font-semibold">{fmtUsd(spot)}</span>
        <span
          className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-mono font-semibold tracking-wide ${rp.cls}`}
        >
          {rp.label}
        </span>
        <span className="text-xs text-black/50 dark:text-white/50">
          {fmtNumber(totalOI)} contracts OI · {expirations.length} expiries
        </span>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KeyTile
          label="Front max pain"
          value={fmtUsd(frontMaxPain)}
          delta={fmtPct(deltaPct(frontMaxPain, spot))}
        />
        <KeyTile
          label="Call wall"
          value={fmtUsd(callWall)}
          delta={fmtPct(deltaPct(callWall, spot))}
          highlight="buy"
        />
        <KeyTile
          label="Put wall"
          value={fmtUsd(putWall)}
          delta={fmtPct(deltaPct(putWall, spot))}
          highlight="sell"
        />
        <KeyTile
          label="Zero-gamma flip"
          value={fmtUsd(flipStrike)}
          delta={fmtPct(deltaPct(flipStrike, spot))}
        />
      </div>

      <div className="text-xs text-black/55 dark:text-white/55">
        Total GEX: <span className="font-mono font-semibold">{fmtSignedB(totalGEX)}</span>
        {" · "}
        Source: Deribit (live, cached 60s)
      </div>

      <div className="overflow-x-auto border border-black/10 dark:border-white/10 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
            <tr className="text-left">
              <th className="px-3 py-2 w-32">Expiry</th>
              <th className="px-3 py-2 w-12 text-right">DTE</th>
              <th className="px-3 py-2 text-right">Max Pain</th>
              <th className="px-3 py-2 text-right">Δ vs spot</th>
              <th className="px-3 py-2 text-right">Call OI</th>
              <th className="px-3 py-2 text-right">Put OI</th>
              <th className="px-3 py-2 text-right">P/C</th>
              <th className="px-3 py-2 text-right">Net GEX</th>
            </tr>
          </thead>
          <tbody>
            {expirations.map((e, i) => {
              const isFront = i === 0;
              return (
                <tr
                  key={e.exp}
                  className={[
                    "border-t border-black/10 dark:border-white/10",
                    isFront ? "bg-emerald-500/[0.04]" : "",
                  ].join(" ")}
                >
                  <td className="px-3 py-1.5 font-mono">{e.exp}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{e.dte}d</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmtUsd(e.maxPain)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">
                    {fmtPct(deltaPct(e.maxPain, spot))}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{fmtNumber(e.callOI, 0)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{fmtNumber(e.putOI, 0)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">
                    {e.pcRatio == null ? "—" : e.pcRatio.toFixed(2)}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right font-mono text-xs ${
                      (e.netGEX ?? 0) > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : (e.netGEX ?? 0) < 0
                        ? "text-rose-600 dark:text-rose-400"
                        : ""
                    }`}
                  >
                    {fmtSignedM(e.netGEX)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
