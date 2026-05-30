-- ============================================================================
-- Migration 0054 — Unusual Options Activity (UOA)
--
-- Two tables drive the "smart money flow" scanner:
--
--   1. uoa_prints — raw filtered prints. Each row is one option trade
--      that cleared the unusual-activity bar (large premium, opening
--      trade signal, OI multiplier > 3x). Populated by a daily
--      end-of-day cron + an intraday 5-min cron during RTH. Indexed
--      for "top prints today" + "newest first" queries.
--
--   2. uoa_scans — daily summary. One row per scan_day with the top
--      N prints of the day, classification breakdown, and a prose
--      summary. Mirrors the options_edge_scans pattern (UPSERT on
--      scan_day; safe to re-run).
--
-- Pure additive — no changes to existing tables.
-- ============================================================================

CREATE TABLE IF NOT EXISTS uoa_prints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- When the trade actually printed on the tape (Polygon trade ts).
  print_ts timestamptz NOT NULL,
  -- When our cron captured + classified it.
  captured_at timestamptz NOT NULL DEFAULT now(),

  -- Trade identity.
  underlying text NOT NULL,
  contract_ticker text NOT NULL,
  expiration_date date NOT NULL,
  strike numeric(14, 4) NOT NULL,
  contract_type text NOT NULL,  -- 'call' | 'put'

  -- Trade economics.
  side text NOT NULL,           -- 'buy' | 'sell' (aggressor side)
  size integer NOT NULL,        -- contracts
  price numeric(14, 4) NOT NULL,
  premium_usd numeric(16, 2) NOT NULL,

  -- Quote context at trade time (for aggressor classification).
  bid_at_trade numeric(14, 4),
  ask_at_trade numeric(14, 4),

  -- Sweep flag — Polygon condition code 41 = intermarket sweep order.
  is_sweep boolean NOT NULL DEFAULT false,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- OI baseline from the prior day's close.
  prior_day_oi integer,
  oi_multiplier numeric(8, 2),  -- size / prior_day_oi

  -- Classification — one of:
  --   'bullish_call_buy'  (aggressive call buyer)
  --   'bearish_put_buy'   (aggressive put buyer)
  --   'call_sell'         (aggressive call seller / short call)
  --   'put_sell'          (aggressive put seller / short put)
  --   'ambiguous'         (couldn't classify cleanly)
  classification text NOT NULL,

  -- Strike distance from spot, in percent. Negative = ITM put / ITM
  -- call, positive = OTM. Helps the UI sort by aggression.
  pct_from_spot numeric(8, 2),
  underlying_price_at_trade numeric(14, 4),

  -- Free-form per-print metadata (exchange list, original raw trade).
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS uoa_prints_underlying_ts_idx
  ON uoa_prints (underlying, print_ts DESC);

CREATE INDEX IF NOT EXISTS uoa_prints_captured_at_idx
  ON uoa_prints (captured_at DESC);

CREATE INDEX IF NOT EXISTS uoa_prints_premium_desc_idx
  ON uoa_prints (premium_usd DESC, print_ts DESC);

CREATE INDEX IF NOT EXISTS uoa_prints_classification_idx
  ON uoa_prints (classification, print_ts DESC);

-- Dedup guard. A single trade should never be inserted twice across
-- intraday + EOD cron passes. Polygon emits a participant_timestamp +
-- sequence_number per trade — we squash them into a deterministic key
-- in the meta jsonb. The unique index enforces no dups.
CREATE UNIQUE INDEX IF NOT EXISTS uoa_prints_dedup_idx
  ON uoa_prints (contract_ticker, print_ts, size, price);

-- ============================================================================

CREATE TABLE IF NOT EXISTS uoa_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_day date NOT NULL UNIQUE,
  title text NOT NULL,
  -- Prose summary — auto-generated for v1, may be LLM-written later.
  summary text NOT NULL DEFAULT '',
  -- Top N prints as a jsonb array (denormalized snapshot at scan
  -- time, so historical scans don't break if uoa_prints schema
  -- evolves). Shape mirrors the UoaPrintSummary TS interface.
  prints jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Universe size at scan time (informational).
  universe_size integer NOT NULL,
  run_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS uoa_scans_scan_day_desc_idx
  ON uoa_scans (scan_day DESC);
