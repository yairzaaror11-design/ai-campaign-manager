-- Sign in to the dashboard with Google. A Google account (its stable "sub" id) is linked to one
-- business; a business may have several linked Google accounts. Flows are short-lived and single use.
-- Idempotent: safe to run more than once.
CREATE TABLE IF NOT EXISTS google_login_identities (
  sub TEXT PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS google_login_identities_client ON google_login_identities(client_id);

-- LOGIN / LINK: one OAuth round trip (state + PKCE verifier, bound to the browser by a cookie).
-- PENDING: a verified Google account that is not linked yet; linked after the owner signs in once
-- with the WhatsApp link or the phone code, in the same browser, within 15 minutes.
CREATE TABLE IF NOT EXISTS google_login_flows (
  token_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('LOGIN','LINK','PENDING')),
  verifier TEXT,
  client_id BIGINT REFERENCES clients(id) ON DELETE CASCADE,
  sub TEXT,
  email TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS google_login_flows_expires ON google_login_flows(expires_at);
