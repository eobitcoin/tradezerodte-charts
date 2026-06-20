"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Cryptobubbles-style packed-bubble chart for sector flow.
 *
 * Bubble SIZE = √(|netFlow|) scaled to viewport — net aggressor flow
 * (buy − sell shares) over the selected timeframe. Sizing is normalized
 * across the visible universe so the biggest mover is always at MAX_R.
 *
 * Bubble COLOR = priceChangePct mapped to a red↔neutral↔green gradient.
 *
 * The bubbles drift continuously via a tiny physics loop — Brownian
 * jitter + collision repulsion + wall bounce — so the chart breathes
 * even when the underlying data isn't moving. Tick rate is ~30 Hz.
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

interface SimNode extends TickerAgg {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

const VIEW_W = 800;
const VIEW_H = 520;
const CENTER_X = VIEW_W / 2;
const CENTER_Y = VIEW_H / 2;
// Capped to ensure 22 bubbles always fit comfortably:
// 22 × π × 75² ≈ 388k px² fits inside 800 × 520 = 416k px² with room.
const MIN_R = 28;
const MAX_R = 72;
// Base radius when data is zero (e.g. weekend / pre-open) so the canvas
// shows 22 uniform bubbles instead of collapsing to MIN_R or ballooning
// to MAX_R.
const BASE_R = 42;

/** Map priceChangePct → CSS color in a red↔neutral↔green gradient. */
function colorForPct(pct: number | null): string {
  if (pct == null) return "rgb(82, 82, 95)"; // neutral grey for no-data
  const clamped = Math.max(-5, Math.min(5, pct)); // saturate beyond ±5%
  const t = (clamped + 5) / 10; // 0..1
  const r = t < 0.5 ? lerp(239, 82, t * 2) : lerp(82, 16, (t - 0.5) * 2);
  const g = t < 0.5 ? lerp(68, 82, t * 2) : lerp(82, 185, (t - 0.5) * 2);
  const b = t < 0.5 ? lerp(68, 91, t * 2) : lerp(91, 129, (t - 0.5) * 2);
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Compute the radius for each ticker based on |netFlow|. Returns
 *  uniform BASE_R for every ticker when the entire universe has zero
 *  flow (weekends / pre-open). */
function computeRadii(data: TickerAgg[]): Map<string, number> {
  const radii = new Map<string, number>();
  const flows = data.map((d) => Math.abs(d.netFlow));
  const maxFlow = Math.max(...flows, 0);
  if (maxFlow <= 0) {
    // No live data — every bubble gets the same uniform base size.
    for (const d of data) radii.set(d.ticker, BASE_R);
    return radii;
  }
  // sqrt-scale so a 4× flow difference reads as 2× size (perceptually
  // closer to area than radius).
  for (const d of data) {
    const f = Math.abs(d.netFlow);
    const t = Math.sqrt(f) / Math.sqrt(maxFlow); // 0..1
    radii.set(d.ticker, MIN_R + (MAX_R - MIN_R) * t);
  }
  return radii;
}

/** Spiral-out initial layout for fresh nodes — keeps bubbles from all
 *  stacking on the center pixel on first frame. */
function initialPosition(i: number, total: number): { x: number; y: number } {
  const angle = (i / total) * Math.PI * 2 + (i % 2) * 0.4;
  const radius = 60 + i * 14;
  return {
    x: CENTER_X + Math.cos(angle) * radius,
    y: CENTER_Y + Math.sin(angle) * radius,
  };
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
  // Tick counter — bumped at ~30 Hz to trigger SVG re-render against the
  // mutated node positions. The simulation state itself lives in refs to
  // avoid React state churn.
  const [, setTick] = useState(0);
  const nodesRef = useRef<SimNode[]>([]);
  const pollRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // ---- Data fetch + polling ----
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
    pollRef.current = window.setInterval(load, 90_000);
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [timeframe]);

  // ---- Sync nodesRef whenever data changes ----
  // Preserves existing positions for tickers still in the set so the
  // poll-driven refresh doesn't reshuffle the chart.
  useEffect(() => {
    if (!data) return;
    const radii = computeRadii(data);
    const existing = new Map(nodesRef.current.map((n) => [n.ticker, n]));
    const next: SimNode[] = data.map((d, i) => {
      const prior = existing.get(d.ticker);
      if (prior) {
        return { ...prior, ...d, r: radii.get(d.ticker) ?? prior.r };
      }
      const pos = initialPosition(i, data.length);
      return {
        ...d,
        x: pos.x,
        y: pos.y,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
        r: radii.get(d.ticker) ?? BASE_R,
      };
    });
    nodesRef.current = next;
    setTick((t) => t + 1);
  }, [data]);

  // ---- Physics loop ----
  useEffect(() => {
    let last = performance.now();
    const PAD = 4;
    const DAMP = 0.985;
    const JITTER = 0.04; // per-frame random velocity nudge
    const WALL_BOUNCE = 0.6; // restitution when hitting an edge

    function step(now: number) {
      const dt = Math.min(33, now - last) / 16.6667; // normalize to ~60fps frames
      last = now;
      const nodes = nodesRef.current;

      // Brownian jitter — tiny push so bubbles never go fully still.
      for (const n of nodes) {
        n.vx += (Math.random() - 0.5) * JITTER;
        n.vy += (Math.random() - 0.5) * JITTER;
      }

      // Pairwise collision — elastic push apart + transfer some velocity.
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
          const minDist = a.r + b.r + PAD;
          if (dist < minDist) {
            const overlap = minDist - dist;
            const ux = dx / dist;
            const uy = dy / dist;
            // Position correction (half each).
            a.x -= ux * overlap * 0.5;
            a.y -= uy * overlap * 0.5;
            b.x += ux * overlap * 0.5;
            b.y += uy * overlap * 0.5;
            // Velocity exchange along collision normal.
            const va = a.vx * ux + a.vy * uy;
            const vb = b.vx * ux + b.vy * uy;
            const exchange = (vb - va) * 0.6;
            a.vx += ux * exchange;
            a.vy += uy * exchange;
            b.vx -= ux * exchange;
            b.vy -= uy * exchange;
          }
        }
      }

      // Integrate + wall bounce + damping.
      for (const n of nodes) {
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        if (n.x < n.r) {
          n.x = n.r;
          n.vx = Math.abs(n.vx) * WALL_BOUNCE;
        } else if (n.x > VIEW_W - n.r) {
          n.x = VIEW_W - n.r;
          n.vx = -Math.abs(n.vx) * WALL_BOUNCE;
        }
        if (n.y < n.r) {
          n.y = n.r;
          n.vy = Math.abs(n.vy) * WALL_BOUNCE;
        } else if (n.y > VIEW_H - n.r) {
          n.y = VIEW_H - n.r;
          n.vy = -Math.abs(n.vy) * WALL_BOUNCE;
        }
        n.vx *= DAMP;
        n.vy *= DAMP;
        // Cap top speed so a chain of collisions can't fling bubbles.
        const sp = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
        const SPEED_CAP = 1.8;
        if (sp > SPEED_CAP) {
          n.vx = (n.vx / sp) * SPEED_CAP;
          n.vy = (n.vy / sp) * SPEED_CAP;
        }
      }

      setTick((t) => (t + 1) & 0xffff);
      rafRef.current = requestAnimationFrame(step);
    }

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const hoveredNode = useMemo(
    () => (hovered ? nodesRef.current.find((n) => n.ticker === hovered) ?? null : null),
    // re-derive whenever the tick advances so the tooltip reads fresh state
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hovered, nodesRef.current.length],
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
      <div className="relative w-full rounded-lg bg-black/95 dark:bg-black/90 ring-1 ring-white/5 overflow-hidden">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full h-auto"
          preserveAspectRatio="xMidYMid meet"
        >
          {nodesRef.current.map((n) => {
            const fill = colorForPct(n.priceChangePct);
            const isHover = hovered === n.ticker;
            return (
              <g
                key={n.ticker}
                transform={`translate(${n.x.toFixed(2)},${n.y.toFixed(2)})`}
                onMouseEnter={() => setHovered(n.ticker)}
                onMouseLeave={() => setHovered(null)}
                className="cursor-pointer"
              >
                <circle
                  r={n.r}
                  fill={fill}
                  fillOpacity={0.82}
                  stroke={isHover ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.18)"}
                  strokeWidth={isHover ? 2 : 1}
                  style={{
                    filter: `drop-shadow(0 0 ${Math.min(16, n.r / 4)}px ${fill})`,
                  }}
                />
                <text
                  textAnchor="middle"
                  fill="white"
                  fontWeight={700}
                  fontFamily="ui-sans-serif, system-ui, -apple-system"
                  fontSize={Math.max(10, Math.min(18, n.r * 0.34))}
                  y={n.r > 38 ? -2 : 4}
                  style={{ pointerEvents: "none" }}
                >
                  {n.ticker}
                </text>
                {n.r > 38 && n.priceChangePct != null && (
                  <text
                    textAnchor="middle"
                    fill="white"
                    fontFamily="ui-sans-serif, system-ui, -apple-system"
                    fontSize={Math.max(9, Math.min(13, n.r * 0.22))}
                    y={n.r * 0.4}
                    style={{ pointerEvents: "none", opacity: 0.9 }}
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
