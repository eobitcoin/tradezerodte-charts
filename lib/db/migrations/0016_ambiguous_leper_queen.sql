CREATE TABLE "economic_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"country" text,
	"event_time" timestamp with time zone NOT NULL,
	"importance" text DEFAULT 'low' NOT NULL,
	"actual" numeric(24, 6),
	"estimate" numeric(24, 6),
	"prior" numeric(24, 6),
	"unit" text,
	"description" text,
	"impact_text" text,
	"asset_tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"source" text DEFAULT 'finnhub' NOT NULL,
	"raw" jsonb,
	"week_of" date NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "economic_events_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE INDEX "economic_events_time_idx" ON "economic_events" USING btree ("event_time");--> statement-breakpoint
CREATE INDEX "economic_events_week_idx" ON "economic_events" USING btree ("week_of","event_time");--> statement-breakpoint
CREATE INDEX "economic_events_importance_idx" ON "economic_events" USING btree ("importance","event_time");