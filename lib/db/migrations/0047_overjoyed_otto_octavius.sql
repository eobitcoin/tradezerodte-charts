ALTER TABLE "briefings" ADD COLUMN "yt_status" text;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "yt_title" text;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "yt_caption" text;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "yt_posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "yt_error" text;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "tt_status" text;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "tt_caption" text;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "tt_publish_id" text;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "tt_posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "briefings" ADD COLUMN "tt_error" text;