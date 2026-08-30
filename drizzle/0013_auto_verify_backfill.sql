-- KAN-39 phase 2: admin verification is removed — onboarding now creates
-- profiles already verified. Backfill the rows created under the old flow so
-- no creator is stranded in the queue that no longer exists. They surface on
-- /admin/tiers as untiered for manual tier assignment.
UPDATE "creator_profile"
SET "status" = 'verified', "verified_at" = now()
WHERE "status" = 'pending_verification';
