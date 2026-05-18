CREATE TABLE "polymarket_wallet_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"realized_pnl" numeric(20, 4) DEFAULT '0' NOT NULL,
	"unrealized_pnl" numeric(20, 4) DEFAULT '0' NOT NULL,
	"capital_deployed_usd" numeric(20, 4) DEFAULT '0' NOT NULL,
	"roi" numeric(12, 6),
	"position_count" integer DEFAULT 0 NOT NULL,
	"composite_score" numeric(14, 4),
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "polymarket_wallets" (
	"address" text PRIMARY KEY NOT NULL,
	"pseudonym" text,
	"display_name" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"trades_seen" integer DEFAULT 0 NOT NULL,
	"whale_trades_seen" integer DEFAULT 0 NOT NULL,
	"total_volume_usd" numeric(20, 2) DEFAULT '0' NOT NULL,
	"last_scored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "polymarket_wallet_scores" ADD CONSTRAINT "polymarket_wallet_scores_wallet_polymarket_wallets_address_fk" FOREIGN KEY ("wallet") REFERENCES "public"."polymarket_wallets"("address") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "polymarket_wallet_scores_wallet_idx" ON "polymarket_wallet_scores" USING btree ("wallet","scored_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "polymarket_wallet_scores_composite_idx" ON "polymarket_wallet_scores" USING btree ("composite_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "polymarket_wallets_last_seen_idx" ON "polymarket_wallets" USING btree ("last_seen" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "polymarket_wallets_volume_idx" ON "polymarket_wallets" USING btree ("total_volume_usd" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "polymarket_wallets_last_scored_idx" ON "polymarket_wallets" USING btree ("last_scored_at" NULLS FIRST);