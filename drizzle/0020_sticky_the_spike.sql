CREATE TABLE "creator_metric_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"follower_count" integer NOT NULL,
	"engagement_rate" numeric(5, 2),
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'tiktok' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_metric_snapshot" ADD COLUMN "likes" integer;--> statement-breakpoint
ALTER TABLE "video_metric_snapshot" ADD COLUMN "shares" integer;--> statement-breakpoint
ALTER TABLE "video_metric_snapshot" ADD COLUMN "comments" integer;--> statement-breakpoint
ALTER TABLE "creator_metric_snapshot" ADD CONSTRAINT "creator_metric_snapshot_creator_id_creator_profile_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_metric_snapshot_creator_captured_idx" ON "creator_metric_snapshot" USING btree ("creator_id","captured_at");