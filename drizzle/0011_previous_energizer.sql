CREATE TABLE "provider_hold" (
	"provider_ref" text PRIMARY KEY NOT NULL,
	"amount_remaining" integer NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
