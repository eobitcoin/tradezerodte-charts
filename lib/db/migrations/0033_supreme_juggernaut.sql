ALTER TABLE "posts" DROP CONSTRAINT "posts_trading_day_unique";--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "scan_kind" text DEFAULT 'premarket' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "posts_day_kind_unique" ON "posts" USING btree ("trading_day","scan_kind");