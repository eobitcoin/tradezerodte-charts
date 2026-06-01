-- Sell Puts scans — weekly Sunday job that scans a locked universe of
-- ~50 large-cap US equities for the most attractive cash-secured put
-- selling opportunities. Each pick is ranked by expected ROI =
-- P(profit) × (credit / stock_close), derived from Black-Scholes
-- risk-neutral probability.
--
-- Idempotent on scan_day (one row per day, re-run overwrites).
-- Snapshot data stored as jsonb to keep schema flexible while we
-- iterate on the ranking model.

CREATE TABLE IF NOT EXISTS sell_put_scans (
  id            SERIAL PRIMARY KEY,
  scan_day      DATE NOT NULL UNIQUE,
  universe_size INT  NOT NULL DEFAULT 0,
  computed_size INT  NOT NULL DEFAULT 0,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sell_put_scans_scan_day_desc_idx
  ON sell_put_scans (scan_day DESC);
