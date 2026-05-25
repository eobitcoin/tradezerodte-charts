-- Add asset_class to research_posts so we can split the Wicked Stocks
-- equity research stream from the new Sunday metals research stream
-- without duplicating the table. Existing rows backfill to 'equity'
-- via the column default; all current code paths read the same rows
-- because the implicit filter (we never set the column before) becomes
-- WHERE asset_class='equity' once we wire it up explicitly.
--
-- The index supports the hot query on every /research/metals* page:
-- "every metals post most-recent-first."

ALTER TABLE "research_posts"
  ADD COLUMN IF NOT EXISTS "asset_class" text NOT NULL DEFAULT 'equity';

CREATE INDEX IF NOT EXISTS "research_posts_asset_class_scan_day_idx"
  ON "research_posts" ("asset_class", "scan_day" DESC);
