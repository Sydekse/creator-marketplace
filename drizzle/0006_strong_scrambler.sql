ALTER TABLE "ledger_entry" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_seq_unique" UNIQUE("seq");