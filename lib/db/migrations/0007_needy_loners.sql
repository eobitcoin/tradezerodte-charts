CREATE TABLE "crypto_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_day" date NOT NULL,
	"title" text NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"body_md" text DEFAULT '' NOT NULL,
	"trades" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crypto_posts_scan_day_unique" UNIQUE("scan_day")
);
--> statement-breakpoint
CREATE INDEX "crypto_posts_scan_day_idx" ON "crypto_posts" USING btree ("scan_day" DESC NULLS LAST);