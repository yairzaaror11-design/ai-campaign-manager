'use strict';
// Capability registry: what is verified end to end with a real customer. Anything not verified
// shows a small "בבדיקה" badge in the dashboard, and the agent words it as "חדש, בבדיקה".
// Never present a capability as proven before it really is.
const db = require('./db');
const copy = require('./onboardingCopy');

// Used when the database is not reachable: the honest default is "not verified".
const DEFAULTS = {
  organic_content: 'תוכן שוטף לסושיאל', buyer_audiences: 'קהלי קונים ב־Meta', lead_concierge: 'הסוכן עונה ראשון ללידים',
  catalog: 'מה אני מוכר (קטלוג)', onboarding_v2: 'היכרות מהירה וקמפיין ראשון', undo: 'החזרה למצב הקודם', login_code: 'כניסה לדשבורד עם קוד'
};
// Dashboard card / screen titles that belong to each capability (for the badge).
const TITLES = {
  organic_content: ['תוכן שוטף', 'לוח תוכן לסושיאל'], lead_concierge: ['🤖 הסוכן עונה ראשון ללידים'],
  catalog: ['מה העסק מוכר?'], buyer_audiences: ['קהלי קונים']
};

async function list() {
  let rows = [];
  try { rows = (await db.query('SELECT key,label_he,verified,verified_at FROM capability_status ORDER BY key')).rows; } catch { rows = []; }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const [key, label] of Object.entries(DEFAULTS)) if (!byKey.has(key)) byKey.set(key, { key, label_he: label, verified: false, verified_at: null });
  return [...byKey.values()].map((r) => ({ key: r.key, label: r.label_he, verified: !!r.verified, verifiedAt: r.verified_at || null, badge: r.verified ? null : copy.testingBadge, titles: TITLES[r.key] || [] }));
}
async function verified(key) { return !!(await list()).find((c) => c.key === key)?.verified; }
// Operator switch, after a real customer used it end to end.
async function mark(key, isVerified, note = null) {
  if (!/^[a-z0-9_]{2,40}$/.test(String(key))) throw Error('INVALID_CAPABILITY');
  await db.query(`INSERT INTO capability_status(key,label_he,verified,verified_at,note) VALUES($1,$2,$3,CASE WHEN $3 THEN NOW() END,$4)
    ON CONFLICT(key) DO UPDATE SET verified=EXCLUDED.verified,verified_at=EXCLUDED.verified_at,note=COALESCE(EXCLUDED.note,capability_status.note),updated_at=NOW()`,
  [key, DEFAULTS[key] || key, !!isVerified, note]);
}
// Agent wording: append the "חדש, בבדיקה" line to a reply about an unverified capability,
// at most once a day per business and capability (so it informs without nagging).
async function decorate(key, reply, clientId = null) {
  if (typeof reply !== 'string' || !reply || reply.includes(copy.testingWord)) return reply;
  const c = (await list()).find((x) => x.key === key);
  if (!c || c.verified) return reply;
  if (clientId != null) { try { if (!await require('./rateLimit').take('capability-note:' + key + ':' + clientId, 1, 86400)) return reply; } catch { /* say it anyway */ } }
  return reply + '\n\n' + copy.testingNote(c.label);
}
// One line for "what can you do" answers.
async function testingLine() {
  const open = (await list()).filter((c) => !c.verified && ['organic_content', 'buyer_audiences', 'lead_concierge', 'catalog'].includes(c.key));
  return open.length ? copy.testingListLine(open.map((c) => c.label)) : '';
}

module.exports = { list, verified, mark, decorate, testingLine, DEFAULTS, TITLES };
