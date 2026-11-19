'use strict';
// "What did you do and why": a plain Hebrew log of everything SCORPIO did or
// prepared in the ad account and in content, so the owner never wonders.
const db = require('./db');

const STATUS = { VERIFIED: 'בוצע ✅', APPROVED: 'אושר, בביצוע', PROPOSED: 'מחכה לאישור שלך', CANCELLED: 'בוטל', BLOCKED: 'לא בוצע (חסרה הרשאה)', MANUAL_REVIEW: 'בבדיקה' };
const REQUEST = /^(?:מה עשית(?: השבוע| לאחרונה| בחשבון| בחשבון שלי)?|יומן פעולות|מה עשית בשבילי)[?？]?$/;

async function list(clientId, { days = 7 } = {}) {
  const intents = require('./actionPlan').INTENT_HE;
  const plans = (await db.query(`SELECT id,intent,payload,status,updated_at FROM action_plans
    WHERE client_id=$1 AND updated_at>NOW()-($2::int*INTERVAL '1 day') ORDER BY updated_at DESC LIMIT 30`, [clientId, days])).rows;
  const items = plans.map((p) => {
    const t = p.payload?.target || {}, name = t.campaignName || p.payload?.parameters?.name || '';
    return {
      at: p.updated_at,
      what: (intents[p.intent] || 'פעולה בחשבון הפרסום') + (name ? `: ${name}` : ''),
      why: String(p.payload?.summary || p.payload?.reason || '').slice(0, 300),
      status: STATUS[p.status] || 'בטיפול',
      kind: 'ad'
    };
  });
  let posts = [];
  try {
    posts = (await db.query(`SELECT topic,sent_at FROM organic_posts WHERE client_id=$1 AND status='SENT' AND sent_at>NOW()-($2::int*INTERVAL '1 day') ORDER BY sent_at DESC LIMIT 10`, [clientId, days])).rows;
  } catch { posts = []; }
  for (const p of posts) items.push({ at: p.sent_at, what: `שלחתי לך פוסט מוכן: "${p.topic}"`, why: 'לפי לוח התוכן שאישרת', status: 'נשלח ✅', kind: 'content' });
  return items.sort((a, b) => new Date(b.at) - new Date(a.at));
}

const day = (d) => new Date(d).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'short', day: 'numeric', month: 'numeric' });

async function handle(clientId, text) {
  if (!REQUEST.test(String(text || '').trim())) return null;
  const items = await list(clientId);
  if (!items.length) return { handled: true, reply: 'השבוע לא עשיתי שום פעולה בחשבון הפרסום שלך. כל פעולה שאני מכין מחכה קודם לאישור שלך ✋' };
  const lines = items.slice(0, 8).map((x) => `• ${day(x.at)} · ${x.what} · ${x.status}` + (x.why ? `\n  למה: ${x.why.slice(0, 140)}` : ''));
  return { handled: true, reply: `📋 מה עשיתי ב־7 הימים האחרונים:\n\n${lines.join('\n')}\n\nשום דבר שעולה כסף לא בוצע בלי האישור שלך.\n${require('./dashboardLink').hint('approvals')}` };
}

module.exports = { list, handle, REQUEST };
