ALTER TABLE "bot_actions" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bot_trades" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "bot_actions_archived_idx" ON "bot_actions" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "bot_trades_archived_idx" ON "bot_trades" USING btree ("archived_at");