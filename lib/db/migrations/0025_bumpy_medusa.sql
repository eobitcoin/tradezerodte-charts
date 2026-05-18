CREATE TABLE "bot_alma_state" (
	"ticker" text PRIMARY KEY NOT NULL,
	"side" text NOT NULL,
	"ready_at" timestamp with time zone DEFAULT now() NOT NULL,
	"alma_at_cross" numeric(14, 4) NOT NULL,
	"vwap_at_cross" numeric(14, 4) NOT NULL,
	"slope_pct_at_cross" numeric(8, 4) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma_watchlist" text[] DEFAULT ARRAY['SPY','QQQ']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_config" ADD COLUMN "alma_steep_slope_pct" numeric(6, 4) DEFAULT '0.05' NOT NULL;