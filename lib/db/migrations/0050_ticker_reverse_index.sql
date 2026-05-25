-- Per-ticker hub pages (/tickers/[symbol]) need fast reverse lookups —
-- "every brief/research piece that mentioned this ticker." Without GIN
-- indexes these queries seq-scan, fine today but degrades as tables grow.
--
-- Both columns are text arrays, so `array_ops` is the right GIN op class.
-- We don't add JSONB indexes here for insiderPosts/institutionalPosts/etc.
-- — those queries hit smaller tables (~hundreds of rows each) and stay
-- fast on a seq-scan for the foreseeable future. Add later if needed.

CREATE INDEX IF NOT EXISTS posts_tickers_gin_idx
  ON posts USING gin (tickers);

CREATE INDEX IF NOT EXISTS weekly_earnings_briefings_tickers_gin_idx
  ON weekly_earnings_briefings USING gin (tickers);
