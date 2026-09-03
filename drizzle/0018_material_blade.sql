CREATE TABLE "notification_pref" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email_deals" boolean DEFAULT true NOT NULL,
	"email_money" boolean DEFAULT true NOT NULL,
	"email_account" boolean DEFAULT true NOT NULL,
	"email_reminders" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_pref_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "notification_pref" ADD CONSTRAINT "notification_pref_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;