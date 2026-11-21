-- Work agreement (הסכם עבודה): a standing owner mandate stored as an authority_mandates row
-- with policy->>'kind'='WORK_AGREEMENT'. Adds a PAUSED state (one-tap "stop all automatic
-- actions"), the agreement audit events, and one live agreement per business.
ALTER TABLE authority_mandates DROP CONSTRAINT IF EXISTS authority_mandates_status_check;
ALTER TABLE authority_mandates ADD CONSTRAINT authority_mandates_status_check CHECK (status IN ('DRAFT','ACTIVE','PAUSED','REVOKED'));
ALTER TABLE authority_audit DROP CONSTRAINT IF EXISTS authority_audit_event_check;
ALTER TABLE authority_audit ADD CONSTRAINT authority_audit_event_check CHECK (event IN ('PROPOSED','APPROVED','REVOKED','ACTION_AUTHORIZED','AGREEMENT_SET','PAUSED','RESUMED'));
CREATE UNIQUE INDEX IF NOT EXISTS authority_one_work_agreement ON authority_mandates(client_id)
  WHERE status IN ('ACTIVE','PAUSED') AND policy->>'kind'='WORK_AGREEMENT';
-- Why the agent acted on its own (shown in "מה עשיתי ולמה").
ALTER TABLE authority_uses ADD COLUMN IF NOT EXISTS reason TEXT;
-- How long an approval stays valid depends on what it does (protective / spending / neutral).
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS action_class TEXT;
