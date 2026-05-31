-- ============================================================================
-- Migration 0057 — LEAP pick marks (performance tracking)
--
-- Time-series of current price/IV for every leap_pick whose expiry
-- is still in the future. Populated by a daily cron that fetches the
-- contract snapshot from Polygon and appends a row.
--
-- The performance view on /research/leaps groups these by leap_pick_id,
-- computes P&L vs the entry premium stored on leap_picks, and renders
-- a table + per-pick sparkline.
--
-- ON DELETE CASCADE: if a leap_pick gets manually deleted, its marks
-- go with it. (The normal scan-rerun flow only deletes picks for the
-- SAME scan_day, so this only matters for manual cleanup.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS leap_pick_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leap_pick_id uuid NOT NULL REFERENCES leap_picks(id) ON DELETE CASCADE,
  mark_ts timestamptz NOT NULL DEFAULT now(),

  -- Underlying spot at mark time.
  underlying_price numeric(14, 4),

  -- The picked contract's market data at this moment.
  premium_mid numeric(14, 4),
  premium_bid numeric(14, 4),
  premium_ask numeric(14, 4),
  iv numeric(8, 6),
  delta numeric(6, 4),
  open_interest integer,

  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Most queries are "latest mark for this pick" or "trail of marks for
-- this pick" — both want (leap_pick_id, mark_ts desc).
CREATE INDEX IF NOT EXISTS leap_pick_marks_pick_ts_idx
  ON leap_pick_marks (leap_pick_id, mark_ts DESC);

-- For "all marks today" dedup checks during the cron.
CREATE INDEX IF NOT EXISTS leap_pick_marks_ts_idx
  ON leap_pick_marks (mark_ts);
