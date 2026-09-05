-- Idempotent by design: the preview database receives deploys from both the
-- dev branch and PR branches whose migration journals diverged at 0017, so any
-- statement here may find its object already in place. Every step either uses
-- IF NOT EXISTS or catches the duplicate error, and the backfills are guarded
-- so re-running them is a no-op.
CREATE TABLE IF NOT EXISTS "deliverable_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"deal_id" uuid NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"submission_version" integer NOT NULL,
	"kind" text NOT NULL,
	"actor_id" uuid,
	"actor_role" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"tiktok_url" text NOT NULL,
	"revision_category" text,
	"note" text,
	"review_cycle_id" uuid,
	"request_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "deliverable_event_seq_unique" UNIQUE("seq"),
	CONSTRAINT "deliverable_event_version_nonnegative" CHECK ("deliverable_event"."submission_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "deliverable" ADD COLUMN IF NOT EXISTS "video_ordinal" integer;--> statement-breakpoint
ALTER TABLE "deliverable" ADD COLUMN IF NOT EXISTS "submission_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "deliverable" ADD COLUMN IF NOT EXISTS "history_completeness" text DEFAULT 'complete' NOT NULL;--> statement-breakpoint
ALTER TABLE "deliverable" ADD COLUMN IF NOT EXISTS "revision_category" text;--> statement-breakpoint
ALTER TABLE "deliverable" ADD COLUMN IF NOT EXISTS "review_cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "video_metric" ADD COLUMN IF NOT EXISTS "submission_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Capture only the surviving current record. This does not reconstruct earlier
-- submissions. Only rows the column was just added to (still NULL) are touched,
-- so a re-run changes nothing.
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY deal_id ORDER BY submitted_at, id)::integer AS ordinal
  FROM deliverable
)
UPDATE deliverable d SET video_ordinal = ordered.ordinal,
  submission_version = 0, history_completeness = 'legacy_baseline'
FROM ordered WHERE d.id = ordered.id AND d.video_ordinal IS NULL;--> statement-breakpoint
ALTER TABLE "deliverable" ALTER COLUMN "video_ordinal" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deliverable" ADD CONSTRAINT "deliverable_id_deal_unique" UNIQUE("id","deal_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deliverable_event" ADD CONSTRAINT "deliverable_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deliverable_event" ADD CONSTRAINT "deliverable_event_deliverable_id_deal_id_deliverable_id_deal_id_fk" FOREIGN KEY ("deliverable_id","deal_id") REFERENCES "public"."deliverable"("id","deal_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deliverable_event_deal_seq_idx" ON "deliverable_event" USING btree ("deal_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deliverable_event_video_seq_idx" ON "deliverable_event" USING btree ("deliverable_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deliverable_event_kind_time_idx" ON "deliverable_event" USING btree ("kind","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deliverable_event_request_unique" ON "deliverable_event" USING btree ("deal_id","request_id") WHERE "deliverable_event"."request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deliverable_event_version_kind_unique" ON "deliverable_event" USING btree ("deliverable_id","submission_version","kind") WHERE "deliverable_event"."kind" not in ('review_ready', 'review_interrupted');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deliverable_event_cycle_unique" ON "deliverable_event" USING btree ("deliverable_id","review_cycle_id","kind") WHERE "deliverable_event"."review_cycle_id" is not null;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deliverable" ADD CONSTRAINT "deliverable_deal_ordinal_unique" UNIQUE("deal_id","video_ordinal");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deliverable" ADD CONSTRAINT "deliverable_ordinal_positive" CHECK ("deliverable"."video_ordinal" > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deliverable" ADD CONSTRAINT "deliverable_version_nonnegative" CHECK ("deliverable"."submission_version" >= 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deliverable" ADD CONSTRAINT "deliverable_history_completeness" CHECK ("deliverable"."history_completeness" in ('complete', 'legacy_baseline'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
INSERT INTO deliverable_event
  (deal_id, deliverable_id, submission_version, kind, actor_role, occurred_at, tiktok_url, note, metadata)
SELECT d.deal_id, d.id, 0, 'legacy_baseline', 'unknown', now(), d.tiktok_url, d.rejection_reason,
  jsonb_build_object(
    'recordedSubmittedAt', d.submitted_at, 'reviewStatus', d.review_status, 'reviewedAt', d.reviewed_at,
    'metrics', CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object(
      'views', m.views, 'likes', m.likes, 'shares', m.shares, 'comments', m.comments,
      'source', m.source, 'lastUpdatedAt', m.last_updated_at, 'stale', m.stale
    ) END
  )
FROM deliverable d LEFT JOIN video_metric m ON m.deliverable_id = d.id
WHERE NOT EXISTS (SELECT 1 FROM deliverable_event e WHERE e.deliverable_id = d.id)
ORDER BY d.deal_id, d.video_ordinal;
