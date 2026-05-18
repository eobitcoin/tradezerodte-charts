CREATE TABLE "crypto_radar_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"timeframe" text NOT NULL,
	"signal" text NOT NULL,
	"indicator" text,
	"price" numeric(20, 8),
	"signal_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "crypto_radar_signals_ticker_tf_idx" ON "crypto_radar_signals" USING btree ("ticker","timeframe");--> statement-breakpoint
CREATE INDEX "crypto_radar_signals_signal_at_idx" ON "crypto_radar_signals" USING btree ("signal_at" DESC NULLS LAST);