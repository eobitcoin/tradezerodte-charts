-- Options Edge — IV surface anomaly scanner.
-- Two new tables. Pure additive — no changes to existing schema.

CREATE TABLE IF NOT EXISTS "iv_snapshots" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ticker"            text NOT NULL,
  "snapshot_date"     date NOT NULL,
  "underlying_price"  numeric(14, 4),
  "atm_iv_30d"        numeric(8, 6),
  "atm_iv_60d"        numeric(8, 6),
  "put_25d_iv_30d"    numeric(8, 6),
  "call_25d_iv_30d"   numeric(8, 6),
  "hv_30d"            numeric(8, 6),
  "meta"              jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"        timestamptz NOT NULL DEFAULT now()
);

-- (ticker, date) is the natural upsert key for the backfill loop.
CREATE UNIQUE INDEX IF NOT EXISTS "iv_snapshots_ticker_date_idx"
  ON "iv_snapshots" ("ticker", "snapshot_date");

-- Hot query: pull the last N daily observations per ticker for z-score.
CREATE INDEX IF NOT EXISTS "iv_snapshots_ticker_date_desc_idx"
  ON "iv_snapshots" ("ticker", "snapshot_date" DESC);


CREATE TABLE IF NOT EXISTS "options_edge_scans" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "scan_day"       date NOT NULL UNIQUE,
  "title"          text NOT NULL,
  "summary"        text NOT NULL DEFAULT '',
  "anomalies"      jsonb NOT NULL DEFAULT '[]'::jsonb,
  "universe_size"  integer NOT NULL DEFAULT 0,
  "run_at"         timestamptz,
  "meta"           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "options_edge_scans_scan_day_idx"
  ON "options_edge_scans" ("scan_day" DESC);
