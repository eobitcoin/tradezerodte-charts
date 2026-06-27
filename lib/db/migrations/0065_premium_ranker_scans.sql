-- Premium Ranker — weekly high-IV / premium scanner. Full-market funnel
-- (price >= $20, daily volume > 500k, has options) ranked by ATM IV and
-- by short-put premium richness, with 3 headline naked-put + credit-spread
-- trade suggestions. One row per scan_day; UPSERT-safe.

CREATE TABLE IF NOT EXISTS premium_ranker_scans (
  id            SERIAL PRIMARY KEY,
  scan_day      DATE NOT NULL UNIQUE,
  universe_size INT  NOT NULL DEFAULT 0,
  computed_size INT  NOT NULL DEFAULT 0,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS premium_ranker_scans_scan_day_desc_idx
  ON premium_ranker_scans (scan_day DESC);
