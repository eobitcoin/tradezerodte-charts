CREATE TABLE "research_upload_chunks" (
	"upload_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_total" integer NOT NULL,
	"data_b64" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "research_upload_chunks_pk_idx" ON "research_upload_chunks" USING btree ("upload_id","chunk_index");