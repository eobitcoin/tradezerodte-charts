-- BotWick Analysis — daily 6AM ET Finora-style Smart-Money-Concepts read on
-- the fixed 21-name universe (AAPL…QQQ). One row per scan_day holding all
-- per-ticker reports in JSONB; UPSERT-safe. Surfaced as the first tab on
-- the Today page.

CREATE TABLE IF NOT EXISTS botwick_scans (
  id            SERIAL PRIMARY KEY,
  scan_day      DATE NOT NULL UNIQUE,
  universe_size INT  NOT NULL DEFAULT 0,
  computed_size INT  NOT NULL DEFAULT 0,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS botwick_scans_scan_day_desc_idx
  ON botwick_scans (scan_day DESC);
