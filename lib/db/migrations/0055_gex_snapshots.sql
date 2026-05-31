-- ============================================================================
-- Migration 0055 — Dealer Gamma Exposure (GEX)
--
-- One table powers the GEX dashboard:
--
--   gex_snapshots — per-ticker, per-tick snapshot of the dealer gamma
--     surface. Each row is one moment in time for one ticker, with:
--
--       - spot price at snapshot
--       - total net dealer gamma ($/1% move equivalent)
--       - zero-gamma flip strike (the level where cumulative GEX
--         crosses zero; acts as a pin in long-gamma regimes and a
--         launchpad in short-gamma regimes)
--       - per-strike profile as JSONB: each row is {strike, callGex,
--         putGex, netGex, cumulativeGex}, sorted ascending by strike
--
-- Snapshots come from a 5-minute Railway cron during RTH. With the
-- 13-ticker universe and a 5-min cadence, ~10K rows/day, ~2.5M/year.
-- Pruning policy left for later — for v1 we keep everything.
--
-- The sign convention is the standard one: dealers are assumed long
-- calls and short puts (customer flow inverted). Per-strike:
--     netGex = (callOI · callGamma − putOI · putGamma) · 100 · spot²
-- positive net GEX → long-gamma regime at that strike (price pin),
-- negative → short-gamma (price acceleration).
-- ============================================================================

CREATE TABLE IF NOT EXISTS gex_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  -- When the snapshot was computed (NY-time clock, naturally UTC stored).
  ts timestamptz NOT NULL DEFAULT now(),
  -- Underlying spot at snapshot time.
  spot numeric(14, 4) NOT NULL,
  -- Total net dealer gamma exposure across all strikes & expiries.
  -- Sign tells regime: >0 = long-gamma (pin), <0 = short-gamma (squeeze).
  total_gex numeric(20, 2) NOT NULL,
  -- The strike at which cumulative GEX (running sum from low strikes
  -- upward) changes sign. NULL when monotonic (rare). When non-null
  -- and within a few percent of spot, it's the dominant intraday
  -- support/resistance level.
  zero_gamma_strike numeric(14, 4),
  -- Distance of zero-gamma strike from spot, as % of spot. Convenience
  -- field for ranking / filtering on the landing page.
  zero_gamma_pct numeric(8, 2),
  -- Per-strike profile, sorted ascending by strike. Shape:
  -- [{ strike, callGex, putGex, netGex, cumulativeGex }, …]
  gex_by_strike jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Number of contracts that fed the calc (informational).
  contracts_scanned integer NOT NULL DEFAULT 0,
  -- Number of expiries included (we aggregate across all listed expiries).
  expiries_scanned integer NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fast "latest snapshot for this ticker" lookup (landing page) and
-- "historical series for this ticker" (detail page chart).
CREATE INDEX IF NOT EXISTS gex_snapshots_ticker_ts_desc_idx
  ON gex_snapshots (ticker, ts DESC);

-- Pruning helper: "oldest first" for a delete-by-age sweep.
CREATE INDEX IF NOT EXISTS gex_snapshots_ts_idx
  ON gex_snapshots (ts);
