CREATE TABLE "briefings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trading_day" date NOT NULL,
	"script" text,
	"setting_prompt" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"higgsfield_job_id" text,
	"video_s3_key" text,
	"youtube_video_id" text,
	"thumbnail_url" text,
	"error_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone,
	CONSTRAINT "briefings_trading_day_unique" UNIQUE("trading_day")
);
--> statement-breakpoint
CREATE INDEX "briefings_trading_day_idx" ON "briefings" USING btree ("trading_day" DESC NULLS LAST);