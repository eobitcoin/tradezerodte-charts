-- Calendar scans — weekly Sunday job that walks the 53-ticker
-- large-cap universe and ranks long-calendar opportunities (sell ~30
-- DTE front-month ATM call, buy ~90 DTE back-month ATM call). Filter
-- requires: IV rank ≥ 60%, no earnings in next 30 days, front-month
-- IV > back-month IV (favorable term structure).
--
-- Idempotent on scan_day. Snapshot data in jsonb for fast iteration
-- on ranking model.

CREATE TABLE IF NOT EXISTS calendar_scans (
  id            SERIAL PRIMARY KEY,
  scan_day      DATE NOT NULL UNIQUE,
  universe_size INT  NOT NULL DEFAULT 0,
  computed_size INT  NOT NULL DEFAULT 0,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calendar_scans_scan_day_desc_idx
  ON calendar_scans (scan_day DESC);
