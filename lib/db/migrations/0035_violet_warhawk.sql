ALTER TABLE "bot_config" ALTER COLUMN "entry_repeg_max_drift_pct" SET DEFAULT '10.00';
--> statement-breakpoint
-- Also lower the existing singleton row from its initial 30 → new 10 default.
-- Skip rows where the admin has explicitly tuned to a non-30 value.
UPDATE "bot_config" SET "entry_repeg_max_drift_pct" = '10.00' WHERE "entry_repeg_max_drift_pct" = '30.00';