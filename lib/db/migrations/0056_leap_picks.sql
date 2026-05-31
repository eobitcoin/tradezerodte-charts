-- ============================================================================
-- Migration 0056 — Cheap LEAP Scanner
--
-- "Cheap LEAPs on durable upside" — a vega-positive long-term call
-- strategy. Buy 14-20 month calls when (a) IV is in the bottom
-- quartile of its 1y range, (b) fundamentals are solid, and (c) the
-- stock has pulled back but isn't in free fall.
--
-- Two tables, mirroring the options_edge_scans pattern:
--
--   1. leap_picks — one row per qualifying contract per scan day.
--      Carries the specific contract (strike + expiry), the per-leg
--      market data, and the component scores so the page can show
--      WHY each pick made the list.
--
--   2. leap_scans — weekly summary post: scan_day, narrative,
--      top picks as a denormalized snapshot.
--
-- Pure additive — no changes to existing tables.
-- ============================================================================

CREATE TABLE IF NOT EXISTS leap_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_day date NOT NULL,
  ticker text NOT NULL,

  -- The picked LEAP contract.
  contract_ticker text NOT NULL,            -- Polygon OPRA symbol
  expiration_date date NOT NULL,
  strike numeric(14, 4) NOT NULL,
  dte_days integer NOT NULL,                -- days to expiration at scan time

  -- Market snapshot at scan time.
  underlying_price numeric(14, 4) NOT NULL,
  premium_mid numeric(14, 4),                -- (bid + ask) / 2
  premium_bid numeric(14, 4),
  premium_ask numeric(14, 4),
  iv numeric(8, 6),                          -- IV of the picked contract
  delta numeric(6, 4),
  gamma numeric(10, 8),
  theta numeric(10, 4),
  vega numeric(10, 4),
  open_interest integer,

  -- Component scores (all 0-100, higher = better candidate).
  iv_rank numeric(5, 2),                     -- IV percentile in 1y range, LOWER = better
  quality_score numeric(5, 2),               -- fundamentals score, HIGHER = better
  setup_score numeric(5, 2),                 -- price-action score (pullback + above 200dma)
  composite_score numeric(5, 2) NOT NULL,    -- weighted blend

  -- Fundamentals snapshot — what fed the quality_score.
  fundamentals jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Free-form per-pick metadata.
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leap_picks_scan_day_desc_idx
  ON leap_picks (scan_day DESC, composite_score DESC);

CREATE INDEX IF NOT EXISTS leap_picks_ticker_scan_day_idx
  ON leap_picks (ticker, scan_day DESC);

-- ============================================================================

CREATE TABLE IF NOT EXISTS leap_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_day date NOT NULL UNIQUE,
  title text NOT NULL,
  -- Prose summary — auto-generated for v1, may be LLM-written later.
  summary text NOT NULL DEFAULT '',
  -- Top N picks as a jsonb array (denormalized snapshot mirroring
  -- the LeapPickSummary TS interface, so historical scans don't
  -- break if leap_picks evolves).
  picks jsonb NOT NULL DEFAULT '[]'::jsonb,
  universe_size integer NOT NULL,
  run_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leap_scans_scan_day_desc_idx
  ON leap_scans (scan_day DESC);
