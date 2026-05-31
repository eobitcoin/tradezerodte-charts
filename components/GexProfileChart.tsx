import type { GexStrikeRow } from "@/lib/db/schema";

/**
 * Hand-rolled SVG chart of the per-strike GEX profile.
 *
 *   - Bars at each strike, height proportional to |netGex|
 *   - Color: emerald for positive (long γ → pin), rose for negative
 *     (short γ → squeeze)
 *   - Vertical dashed amber line at the zero-gamma flip strike
 *   - Vertical solid white line at spot
 *
 * No charting library — we have ~30-100 strikes per ticker so SVG
 * with a basic linear scale is plenty. Keeps the deps lean.
 *
 * Strikes are filtered to ±15% of spot before plotting. Polygon's
 * chain includes deep-OTM strikes whose tiny gamma contribution
 * pushes the bar scale down to noise; clipping makes the chart
 * readable on every ticker without per-ticker tuning.
 */

interface Props {
  rows: GexStrikeRow[];
  spot: number;
  zeroGammaStrike: number | null;
  width?: number;
  height?: number;
}

export default function GexProfileChart({
  rows,
  spot,
  zeroGammaStrike,
  width = 800,
  height = 280,
}: Props) {
  if (rows.length === 0 || !Number.isFinite(spot) || spot <= 0) {
    return (
      <p className="text-sm text-white/55 italic">
        No GEX data to plot.
      </p>
    );
  }

  // Clip to ±15% of spot — keeps the bar scale meaningful.
  const lo = spot * 0.85;
  const hi = spot * 1.15;
  const visible = rows.filter((r) => r.strike >= lo && r.strike <= hi);
  if (visible.length === 0) {
    return (
      <p className="text-sm text-white/55 italic">
        No strikes within ±15% of spot. Chain may be illiquid.
      </p>
    );
  }

  // Layout — generous padding so labels don't crash into bars.
  const padding = { top: 16, right: 24, bottom: 36, left: 60 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  // Scales.
  const strikeMin = Math.min(...visible.map((r) => r.strike), lo);
  const strikeMax = Math.max(...visible.map((r) => r.strike), hi);
  const xScale = (s: number) =>
    padding.left + ((s - strikeMin) / (strikeMax - strikeMin)) * plotW;

  const maxAbsGex = Math.max(
    ...visible.map((r) => Math.abs(r.netGex)),
    1,
  );
  // y-axis is symmetric around the midline; positives go up, negatives down.
  const yMid = padding.top + plotH / 2;
  const yScale = (gex: number) => yMid - (gex / maxAbsGex) * (plotH / 2 - 4);

  // Bar width — split the visible strike range into equal slots.
  const barW = Math.max(2, plotW / Math.max(visible.length, 8) * 0.8);

  // Y-axis ticks: just min/zero/max for orientation.
  const yTicks = [
    { label: fmtGexAxis(maxAbsGex), y: yScale(maxAbsGex) },
    { label: "0", y: yMid },
    { label: fmtGexAxis(-maxAbsGex), y: yScale(-maxAbsGex) },
  ];

  // X-axis ticks: 5 evenly-spaced strikes.
  const xTickCount = 5;
  const xTicks = Array.from({ length: xTickCount }, (_, i) => {
    const s = strikeMin + (i / (xTickCount - 1)) * (strikeMax - strikeMin);
    return { strike: s, x: xScale(s) };
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      role="img"
      aria-label="Per-strike dealer gamma profile"
    >
      {/* Y-axis grid + labels */}
      {yTicks.map((t, i) => (
        <g key={`yt-${i}`}>
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={t.y}
            y2={t.y}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1}
            strokeDasharray={i === 1 ? "" : "2 3"}
          />
          <text
            x={padding.left - 6}
            y={t.y + 3}
            textAnchor="end"
            fontSize="10"
            fill="rgba(255,255,255,0.5)"
            fontFamily="ui-monospace, monospace"
          >
            {t.label}
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
          fontSize="10"
          fill="rgba(255,255,255,0.5)"
          fontFamily="ui-monospace, monospace"
        >
          ${t.strike.toFixed(t.strike >= 200 ? 0 : 1)}
        </text>
      ))}

      {/* Bars */}
      {visible.map((r) => {
        const x = xScale(r.strike) - barW / 2;
        const y0 = yMid;
        const y1 = yScale(r.netGex);
        const y = Math.min(y0, y1);
        const h = Math.abs(y1 - y0);
        const fill =
          r.netGex >= 0
            ? "rgba(16, 185, 129, 0.75)"
            : "rgba(244, 63, 94, 0.75)";
        return (
          <rect
            key={r.strike}
            x={x}
            y={y}
            width={barW}
            height={h}
            fill={fill}
            stroke="none"
          />
        );
      })}

      {/* Zero-gamma marker */}
      {zeroGammaStrike != null && zeroGammaStrike >= strikeMin && zeroGammaStrike <= strikeMax && (
        <g>
          <line
            x1={xScale(zeroGammaStrike)}
            x2={xScale(zeroGammaStrike)}
            y1={padding.top}
            y2={height - padding.bottom}
            stroke="rgb(251, 191, 36)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          <text
            x={xScale(zeroGammaStrike)}
            y={padding.top + 10}
            textAnchor="middle"
            fontSize="9"
            fill="rgb(251, 191, 36)"
            fontFamily="ui-monospace, monospace"
            fontWeight="bold"
          >
            ZERO γ ${zeroGammaStrike.toFixed(zeroGammaStrike >= 200 ? 0 : 2)}
          </text>
        </g>
      )}

      {/* Spot marker */}
      <g>
        <line
          x1={xScale(spot)}
          x2={xScale(spot)}
          y1={padding.top}
          y2={height - padding.bottom}
          stroke="rgba(255,255,255,0.7)"
          strokeWidth={1.5}
        />
        <text
          x={xScale(spot)}
          y={height - padding.bottom - 4}
          textAnchor="middle"
          fontSize="9"
          fill="rgba(255,255,255,0.85)"
          fontFamily="ui-monospace, monospace"
          fontWeight="bold"
        >
          SPOT ${spot.toFixed(spot >= 200 ? 0 : 2)}
        </text>
      </g>
    </svg>
  );
}

function fmtGexAxis(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "+";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}
