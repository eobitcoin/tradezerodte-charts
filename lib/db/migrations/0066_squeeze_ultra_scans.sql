-- Squeeze Scan (ST Squeeze Ultra) — weekly full-market TTM-style squeeze
-- scanner over the optionable, $20+, 500k+ daily-volume universe. One row per
-- ticker that is in a squeeze on Daily and/or Weekly, with per-timeframe
-- state / ideal / momentum colour. One DB row per scan_day; UPSERT-safe.

CREATE TABLE IF NOT EXISTS squeeze_ultra_scans (
  id            SERIAL PRIMARY KEY,
  scan_day      DATE NOT NULL UNIQUE,
  universe_size INT  NOT NULL DEFAULT 0,
  computed_size INT  NOT NULL DEFAULT 0,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS squeeze_ultra_scans_scan_day_desc_idx
  ON squeeze_ultra_scans (scan_day DESC);
