-- Existing customers (won deals) also get a follow-up suggestion: review, referral or repeat sale.
ALTER TABLE lead_checkins DROP CONSTRAINT IF EXISTS lead_checkins_stage_check;
ALTER TABLE lead_checkins ADD CONSTRAINT lead_checkins_stage_check CHECK (stage IN ('NEW','CONTACTED','APPOINTMENT','WON'));
