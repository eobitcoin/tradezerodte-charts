CREATE TABLE "bot_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"trade_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'off' NOT NULL,
	"grade_filter" text DEFAULT 'A+' NOT NULL,
	"max_risk_per_trade_usd" numeric(14, 2) DEFAULT '250.00' NOT NULL,
	"max_daily_loss_usd" numeric(14, 2) DEFAULT '500.00' NOT NULL,
	"max_open_positions" integer DEFAULT 3 NOT NULL,
	"kill_switch_engaged" boolean DEFAULT false NOT NULL,
	"kill_switch_reason" text,
	"tradier_account_id" text,
	"tradier_env" text,
	"prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "bot_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_post_day" date,
	"source_ticker" text NOT NULL,
	"source_grade" text,
	"strategy" text NOT NULL,
	"tradier_order_id" text,
	"tradier_position_id" text,
	"legs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"entry_fill_usd" numeric(14, 4),
	"exit_fill_usd" numeric(14, 4),
	"realized_pnl_usd" numeric(14, 2),
	"signaled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"filled_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bot_actions" ADD CONSTRAINT "bot_actions_trade_id_bot_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."bot_trades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_config" ADD CONSTRAINT "bot_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_actions_ts_idx" ON "bot_actions" USING btree ("ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bot_actions_kind_ts_idx" ON "bot_actions" USING btree ("kind","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bot_actions_trade_idx" ON "bot_actions" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX "bot_trades_status_idx" ON "bot_trades" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bot_trades_signaled_idx" ON "bot_trades" USING btree ("signaled_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bot_trades_ticker_idx" ON "bot_trades" USING btree ("source_ticker");