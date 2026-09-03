CREATE TABLE "video_metric_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"views" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_metric_snapshot" ADD CONSTRAINT "video_metric_snapshot_deliverable_id_deliverable_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverable"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_metric_snapshot_deliverable_captured_idx" ON "video_metric_snapshot" USING btree ("deliverable_id","captured_at");