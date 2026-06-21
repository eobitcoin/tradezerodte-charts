-- Squeeze Watch — weekly Sunday scan ranking short-squeeze candidates
-- from a curated ~150-name universe. One row per scan_day with the top
-- N (default 25) candidates stored as JSONB for flexible iteration.
--
-- Idempotent on scan_day. Re-running on the same Sunday overwrites cleanly.

CREATE TABLE IF NOT EXISTS squeeze_scans (
  id            SERIAL PRIMARY KEY,
  scan_day      DATE NOT NULL UNIQUE,
  universe_size INT  NOT NULL DEFAULT 0,
  ranked_size   INT  NOT NULL DEFAULT 0,
  candidates    JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS squeeze_scans_scan_day_desc_idx
  ON squeeze_scans (scan_day DESC);
