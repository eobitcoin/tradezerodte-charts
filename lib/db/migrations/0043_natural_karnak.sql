CREATE TABLE "institutional_funds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cik" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institutional_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_day" date NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"methodology" text DEFAULT '' NOT NULL,
	"stocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "institutional_funds_cik_idx" ON "institutional_funds" USING btree ("cik");--> statement-breakpoint
CREATE INDEX "institutional_funds_enabled_idx" ON "institutional_funds" USING btree ("enabled","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "institutional_posts_scan_day_idx" ON "institutional_posts" USING btree ("scan_day");--> statement-breakpoint
-- Seed the v1 fund list. CIKs taken from SEC EDGAR public lookups.
INSERT INTO "institutional_funds" ("name", "cik", "enabled", "sort_order", "note") VALUES
  ('Berkshire Hathaway',       '0001067983', true, 10, 'Buffett/Abel — long-horizon value. Block buys are the signal.'),
  ('Bridgewater Associates',   '0001350694', true, 20, 'Dalio/Prince — macro hedge; positions are slower-moving.'),
  ('Renaissance Technologies', '0001037389', true, 30, 'Quant — 13F is partial signal (heavy intra-quarter trading).'),
  ('Citadel Advisors',         '0001423053', true, 40, 'Multi-strategy — mix of fundamental + market-making.'),
  ('Two Sigma Investments',    '0001179392', true, 50, 'Quant — same intra-quarter caveat as RenTech.')
ON CONFLICT ("cik") DO NOTHING;
