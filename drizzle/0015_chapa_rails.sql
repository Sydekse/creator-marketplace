CREATE TABLE "funding_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"tx_ref" text NOT NULL,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'initialized' NOT NULL,
	"checkout_url" text NOT NULL,
	"provider_ref" text,
	"failure_reason" text,
	"verified_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funding_session_tx_ref_unique" UNIQUE("tx_ref"),
	CONSTRAINT "funding_session_amount_positive" CHECK ("funding_session"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payout_method" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"bank_code" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_number" text NOT NULL,
	"account_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_method_creator_id_unique" UNIQUE("creator_id")
);
--> statement-breakpoint
CREATE TABLE "withdrawal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tx_ref" text NOT NULL,
	"provider_ref" text,
	"method_kind" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_number_masked" text NOT NULL,
	"account_name" text NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "withdrawal_tx_ref_unique" UNIQUE("tx_ref"),
	CONSTRAINT "withdrawal_amount_positive" CHECK ("withdrawal"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "funding_session" ADD CONSTRAINT "funding_session_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_session" ADD CONSTRAINT "funding_session_brand_id_brand_profile_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_method" ADD CONSTRAINT "payout_method_creator_id_creator_profile_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal" ADD CONSTRAINT "withdrawal_creator_id_creator_profile_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "funding_session_open_unique" ON "funding_session" USING btree ("campaign_id") WHERE "funding_session"."status" = 'initialized';--> statement-breakpoint
CREATE INDEX "funding_session_campaign_idx" ON "funding_session" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "withdrawal_creator_created_idx" ON "withdrawal" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "withdrawal_status_created_idx" ON "withdrawal" USING btree ("status","created_at");