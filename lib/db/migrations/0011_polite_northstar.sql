CREATE TABLE "polymarket_events" (
	"event_slug" text PRIMARY KEY NOT NULL,
	"category" text,
	"title" text,
	"tag_slugs" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "polymarket_events_category_idx" ON "polymarket_events" USING btree ("category");