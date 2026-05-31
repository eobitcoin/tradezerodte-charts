-- ============================================================================
-- Migration 0058 — Risk Graph: saved trade ideas
--
-- One table for now: trade_ideas. Each row is a saved multi-leg
-- option trade with everything needed to recreate the risk graph
-- and the entry conditions:
--
--   - name (user-supplied label, e.g. "SPY Jan put fly")
--   - ticker
--   - legs (JSONB array of Leg objects — type/side/strike/expiry/qty/
--     entry_price/entry_iv)
--   - underlying_spot_at_entry
--   - entry_debit (net $ paid; negative = credit received)
--   - status: "open" | "closed" | "expired"
--   - notes (free-form text)
--
-- The detail page recomputes the risk graph client-side from the
-- stored legs + the latest live spot. No need to persist the curve
-- itself.
--
-- Wave 2 will add trade_idea_marks (daily snapshot of each open
-- trade's mark-to-market P&L) for the performance section.
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  ticker text NOT NULL,
  -- JSONB array of Leg: { type, side, strike, expiration, qty, entryPrice, entryIv }
  legs jsonb NOT NULL DEFAULT '[]'::jsonb,
  underlying_spot_at_entry numeric(14, 4) NOT NULL,
  -- Net premium paid (debit > 0) or received (credit < 0).
  entry_debit numeric(16, 2) NOT NULL,
  -- 'open' | 'closed' | 'expired'.
  status text NOT NULL DEFAULT 'open',
  notes text NOT NULL DEFAULT '',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trade_ideas_created_at_idx
  ON trade_ideas (created_at DESC);

CREATE INDEX IF NOT EXISTS trade_ideas_ticker_idx
  ON trade_ideas (ticker, created_at DESC);

CREATE INDEX IF NOT EXISTS trade_ideas_status_idx
  ON trade_ideas (status, created_at DESC);
