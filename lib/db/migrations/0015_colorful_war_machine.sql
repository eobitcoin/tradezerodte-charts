CREATE TABLE "cross_market_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poly_condition_id" text NOT NULL,
	"poly_outcome" text,
	"kalshi_ticker" text NOT NULL,
	"status" text NOT NULL,
	"similarity_score" numeric(5, 4),
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kalshi_markets" (
	"ticker" text PRIMARY KEY NOT NULL,
	"event_ticker" text NOT NULL,
	"series_ticker" text,
	"title" text NOT NULL,
	"subtitle" text,
	"category" text,
	"yes_bid" numeric(6, 4),
	"yes_ask" numeric(6, 4),
	"last_price" numeric(6, 4),
	"volume" numeric(20, 4),
	"volume_24h" numeric(20, 4),
	"open_interest" numeric(20, 4),
	"status" text,
	"close_time" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cross_market_pairings" ADD CONSTRAINT "cross_market_pairings_kalshi_ticker_kalshi_markets_ticker_fk" FOREIGN KEY ("kalshi_ticker") REFERENCES "public"."kalshi_markets"("ticker") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_market_pairings" ADD CONSTRAINT "cross_market_pairings_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cross_market_pairings_unique" ON "cross_market_pairings" USING btree ("poly_condition_id","poly_outcome","kalshi_ticker");--> statement-breakpoint
CREATE INDEX "cross_market_pairings_status_idx" ON "cross_market_pairings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cross_market_pairings_poly_idx" ON "cross_market_pairings" USING btree ("poly_condition_id");--> statement-breakpoint
CREATE INDEX "kalshi_markets_status_close_idx" ON "kalshi_markets" USING btree ("status","close_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "kalshi_markets_event_idx" ON "kalshi_markets" USING btree ("event_ticker");