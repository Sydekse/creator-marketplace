CREATE TABLE "refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"funding_tx_ref" text NOT NULL,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "refund_deal_id_unique" UNIQUE("deal_id"),
	CONSTRAINT "refund_amount_positive" CHECK ("refund"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_status_created_idx" ON "refund" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "refund_funding_tx_ref_idx" ON "refund" USING btree ("funding_tx_ref");