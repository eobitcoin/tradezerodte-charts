ALTER TABLE "bot_config" ADD COLUMN "default_target1_pct" numeric(6, 2) DEFAULT '50.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "default_target2_pct" numeric(6, 2) DEFAULT '100.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "default_stop_loss_pct" numeric(6, 2) DEFAULT '30.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "default_time_stop_min" integer DEFAULT 120 NOT NULL;