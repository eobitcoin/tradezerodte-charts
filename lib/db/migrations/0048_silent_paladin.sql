CREATE TABLE "weekly_earnings_briefings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_anchor" date NOT NULL,
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
	"yt_status" text,
	"yt_title" text,
	"yt_caption" text,
	"yt_posted_at" timestamp with time zone,
	"yt_error" text,
	"tt_status" text,
	"tt_caption" text,
	"tt_publish_id" text,
	"tt_posted_at" timestamp with time zone,
	"tt_error" text,
	CONSTRAINT "weekly_earnings_briefings_week_anchor_unique" UNIQUE("week_anchor")
);
--> statement-breakpoint
CREATE INDEX "weekly_earnings_briefings_week_anchor_idx" ON "weekly_earnings_briefings" USING btree ("week_anchor" DESC NULLS LAST);