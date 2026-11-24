-- Idempotent by design — see 0020 for why: the preview database receives
-- deploys from journals that diverged at 0017, so any object here may already
-- exist (this file's content previously shipped as 0020_sticky_the_spike on
-- the pre-merge branch).
CREATE TABLE IF NOT EXISTS "creator_metric_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"follower_count" integer NOT NULL,
	"engagement_rate" numeric(5, 2),
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'tiktok' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_metric_snapshot" ADD COLUMN IF NOT EXISTS "likes" integer;--> statement-breakpoint
ALTER TABLE "video_metric_snapshot" ADD COLUMN IF NOT EXISTS "shares" integer;--> statement-breakpoint
ALTER TABLE "video_metric_snapshot" ADD COLUMN IF NOT EXISTS "comments" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "creator_metric_snapshot" ADD CONSTRAINT "creator_metric_snapshot_creator_id_creator_profile_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profile"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creator_metric_snapshot_creator_captured_idx" ON "creator_metric_snapshot" USING btree ("creator_id","captured_at");
