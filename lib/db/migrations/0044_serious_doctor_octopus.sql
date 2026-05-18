CREATE TABLE "earnings_posts" (
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
CREATE UNIQUE INDEX "earnings_posts_scan_day_idx" ON "earnings_posts" USING btree ("scan_day");