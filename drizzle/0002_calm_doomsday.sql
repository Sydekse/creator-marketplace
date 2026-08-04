CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_created_idx" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_created_idx" ON "audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
-- KAN-52 — everything below this line is hand-written; drizzle-kit cannot
-- express a trigger, so it is appended to the generated migration rather than
-- kept in a file the journal does not know about.
--
-- The acceptance criterion is "the table is insert-only; no application code
-- path updates or deletes a row". That is a statement about code, and code is
-- what changes: an UPDATE against this table would be an ordinary-looking line
-- in some future admin ticket, it would pass review as easily as anything else,
-- and the damage would be silent and unrecoverable. So the rule is enforced
-- where it cannot be edited by accident.
--
-- Same reasoning as the `campaign_budget_positive` check constraint in 0000 —
-- the server-side guard is the control, and the database is the line behind it.
CREATE OR REPLACE FUNCTION audit_log_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is insert-only; % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_forbid_mutation();--> statement-breakpoint
-- TRUNCATE bypasses row-level triggers entirely, so it needs its own
-- statement-level one. Without this, `TRUNCATE audit_log` empties the table
-- while the trigger above reports nothing wrong.
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_forbid_mutation();
