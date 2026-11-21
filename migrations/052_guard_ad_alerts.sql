-- Campaign guard: ad-level "pause this one ad" proposals (PAUSE_AD) use their own alert kind.
ALTER TABLE campaign_guard_alerts DROP CONSTRAINT IF EXISTS campaign_guard_alerts_kind_check;
ALTER TABLE campaign_guard_alerts ADD CONSTRAINT campaign_guard_alerts_kind_check
  CHECK (kind IN ('ACCOUNT','DELIVERY','WASTE','WINNER','FATIGUE','SPEND_CAP','BURN_NO_LEADS','HIGH_CPL','AD_NO_LEADS'));
