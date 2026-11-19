'use strict';
// SCORPIO follows up on its own: it asks the owner how each lead is progressing
// (contacted? meeting? deal?) with one-tap status buttons, inside business hours,
// without nagging or interrupting an open decision.
const db = require('./db');
const { logger } = require('./logger');

const enabled = () => process.env.LEAD_CHECKINS_ENABLED !== 'false';

// Stage -> how long to wait after the lead entered it, and what to ask.
const RULES = {
  NEW: { afterHours: 2, ask: (name, hours) => `${name} השאיר/ה פרטים לפני ${hours} שעות. הספקת לחזור?` },
  CONTACTED: { afterHours: 48, ask: (name) => `איך מתקדם עם ${name}? נקבעה פגישה או שיחה?` },
  APPOINTMENT: { afterHours: 48, ask: (name) => `איך הייתה הפגישה עם ${name}? נסגרה עסקה?` }
};
const QUIET_HOURS = 3; // at most one check-in per owner in this window

function israelHour(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, hour: Number(p.hour) };
}
// Sunday–Friday, 09:00–20:00 Israel time.
function businessHours(now = new Date()) {
  const t = israelHour(now);
  return t.weekday !== 'Sat' && t.hour >= 9 && t.hour < 20;
}

// The oldest lead per owner that is due for a question it has not been asked yet.
async function dueLeads(limit = 200) {
  return (await db.query(`SELECT DISTINCT ON (l.client_id) l.id, l.client_id, l.name, l.status, l.version,
      EXTRACT(EPOCH FROM NOW()-l.updated_at)/3600 AS hours_in_stage, c.phone
    FROM crm_leads l
    JOIN clients c ON c.id=l.client_id
    JOIN whatsapp_contacts w ON w.phone=c.phone AND w.last_inbound_at>NOW()-INTERVAL '24 hours'
    WHERE l.status IN ('NEW','CONTACTED','APPOINTMENT')
      AND l.updated_at < NOW() - make_interval(hours => CASE l.status WHEN 'NEW' THEN $1::int ELSE $2::int END)
      AND l.updated_at > NOW() - INTERVAL '30 days'
      AND NOT EXISTS (SELECT 1 FROM lead_checkins k WHERE k.lead_id=l.id AND k.stage=l.status)
      AND NOT EXISTS (SELECT 1 FROM lead_checkins k WHERE k.client_id=l.client_id AND k.sent_at>NOW()-make_interval(hours => $3::int))
    ORDER BY l.client_id, l.updated_at
    LIMIT $4`, [RULES.NEW.afterHours, RULES.CONTACTED.afterHours, QUIET_HOURS, limit])).rows;
}

// Don't interrupt: skip owners with an open decision, CRM flow or human support.
async function ownerBusy(clientId) {
  const p = await require('./marketingStore').load(clientId);
  if (p?.crmFocus || p?.crmIntake || p?.crmFollowup) return true;
  if (p?.ui && p.ui.expiresAt > Date.now() && p.ui.decisionKey !== 'crm_status') return true;
  return !!(await require('./humanSupport').current(clientId))?.bot_paused;
}

async function askOne(lead) {
  const claim = await db.query('INSERT INTO lead_checkins(lead_id,stage,client_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING lead_id', [lead.id, lead.status, lead.client_id]);
  if (!claim.rows.length) return 'ALREADY_ASKED';
  const name = String(lead.name || 'הפונה').slice(0, 40);
  const question = RULES[lead.status].ask(name, Math.max(1, Math.round(Number(lead.hours_in_stage))));
  return require('./metaConnection').context.run(String(lead.client_id), () =>
    require('./whatsappDelivery').messageContext.run({ eventId: `checkin:${lead.id}:${lead.status}`, sequence: 0 }, async () => {
      // Focus the lead so the status buttons update exactly this lead (optimistic version check).
      await require('./marketingStore').update(lead.client_id, null, (p) => { p.crmFocus = { id: lead.id, version: lead.version }; return { handled: false, changed: true }; });
      const ui = await require('./conversationUi').prepare(lead.client_id, question, 'crm_status');
      await require('./whatsapp').safeSend(lead.phone, ui.text, ui);
      return 'ASKED';
    }));
}

async function runDue({ now = new Date() } = {}) {
  if (!enabled() || !db.configured() || !businessHours(now)) return { status: 'NOT_DUE' };
  const results = [];
  for (const lead of await dueLeads()) {
    try {
      if (await ownerBusy(lead.client_id)) { results.push('BUSY'); continue; }
      results.push(await askOne(lead));
    } catch (error) {
      logger.warn('Lead check-in not sent', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'CHECKIN_FAILED' });
      results.push('FAILED');
    }
  }
  return { status: 'RAN', results };
}

module.exports = { enabled, businessHours, runDue, RULES };
