-- Daily briefing's right-side "calls" panel was inferred from the
-- premarket scan's top-3 ranked trades, which could diverge from the
-- tickers the video script-writer actually named (it themes its picks,
-- e.g. a chips-rotation set ranked 9/15/16 rather than the raw top-3).
-- Add a tickers array the script-writer populates with the symbols it
-- mentions, so the panel matches the video. Empty array preserves the
-- legacy premarket-top-3 fallback for historical briefings.

ALTER TABLE "briefings"
  ADD COLUMN IF NOT EXISTS "tickers" text[] NOT NULL DEFAULT '{}'::text[];
