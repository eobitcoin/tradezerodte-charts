-- ============================================================================
-- Migration 0059 — Risk Graph: trade idea close tracking
--
-- Three additions to trade_ideas to support the "Close Trade" flow:
--
--   - closed_at: timestamp of when the user clicked Close. NULL while
--     the trade is open.
--
--   - closing_legs: snapshot of each leg's close price (mid/bid/ask)
--     at the moment of close. Matches the legs array index-for-index.
--     JSONB so we can store rich per-leg data without bloating columns.
--
--   - realized_pnl: total dollar P&L from open to close. Positive =
--     profit, negative = loss. Computed at close time and persisted
--     so the saved-list page can show it without re-running the chain.
--
-- Pure additive — existing rows stay open with NULLs in the new columns.
-- ============================================================================

ALTER TABLE trade_ideas
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closing_legs jsonb,
  ADD COLUMN IF NOT EXISTS realized_pnl numeric(16, 2);

CREATE INDEX IF NOT EXISTS trade_ideas_closed_at_idx
  ON trade_ideas (closed_at DESC) WHERE closed_at IS NOT NULL;
