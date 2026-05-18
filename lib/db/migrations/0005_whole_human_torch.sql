CREATE TABLE "radar_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"timeframe" text NOT NULL,
	"signal" text NOT NULL,
	"indicator" text,
	"price" numeric(14, 4),
	"signal_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "radar_signals_ticker_tf_idx" ON "radar_signals" USING btree ("ticker","timeframe");--> statement-breakpoint
CREATE INDEX "radar_signals_signal_at_idx" ON "radar_signals" USING btree ("signal_at" DESC NULLS LAST);