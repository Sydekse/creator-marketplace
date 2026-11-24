-- Idempotent by design — see 0020 for why: the preview database receives
-- deploys from journals that diverged at 0017, so any object here may already
-- exist.
CREATE TABLE IF NOT EXISTS "deadline_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"proposed_by" uuid NOT NULL,
	"proposer_role" text NOT NULL,
	"previous_due_at" timestamp with time zone NOT NULL,
	"proposed_due_at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"closure_reason" text,
	CONSTRAINT "deadline_request_later" CHECK ("deadline_request"."proposed_due_at" > "deadline_request"."previous_due_at" and "deadline_request"."proposed_due_at" > "deadline_request"."proposed_at"),
	CONSTRAINT "deadline_request_role" CHECK ("deadline_request"."proposer_role" in ('brand', 'creator')),
	CONSTRAINT "deadline_request_decision" CHECK (("deadline_request"."status" = 'pending' and "deadline_request"."decided_at" is null and "deadline_request"."decided_by" is null and "deadline_request"."closure_reason" is null) or ("deadline_request"."status" in ('accepted','rejected','withdrawn') and "deadline_request"."decided_at" is not null and "deadline_request"."decided_by" is not null and "deadline_request"."closure_reason" is null) or ("deadline_request"."status" = 'closed' and "deadline_request"."decided_at" is not null and "deadline_request"."closure_reason" is not null and "deadline_request"."closure_reason" in ('first_delivery','refunded'))),
	CONSTRAINT "deadline_request_decider" CHECK (("deadline_request"."status" not in ('accepted','rejected') or "deadline_request"."decided_by" <> "deadline_request"."proposed_by") and ("deadline_request"."status" <> 'withdrawn' or "deadline_request"."decided_by" = "deadline_request"."proposed_by")),
	CONSTRAINT "deadline_request_decision_time" CHECK ("deadline_request"."decided_at" is null or ("deadline_request"."decided_at" >= "deadline_request"."proposed_at" and ("deadline_request"."status" <> 'accepted' or "deadline_request"."proposed_due_at" > "deadline_request"."decided_at")))
);
--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN IF NOT EXISTS "delivery_window_days" integer;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "delivery_window_days" integer;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "funded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "original_delivery_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "current_delivery_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "first_delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "due_at_first_delivery" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "missed_delivery_commitment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deadline_request" ADD CONSTRAINT "deadline_request_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deadline_request" ADD CONSTRAINT "deadline_request_proposed_by_user_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deadline_request" ADD CONSTRAINT "deadline_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deadline_request_one_pending" ON "deadline_request" USING btree ("deal_id") WHERE "deadline_request"."status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deadline_request_deal_time_idx" ON "deadline_request" USING btree ("deal_id","proposed_at");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "campaign" ADD CONSTRAINT "campaign_delivery_window_valid" CHECK ("campaign"."delivery_window_days" between 1 and 90);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deal" ADD CONSTRAINT "deal_delivery_window_valid" CHECK ("deal"."delivery_window_days" between 1 and 90);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deal" ADD CONSTRAINT "deal_delivery_dates_valid" CHECK (("deal"."original_delivery_due_at" is null and "deal"."current_delivery_due_at" is null) or ("deal"."delivery_window_days" is not null and "deal"."funded_at" is not null and "deal"."original_delivery_due_at" is not null and "deal"."current_delivery_due_at" is not null and "deal"."original_delivery_due_at" > "deal"."funded_at" and "deal"."current_delivery_due_at" >= "deal"."original_delivery_due_at"));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "deal" ADD CONSTRAINT "deal_first_delivery_due_valid" CHECK ("deal"."due_at_first_delivery" is null or ("deal"."first_delivered_at" is not null and "deal"."current_delivery_due_at" is not null and "deal"."due_at_first_delivery" = "deal"."current_delivery_due_at"));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
