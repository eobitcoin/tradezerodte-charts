-- Sector Flow bubbles — 2-min windows of aggressor-classified stock flow
-- for the 22-name sector + index + Mag 7 universe. The cron upserts one
-- row per (ticker, window_start). The /sector page rolls bars up at
-- read time for 5m / 1h / 1d / 1w views. A rolling 8-day retention
-- prunes the table so it stays small (~22 × 195 × 8 ≈ 34k live rows).

CREATE TABLE IF NOT EXISTS sector_flow_bars (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker            TEXT        NOT NULL,
  window_start      TIMESTAMPTZ NOT NULL,
  window_end        TIMESTAMPTZ NOT NULL,
  buy_volume        NUMERIC(18, 0) NOT NULL DEFAULT 0,
  sell_volume       NUMERIC(18, 0) NOT NULL DEFAULT 0,
  ambiguous_volume  NUMERIC(18, 0) NOT NULL DEFAULT 0,
  total_volume      NUMERIC(18, 0) NOT NULL DEFAULT 0,
  notional_usd      NUMERIC(20, 2) NOT NULL DEFAULT 0,
  open_price        NUMERIC(12, 4),
  close_price       NUMERIC(12, 4),
  trade_count       INTEGER     NOT NULL DEFAULT 0,
  captured_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sector_flow_bars_ticker_window_idx
  ON sector_flow_bars (ticker, window_start);

CREATE INDEX IF NOT EXISTS sector_flow_bars_window_idx
  ON sector_flow_bars (window_start DESC);

CREATE INDEX IF NOT EXISTS sector_flow_bars_ticker_window_desc_idx
  ON sector_flow_bars (ticker, window_start DESC);
