"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Cryptobubbles-style packed-bubble chart for sector flow.
 *
 * Bubble SIZE = √(|netFlow|) scaled to viewport — net aggressor flow
 * (buy − sell shares) over the selected timeframe.
 *
 * Bubble COLOR = priceChangePct mapped to a red↔neutral↔green gradient.
 *
 * The component owns its own polling loop (every 90s) and timeframe
 * state. Layout uses a deterministic collision-resolution pack so the
 * 22 bubbles arrange themselves with no d3 dependency.
 */

type Timeframe = "5m" | "1h" | "1d" | "1w";

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: "5m", label: "5m" },
  { value: "1h", label: "1h" },
  { value: "1d", label: "1d" },
  { value: "1w", label: "1w" },
];

interface TickerAgg {
  ticker: string;
  group: string;
  buyVolume: number;
  sellVolume: number;
  ambiguousVolume: number;
  totalVolume: number;
  netFlow: number;
  notionalUsd: number;
  priceChangePct: number | null;
  openPrice: number | null;
  closePrice: number | null;
  tradeCount: number;
  firstWindowStart: string | null;
  lastWindowEnd: string | null;
}

interface ApiResponse {
  ok: boolean;
  timeframe: Timeframe;
  timeframeLabel: string;
  windowStart: string;
  universeSize: number;
  tickers: TickerAgg[];
}

interface PackedNode extends TickerAgg {
  x: number;
  y: number;
  r: number;
}

const VIEW_W = 800;
const VIEW_H = 520;
const CENTER_X = VIEW_W / 2;
const CENTER_Y = VIEW_H / 2;
const MIN_R = 24;
const MAX_R = 110;

/** Map priceChangePct → CSS color in a red↔neutral↔green gradient. */
function colorForPct(pct: number | null): string {
  if (pct == null) return "rgba(120, 120, 140, 0.35)";
  const clamped = Math.max(-5, Math.min(5, pct)); // saturate beyond ±5%
  const t = (clamped + 5) / 10; // 0..1
  // Red (#ef4444) → grey (#52525b) → green (#10b981)
  const r = t < 0.5 ? lerp(239, 82, t * 2) : lerp(82, 16, (t - 0.5) * 2);
  const g = t < 0.5 ? lerp(68, 82, t * 2) : lerp(82, 185, (t - 0.5) * 2);
  const b = t < 0.5 ? lerp(68, 91, t * 2) : lerp(91, 129, (t - 0.5) * 2);
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Pack bubbles using simple iterative collision + center attraction. */
function packBubbles(data: TickerAgg[]): PackedNode[] {
  if (data.length === 0) return [];

  // Size scale: r = sqrt(|netFlow|) × k, clamped. Fall back to totalVolume
  // when netFlow is tiny so empty-data tickers still get a visible bubble.
  const sizeMetric = (t: TickerAgg) =>
    Math.abs(t.netFlow) > 0 ? Math.sqrt(Math.abs(t.netFlow)) : Math.sqrt(t.totalVolume || 1);
  const maxMetric = Math.max(...data.map(sizeMetric), 1);
  const k = MAX_R / maxMetric;

  const nodes: PackedNode[] = data.map((d, i) => {
    const r = Math.max(MIN_R, Math.min(MAX_R, sizeMetric(d) * k));
    // Initial position: spiral out from center so bubbles don't all stack.
    const angle = (i / data.length) * Math.PI * 2;
    const radius = 50 + i * 18;
    return {
      ...d,
      r,
      x: CENTER_X + Math.cos(angle) * radius,
      y: CENTER_Y + Math.sin(angle) * radius,
    };
  });

  // Iterative collision + weak center attraction. ~200 iters converges
  // for 22 nodes in a few ms.
  const PAD = 2;
  for (let iter = 0; iter < 220; iter++) {
    // Center attraction.
    for (const n of nodes) {
      const dx = CENTER_X - n.x;
      const dy = CENTER_Y - n.y;
      n.x += dx * 0.02;
      n.y += dy * 0.02;
    }
    // Pairwise collision.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const minDist = a.r + b.r + PAD;
        if (dist < minDist) {
          const push = (minDist - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        }
      }
    }
    // Clamp inside viewport.
    for (const n of nodes) {
      n.x = Math.max(n.r, Math.min(VIEW_W - n.r, n.x));
      n.y = Math.max(n.r, Math.min(VIEW_H - n.r, n.y));
    }
  }

  return nodes;
}

function formatVol(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

function formatPct(p: number | null): string {
  if (p == null) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(2)}%`;
}

export default function SectorBubbles() {
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const [data, setData] = useState<TickerAgg[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/sector-flow?timeframe=${timeframe}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: ApiResponse = await res.json();
        if (cancelled) return;
        setData(json.tickers);
        setUpdatedAt(new Date());
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    // Auto-poll every 90s.
    pollRef.current = window.setInterval(load, 90_000);
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [timeframe]);

  const packed = useMemo(() => (data ? packBubbles(data) : []), [data]);

  const hoveredNode = useMemo(
    () => (hovered ? packed.find((n) => n.ticker === hovered) ?? null : null),
    [hovered, packed],
  );

  return (
    <div className="w-full">
      {/* Header bar — timeframe toggle + updated stamp */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-1 border border-black/10 dark:border-white/15 rounded-md overflow-hidden">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              type="button"
              onClick={() => setTimeframe(tf.value)}
              className={`px-3 py-1 text-xs font-semibold transition-colors ${
                timeframe === tf.value
                  ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                  : "hover:bg-black/5 dark:hover:bg-white/5 text-black/60 dark:text-white/60"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
        <div className="text-[11px] uppercase tracking-wider text-black/40 dark:text-white/40">
          {error ? (
            <span className="text-red-500">error: {error}</span>
          ) : updatedAt ? (
            <>updated {updatedAt.toLocaleTimeString()}</>
          ) : (
            <>loading…</>
          )}
        </div>
      </div>

      {/* Bubble chart */}
      <div className="relative w-full rounded-lg bg-black/95 dark:bg-black/90 ring-1 ring-white/5">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full h-auto"
          preserveAspectRatio="xMidYMid meet"
        >
          {packed.map((n) => {
            const fill = colorForPct(n.priceChangePct);
            const isHover = hovered === n.ticker;
            return (
              <g
                key={n.ticker}
                transform={`translate(${n.x},${n.y})`}
                onMouseEnter={() => setHovered(n.ticker)}
                onMouseLeave={() => setHovered(null)}
                className="cursor-pointer"
              >
                <circle
                  r={n.r}
                  fill={fill}
                  fillOpacity={0.85}
                  stroke={isHover ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.15)"}
                  strokeWidth={isHover ? 2 : 1}
                  style={{
                    filter: `drop-shadow(0 0 ${Math.min(20, n.r / 3)}px ${fill})`,
                    transition: "stroke 120ms ease, stroke-width 120ms ease",
                  }}
                />
                <text
                  textAnchor="middle"
                  fill="white"
                  fontWeight={700}
                  fontFamily="ui-sans-serif, system-ui, -apple-system"
                  fontSize={Math.max(11, Math.min(22, n.r * 0.32))}
                  y={n.r > 36 ? -2 : 0}
                  style={{ pointerEvents: "none" }}
                >
                  {n.ticker}
                </text>
                {n.r > 36 && (
                  <text
                    textAnchor="middle"
                    fill="white"
                    fontFamily="ui-sans-serif, system-ui, -apple-system"
                    fontSize={Math.max(10, Math.min(15, n.r * 0.2))}
                    y={n.r * 0.34}
                    style={{ pointerEvents: "none", opacity: 0.85 }}
                  >
                    {formatPct(n.priceChangePct)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip */}
        {hoveredNode && (
          <div className="pointer-events-none absolute top-2 right-2 bg-black/85 backdrop-blur-sm ring-1 ring-white/10 rounded px-3 py-2 text-xs text-white space-y-0.5">
            <div className="font-mono font-bold text-sm">{hoveredNode.ticker}</div>
            <div className="text-white/60">{hoveredNode.group}</div>
            <div>
              Price:{" "}
              <span
                className={
                  hoveredNode.priceChangePct == null
                    ? "text-white/50"
                    : hoveredNode.priceChangePct >= 0
                      ? "text-emerald-400"
                      : "text-red-400"
                }
              >
                {formatPct(hoveredNode.priceChangePct)}
              </span>
            </div>
            <div>Buy vol: <span className="text-emerald-400">{formatVol(hoveredNode.buyVolume)}</span></div>
            <div>Sell vol: <span className="text-red-400">{formatVol(hoveredNode.sellVolume)}</span></div>
            <div>
              Net flow:{" "}
              <span className={hoveredNode.netFlow >= 0 ? "text-emerald-400" : "text-red-400"}>
                {hoveredNode.netFlow >= 0 ? "+" : ""}
                {formatVol(hoveredNode.netFlow)}
              </span>
            </div>
            <div className="text-white/50">Trades: {hoveredNode.tradeCount.toLocaleString()}</div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center justify-between text-[11px] uppercase tracking-wider text-black/50 dark:text-white/50">
        <div className="flex items-center gap-3">
          <span>Size = |net aggressor flow|</span>
          <span>Color = % change</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-red-500">−5%</span>
          <div
            className="w-32 h-2 rounded"
            style={{
              background:
                "linear-gradient(to right, rgb(239,68,68), rgb(82,82,91), rgb(16,185,129))",
            }}
          />
          <span className="text-emerald-500">+5%</span>
        </div>
      </div>
    </div>
  );
}
