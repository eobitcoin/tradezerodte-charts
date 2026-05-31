"use client";

/**
 * Risk graph — SVG-based P&L visualization.
 *
 *   - X axis: underlying price (the curves' price grid)
 *   - Y axis: P&L in $ (auto-scaled across all curves)
 *   - One curve per snapshot time (Today, halfway, near expiry, expiry)
 *   - Expiry curve in black/white (the canonical "outcome" curve)
 *   - Intermediate curves in fading amber → emerald gradient
 *   - Zero P&L line + spot vertical marker
 *
 * No charting library — same SVG approach we used for GEX. Keeps deps
 * lean and renders fine for the ~80-point curves we produce.
 */

import type { RiskCurve } from "@/lib/risk-graph";

interface Props {
  curves: RiskCurve[];
  spot: number;
  width?: number;
  height?: number;
}

// Full-opacity, high-contrast palette. Order is the same as the
// snapshot order from computeRiskGraph: Today (pink) → halfway
// (amber) → near-expiry (blue) → expiry (white). Brighter and more
// saturated than the previous 0.85-alpha versions so they pop against
// the dark card background.
const COLORS = [
  "#f472b6",  // pink-400  (today)
  "#fbbf24",  // amber-400 (halfway)
  "#60a5fa",  // blue-400  (near expiry)
  "#ffffff",  // white     (expiry — the canonical outcome curve)
];

export default function RiskGraphChart({
  curves,
  spot,
  width = 900,
  height = 320,
}: Props) {
  if (curves.length === 0 || curves[0].points.length === 0) {
    return (
      <p className="text-sm text-white/55 italic">
        Add a leg to render the risk graph.
      </p>
    );
  }

  const padding = { top: 20, right: 24, bottom: 38, left: 70 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  // X range — same across all curves.
  const xs = curves[0].points.map((p) => p.underlying);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xScale = (x: number) => padding.left + ((x - xMin) / (xMax - xMin)) * plotW;

  // Y range — span of P&L across all curves.
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const c of curves) {
    for (const p of c.points) {
      if (p.pnl < yMin) yMin = p.pnl;
      if (p.pnl > yMax) yMax = p.pnl;
    }
  }
  // Pad 5% on each side so curves don't crash into the frame.
  const yRange = yMax - yMin;
  yMin -= yRange * 0.05;
  yMax += yRange * 0.05;
  const yScale = (y: number) => padding.top + ((yMax - y) / (yMax - yMin)) * plotH;
  const yZero = yScale(0);

  // Y ticks — 5 evenly spaced.
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const v = yMin + (i / 4) * (yMax - yMin);
    return { v, y: yScale(v) };
  });

  // X ticks — 5 evenly spaced.
  const xTicks = Array.from({ length: 5 }, (_, i) => {
    const v = xMin + (i / 4) * (xMax - xMin);
    return { v, x: xScale(v) };
  });

  function pathFor(points: { underlying: number; pnl: number }[]): string {
    return points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.underlying).toFixed(2)} ${yScale(p.pnl).toFixed(2)}`)
      .join(" ");
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs uppercase tracking-widest text-white/75 font-semibold">
          Profit / Loss vs underlying
        </h2>
        {/* Curve legend */}
        <div className="flex flex-wrap gap-3 text-[11px]">
          {curves.map((c, i) => (
            <span key={c.label} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block w-4 h-[3px] rounded-full"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
              />
              <span className="text-white/90 font-medium">{c.label}</span>
            </span>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label="Risk graph: profit/loss vs underlying price across time snapshots"
      >
        {/* Y-axis grid + labels */}
        {yTicks.map((t, i) => (
          <g key={`yt-${i}`}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={t.y}
              y2={t.y}
              stroke="rgba(255,255,255,0.10)"
              strokeWidth={1}
            />
            <text
              x={padding.left - 6}
              y={t.y + 3}
              textAnchor="end"
              fontSize="11"
              fill="rgba(255,255,255,0.78)"
              fontFamily="ui-monospace, monospace"
              fontWeight="500"
            >
              {fmtAxis(t.v)}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {xTicks.map((t, i) => (
          <text
            key={`xt-${i}`}
            x={t.x}
            y={height - padding.bottom + 16}
            textAnchor="middle"
            fontSize="11"
            fill="rgba(255,255,255,0.78)"
            fontFamily="ui-monospace, monospace"
            fontWeight="500"
          >
            ${t.v.toFixed(t.v >= 200 ? 0 : 1)}
          </text>
        ))}

        {/* Zero line (heavier) */}
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={yZero}
          y2={yZero}
          stroke="rgba(255,255,255,0.5)"
          strokeWidth={2}
        />

        {/* Curves */}
        {curves.map((c, i) => {
          const isExpiry = i === curves.length - 1;
          return (
            <path
              key={c.label}
              d={pathFor(c.points)}
              fill="none"
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={isExpiry ? 3 : 2.25}
              strokeDasharray={isExpiry ? "" : "5 3"}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {/* Spot marker */}
        {spot >= xMin && spot <= xMax && (
          <g>
            <line
              x1={xScale(spot)}
              x2={xScale(spot)}
              y1={padding.top}
              y2={height - padding.bottom}
              stroke="rgba(255,255,255,0.9)"
              strokeWidth={2}
            />
            <text
              x={xScale(spot)}
              y={padding.top - 6}
              textAnchor="middle"
              fontSize="11"
              fill="#ffffff"
              fontFamily="ui-monospace, monospace"
              fontWeight="bold"
            >
              SPOT ${spot.toFixed(spot >= 200 ? 0 : 2)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

function fmtAxis(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v < 0 ? "−" : v > 0 ? "+" : "";
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}
