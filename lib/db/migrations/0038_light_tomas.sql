ALTER TABLE "bot_config" ADD COLUMN "alma939_watchlist" text[] DEFAULT ARRAY['SPY','QQQ']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_fast_len" integer DEFAULT 9 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_slow_len" integer DEFAULT 39 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_offset" numeric(4, 2) DEFAULT '0.85' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_sigma" numeric(4, 1) DEFAULT '6.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_rsi_filter" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_rsi_len" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_long_rsi_min" numeric(5, 2) DEFAULT '50.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_long_rsi_max" numeric(5, 2) DEFAULT '72.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_short_rsi_min" numeric(5, 2) DEFAULT '28.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_short_rsi_max" numeric(5, 2) DEFAULT '50.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_chop_filter" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_chop_len" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_chop_threshold" numeric(5, 2) DEFAULT '50.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_chop_mode" text DEFAULT 'below' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_vwap_entry_filter" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_vwap_long_mode" text DEFAULT 'close' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_vwap_short_mode" text DEFAULT 'close' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_session_filter" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_session_start" text DEFAULT '09:30' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_session_end" text DEFAULT '16:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_force_close" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_force_close_hour" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_force_close_minute" integer DEFAULT 55 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_alma_signal_exits" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_long_close_below_alma39_exit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_long_alma_cross_down_exit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_short_close_above_alma39_exit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_short_alma_cross_up_exit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_vwap_exit_rules" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_long_close_below_vwap_exit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_short_close_above_vwap_exit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_long_alma9_cross_below_vwap_exit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_short_alma9_cross_above_vwap_exit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_stop_loss" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_fixed_sl_pct" numeric(5, 2) DEFAULT '1.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_use_profit_targets" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_tp1_pct" numeric(5, 2) DEFAULT '0.50' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma939_tp2_pct" numeric(5, 2) DEFAULT '1.00' NOT NULL;