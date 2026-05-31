-- ============================================================================
-- Migration 0060 — Earnings Scans (V1)
--
-- One row per scan_week (Monday of the week the scan covers). The
-- `data` jsonb holds the full computed scan output for every reporting
-- ticker that passed the options-liquidity bar, structured as:
--
--   {
--     coveredFrom: "2026-06-02",
--     coveredTo:   "2026-06-06",
--     tickers: [
--       {
--         symbol: "AAPL",
--         earningsDate: "2026-06-04",
--         hour: "amc",
--         spot: 195.32,
--         atmIv: 0.28,
--         impliedMovePct: 4.2,
--         history: [
--           { date: "2026-03-04", pricePctChange: 3.8, hour: "amc" },
--           { date: "2025-12-08", pricePctChange: -7.1, hour: "amc" },
--           ...
--         ],
--         historyStats: {
--           median, mean, max, min, count,
--         },
--         strategies: {
--           rush:     { suggested: bool, score: 0-100, rationale },
--           condor:   { suggested: bool, score: 0-100, rationale },
--           straddle: { suggested: bool, score: 0-100, rationale },
--           breakout: { suggested: bool, score: 0-100, rationale },
--         },
--       },
--       ...
--     ]
--   }
--
-- One row per scan_week so re-runs UPSERT cleanly. Future revisions
-- (V2/V3 backtests) can extend the per-ticker shape without changing
-- the table schema.
-- ============================================================================

CREATE TABLE IF NOT EXISTS earnings_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Monday of the scan week (UTC date). UPSERT key.
  scan_week date NOT NULL UNIQUE,
  -- Universe size at scan time (informational — how many tickers reported).
  universe_size integer NOT NULL,
  -- How many tickers passed the options-liquidity bar and got computed.
  computed_size integer NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS earnings_scans_scan_week_idx
  ON earnings_scans (scan_week DESC);
