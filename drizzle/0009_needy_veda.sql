ALTER TABLE "deliverable" DROP CONSTRAINT "deliverable_deal_id_unique";--> statement-breakpoint
CREATE INDEX "deliverable_deal_id_idx" ON "deliverable" USING btree ("deal_id");