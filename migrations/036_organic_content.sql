-- Ongoing organic content: a three-month posting plan per business, each post
-- with its media source (AI graphic, AI video or a real photo shoot), and
-- photo-shoot requests the SCORPIO team coordinates.
CREATE TABLE IF NOT EXISTS organic_plans (
  client_id BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED')),
  posts_per_week INT NOT NULL DEFAULT 3 CHECK (posts_per_week BETWEEN 1 AND 7),
  media_mode TEXT NOT NULL DEFAULT 'AI_GRAPHIC' CHECK (media_mode IN ('AI_GRAPHIC','AI_VIDEO','PHOTO','MIXED')),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  last_reminded_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organic_posts (
  id UUID PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  publish_on DATE NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('POST','STORY','REEL')),
  media TEXT NOT NULL CHECK (media IN ('AI_GRAPHIC','AI_VIDEO','PHOTO')),
  purpose TEXT NOT NULL DEFAULT '' CHECK (length(purpose) <= 40),
  topic TEXT NOT NULL CHECK (length(topic) BETWEEN 1 AND 200),
  caption TEXT NOT NULL CHECK (length(caption) BETWEEN 1 AND 1000),
  visual TEXT NOT NULL DEFAULT '' CHECK (length(visual) <= 400),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','SENDING','SENT','SKIPPED','FAILED')),
  attempts INT NOT NULL DEFAULT 0,
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS organic_posts_client_day ON organic_posts(client_id, publish_on);
CREATE INDEX IF NOT EXISTS organic_posts_due ON organic_posts(status, publish_on);

CREATE TABLE IF NOT EXISTS photo_shoot_requests (
  id UUID PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'DETAILS_PENDING' CHECK (status IN ('DETAILS_PENDING','REQUESTED','SCHEDULED','DONE','CANCELLED')),
  details TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS photo_shoot_requests_client ON photo_shoot_requests(client_id, created_at);
