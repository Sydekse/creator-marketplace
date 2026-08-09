CREATE TABLE "campaign_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"video_count" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"total_price" integer NOT NULL,
	"commission_rate" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_item_campaign_creator_unique" UNIQUE("campaign_id","creator_id"),
	CONSTRAINT "campaign_item_total_price_valid" CHECK ("campaign_item"."total_price" = "campaign_item"."unit_price" * "campaign_item"."video_count")
);
--> statement-breakpoint
ALTER TABLE "campaign_item" ADD CONSTRAINT "campaign_item_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_item" ADD CONSTRAINT "campaign_item_creator_id_creator_profile_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creator_profile"("id") ON DELETE no action ON UPDATE no action;