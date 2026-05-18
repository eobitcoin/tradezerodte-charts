ALTER TABLE "bot_config" ADD COLUMN "alma939_sl_mode" text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_trail_sl_pct" numeric(5, 2) DEFAULT '1.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_trail_update_mode" text DEFAULT 'prev_extreme' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_tp1" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_tp1_qty" numeric(5, 2) DEFAULT '20.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_tp2" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_tp2_qty" numeric(5, 2) DEFAULT '20.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_tp3" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_tp3_pct" numeric(5, 2) DEFAULT '1.50' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_tp3_qty" numeric(5, 2) DEFAULT '20.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_tp4" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_tp4_pct" numeric(5, 2) DEFAULT '2.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_tp4_qty" numeric(5, 2) DEFAULT '20.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_tp5" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_tp5_pct" numeric(5, 2) DEFAULT '2.50' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_tp5_qty" numeric(5, 2) DEFAULT '20.00' NOT NULL;