CREATE TABLE "sector_rotation_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_day" date NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"methodology" text DEFAULT '' NOT NULL,
	"sectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sector_rotation_posts_scan_day_idx" ON "sector_rotation_posts" USING btree ("scan_day");