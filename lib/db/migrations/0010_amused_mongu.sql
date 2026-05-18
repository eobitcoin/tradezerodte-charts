CREATE TABLE "polymarket_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_hash" text NOT NULL,
	"asset" text NOT NULL,
	"wallet" text NOT NULL,
	"condition_id" text NOT NULL,
	"side" text NOT NULL,
	"size" numeric(24, 6) NOT NULL,
	"price" numeric(10, 6) NOT NULL,
	"usd_value" numeric(20, 4) NOT NULL,
	"outcome" text,
	"outcome_index" integer,
	"title" text,
	"slug" text,
	"event_slug" text,
	"timestamp" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "polymarket_trades_uniq_idx" ON "polymarket_trades" USING btree ("transaction_hash","asset");--> statement-breakpoint
CREATE INDEX "polymarket_trades_wallet_ts_idx" ON "polymarket_trades" USING btree ("wallet","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "polymarket_trades_condition_ts_idx" ON "polymarket_trades" USING btree ("condition_id","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "polymarket_trades_ts_idx" ON "polymarket_trades" USING btree ("timestamp" DESC NULLS LAST);