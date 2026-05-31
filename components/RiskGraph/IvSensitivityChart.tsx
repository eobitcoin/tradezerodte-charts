"use client";

/**
 * Vega-time chart — IV sensitivity at multiple snapshot times.
 *
 *   - Y axis: absolute implied volatility (%), baseline ± 20 points
 *   - X axis: total position P&L ($) at that (IV, time) combo
 *   - One curve per snapshot time (Today, halfway, near expiry, expiry)
 *   - Spot is HELD CONSTANT at the current value — this isolates the
 *     vol/time effects from the directional effect (covered by the
 *     price chart)
 *   - Horizontal baseline at the current IV (where the IV-shift slider
 *     would be 0). All curves cross zero P&L at the same IV if and
 *     only if the position is exactly delta+vega flat — useful sanity
 *     check.
 *
 * Why this chart matters: the price chart answers "what if SPY moves?";
 * this chart answers "what if vol moves?". For event trades (earnings,
 * Fed) the IV move often dominates the price move — this chart shows
 * the vega exposure shape directly.
 */

import type { IvCurve } from "@/lib/risk-graph";

interface Props {
  curves: IvCurve[];
  /** Position's baseline IV (decimal). Drawn as a horizontal reference
   *  line. Y-axis labels are computed as baselineIv + shift. */
  baselineIv: number;
  width?: number;
  height?: number;
}

// Same palette + ordering as the price chart so the legends are
// directly comparable: Today (pink) → halfway (amber) → near-expiry
// (blue) → expiry (white).
// Same full-opacity palette as the price chart so the curve legends
// across both charts identify the same snapshot color-to-color.
const COLORS = [
  "#f472b6",  // pink-400  (today)
  "#fbbf24",  // amber-400 (halfway)
  "#60a5fa",  // blue-400  (near expiry)
  "#ffffff",  // white     (expiry)
];

export default function IvSensitivityChart({
  curves,
  baselineIv,
  width = 480,
  height = 380,
}: Props) {
  if (curves.length === 0 || curves[0].points.length === 0) {
    return (
      <p className="text-sm text-white/55 italic">
        Add a leg to render the IV sensitivity chart.
      </p>
    );
  }

  const padding = { top: 20, right: 24, bottom: 38, left: 64 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  // Y range — IV shift values are uniform across curves; use the first
  // curve's grid. Absolute IV = baselineIv + shift.
  const shifts = curves[0].points.map((p) => p.ivShift);
  const yMinShift = Math.min(...shifts);
  const yMaxShift = Math.max(...shifts);
  const yScale = (shift: number) =>
    padding.top +
    ((yMaxShift - shift) / (yMaxShift - yMinShift)) * plotH;

  // X range — span of P&L across all curves, padded 5%.
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const c of curves) {
    for (const p of c.points) {
      if (p.pnl < xMin) xMin = p.pnl;
      if (p.pnl > xMax) xMax = p.pnl;
    }
  }
  const xRange = xMax - xMin;
  xMin -= xRange * 0.05;
  xMax += xRange * 0.05;
  const xScale = (pnl: number) =>
    padding.left + ((pnl - xMin) / (xMax - xMin)) * plotW;
  const xZero = xScale(0);

  // Y ticks — 5 evenly-spaced absolute IV labels.
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const shift = yMinShift + (i / 4) * (yMaxShift - yMinShift);
    return { shift, absIv: baselineIv + shift, y: yScale(shift) };
  });

  // X ticks — 5 evenly-spaced P&L labels.
  const xTicks = Array.from({ length: 5 }, (_, i) => {
    const v = xMin + (i / 4) * (xMax - xMin);
    return { v, x: xScale(v) };
  });

  function pathFor(points: { ivShift: number; pnl: number }[]): string {
    return points
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"} ${xScale(p.pnl).toFixed(2)} ${yScale(
            p.ivShift,
          ).toFixed(2)}`,
      )
      .join(" ");
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs uppercase tracking-widest text-white/75 font-semibold">
          IV sensitivity (spot held constant)
        </h2>
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
        aria-label="Volatility sensitivity: P&L vs implied volatility, across time snapshots"
      >
        {/* Y-axis grid + labels (IV %) */}
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
              {(t.absIv * 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {/* X-axis labels (P&L $) */}
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
            {fmtPnl(t.v)}
          </text>
        ))}

        {/* Baseline IV horizontal reference */}
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={yScale(0)}
          y2={yScale(0)}
          stroke="rgba(251, 191, 36, 0.85)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        <text
          x={width - padding.right - 4}
          y={yScale(0) - 5}
          textAnchor="end"
          fontSize="10"
          fill="#fbbf24"
          fontFamily="ui-monospace, monospace"
          fontWeight="bold"
        >
          BASELINE {(baselineIv * 100).toFixed(0)}%
        </text>

        {/* Zero P&L vertical reference */}
        {xZero >= padding.left && xZero <= width - padding.right && (
          <line
            x1={xZero}
            x2={xZero}
            y1={padding.top}
            y2={height - padding.bottom}
            stroke="rgba(255,255,255,0.5)"
            strokeWidth={2}
          />
        )}

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

        {/* Axis labels */}
        <text
          x={padding.left + plotW / 2}
          y={height - 4}
          textAnchor="middle"
          fontSize="11"
          fill="rgba(255,255,255,0.78)"
          fontFamily="ui-sans-serif, sans-serif"
          fontWeight="600"
        >
          P&L ($)
        </text>
        <text
          x={14}
          y={padding.top + plotH / 2}
          textAnchor="middle"
          fontSize="11"
          fill="rgba(255,255,255,0.78)"
          fontFamily="ui-sans-serif, sans-serif"
          fontWeight="600"
          transform={`rotate(-90 14 ${padding.top + plotH / 2})`}
        >
          Implied Volatility
        </text>
      </svg>
    </div>
  );
}

function fmtPnl(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v < 0 ? "−" : v > 0 ? "+" : "";
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}
