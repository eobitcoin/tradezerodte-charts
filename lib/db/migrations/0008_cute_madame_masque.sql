CREATE TABLE "crypto_weekly_research_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"scan_day" date NOT NULL,
	"title" text NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"body_md" text DEFAULT '' NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_weekly_research_ticker_day_idx" ON "crypto_weekly_research_posts" USING btree ("ticker","scan_day");--> statement-breakpoint
CREATE INDEX "crypto_weekly_research_scan_day_idx" ON "crypto_weekly_research_posts" USING btree ("scan_day" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crypto_weekly_research_ticker_idx" ON "crypto_weekly_research_posts" USING btree ("ticker");