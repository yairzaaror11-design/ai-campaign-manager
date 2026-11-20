-- Senders we cannot serve yet (not on the pilot list, or past the daily new-customer cap).
-- We keep their number so the team can get back to them, and reply at most once a day.
CREATE TABLE IF NOT EXISTS pilot_waitlist (
 phone TEXT PRIMARY KEY,
 display_name TEXT,
 reason TEXT NOT NULL CHECK(reason IN ('NOT_IN_PILOT','DAILY_CAP')),
 messages INTEGER NOT NULL DEFAULT 1,
 first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_notice_on DATE
);
