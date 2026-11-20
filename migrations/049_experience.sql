-- Experience wave: onboarding V2 progress, one-time login codes, undo of ad-account actions
-- and the capability registry ("בבדיקה"). Idempotent: safe to run more than once.

-- Onboarding "0 → ready campaign": where each business is, what it answered, follow-ups sent.
CREATE TABLE IF NOT EXISTS onboarding_state (
  client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  step TEXT NOT NULL DEFAULT 'LINK',
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  alerts_consent BOOLEAN,
  alerts_consent_at TIMESTAMPTZ,
  followups_sent TEXT[] NOT NULL DEFAULT '{}',
  tour_seen_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS onboarding_state_started ON onboarding_state(started_at) WHERE completed_at IS NULL;

-- Dashboard sign-in by phone number: a 6-digit code sent on WhatsApp. Only a hash is stored;
-- 10-minute expiry, single use, a few attempts per code.
CREATE TABLE IF NOT EXISTS portal_login_codes (
  id UUID PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS portal_login_codes_client ON portal_login_codes(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_login_codes_expiry ON portal_login_codes(expires_at);

-- "החזר למצב הקודם": one undo per done action, valid 24 hours. The undo itself is a normal
-- action plan that goes through the work agreement / approval rules.
CREATE TABLE IF NOT EXISTS undo_actions (
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_action_id TEXT NOT NULL,
  undo_action_id TEXT,
  channel TEXT NOT NULL DEFAULT 'WHATSAPP',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, source_action_id)
);

-- What is verified end to end with a real customer. Anything not verified shows "בבדיקה".
CREATE TABLE IF NOT EXISTS capability_status (
  key TEXT PRIMARY KEY,
  label_he TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Honest seed: none of these has been verified live with a real customer yet.
INSERT INTO capability_status(key,label_he,verified,note) VALUES
  ('organic_content','תוכן שוטף לסושיאל',FALSE,'not verified live with a real customer'),
  ('buyer_audiences','קהלי קונים ב־Meta',FALSE,'not verified live with a real customer'),
  ('lead_concierge','הסוכן עונה ראשון ללידים',FALSE,'not verified live with a real customer'),
  ('catalog','מה אני מוכר (קטלוג)',FALSE,'not verified live with a real customer'),
  ('onboarding_v2','היכרות מהירה וקמפיין ראשון',FALSE,'new in this release'),
  ('undo','החזרה למצב הקודם',FALSE,'new in this release'),
  ('login_code','כניסה לדשבורד עם קוד',FALSE,'new in this release')
ON CONFLICT (key) DO NOTHING;
