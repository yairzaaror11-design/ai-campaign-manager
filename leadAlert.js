'use strict';
// Speed to lead: the moment a new lead is saved, the business owner gets it on
// WhatsApp with a ready reply and a one-tap link to message the lead.
const db = require('./db');
const { logger } = require('./logger');

const enabled = () => process.env.LEAD_ALERTS_ENABLED !== 'false';

// Israeli local numbers (05x...) become international (9725x...); others keep their digits.
function waNumber(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (/^0\d{8,9}$/.test(digits)) digits = '972' + digits.slice(1);
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0].slice(0, 30);

function suggestedReply(lead, businessName) {
  const hello = lead.name && lead.name !== 'ליד מ־Meta' ? `היי ${firstName(lead.name)}` : 'היי';
  const from = businessName ? ` מ${businessName}` : '';
  return `${hello}, כאן${from}. ראינו שהשארת פרטים, תודה! מתי נוח לך לדבר כמה דקות?`;
}

function alertText(lead, reply, { buttons = false, answers = [] } = {}) {
  const lines = ['🔔 ליד חדש נכנס עכשיו'];
  lines.push('שם: ' + (lead.name || 'לא צוין'));
  if (lead.phone) lines.push('טלפון: ' + lead.phone);
  if (lead.email) lines.push('אימייל: ' + lead.email);
  for (const a of answers.slice(0, 3)) lines.push(`${a.question}: ${a.answer}`);
  lines.push('');
  lines.push('כדאי לחזור אליו כמה שיותר מהר. פנייה בדקות הראשונות מגדילה מאוד את הסיכוי לסגור.');
  const number = waNumber(lead.phone);
  if (number) {
    lines.push('');
    lines.push('הודעה אישית מוכנה, נשלחת מהוואטסאפ שלך בלחיצה אחת:');
    lines.push('״' + reply + '״');
    lines.push(`https://wa.me/${number}?text=${encodeURIComponent(reply)}`);
  }
  lines.push('');
  lines.push(buttons ? 'אחרי שחזרת, לחצו על הכפתור למטה.' : 'אחרי שחזרת, כתבו: התקשרתי');
  lines.push('לעדכון מצב הפנייה בהמשך, כתבו: הלידים שלי');
  lines.push(require('./dashboardLink').hint('leads'));
  return lines.join('\n');
}

async function businessNameFor(clientId) {
  try {
    const profile = await require('./marketingStore').load(clientId);
    const name = profile ? require('./conversationFacts').all(profile).businessName : null;
    return typeof name === 'string' ? name.slice(0, 60) : null;
  } catch { return null; }
}

// Queues the alert once per lead. Inside the 24-hour window it is a full message with a
// personal ready reply (AI or template) and "I contacted them" buttons; outside it, an
// approved template (LEAD_ALERT_TEMPLATE) invites the owner back.
async function notifyOwner(clientId, lead, { answers = [], writer, buttons: allowButtons } = {}) {
  if (!enabled() || !lead?.id) return { status: 'SKIPPED' };
  try {
    const owner = (await db.query(`SELECT c.phone, w.last_inbound_at>NOW()-INTERVAL '24 hours' AS open
      FROM clients c LEFT JOIN whatsapp_contacts w ON w.phone=c.phone WHERE c.id=$1`, [clientId])).rows[0];
    if (!owner?.phone) return { status: 'NO_OWNER' };
    const speed = require('./leadSpeed');
    const reply = (await speed.firstMessage(clientId, lead, { answers, writer })).text;
    await speed.saveMessage(clientId, lead.id, reply).catch(() => {});
    return await require('./metaConnection').context.run(String(clientId), () =>
      require('./whatsappDelivery').messageContext.run({ eventId: 'lead-alert:' + lead.id, sequence: 0, humanSupportNotice: false }, async () => {
        const delivery = require('./whatsappDelivery');
        if (owner.open) {
          const buttons = allowButtons === false ? false : await canShowButtons(clientId);
          const first = await delivery.enqueue(owner.phone, delivery.textPayload(alertText(lead, reply, { buttons, answers })));
          if (first.queued) await rememberLead(clientId, lead, buttons, owner.phone);
          return { status: 'QUEUED' };
        }
        const template = process.env.LEAD_ALERT_TEMPLATE;
        if (template) { await delivery.enqueueTemplate(owner.phone, template, process.env.LEAD_ALERT_TEMPLATE_LANGUAGE || 'he'); return { status: 'TEMPLATE_QUEUED' }; }
        return { status: 'WINDOW_CLOSED' };
      }));
  } catch (error) {
    logger.warn('Lead alert not queued', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'ALERT_FAILED' });
    return { status: 'FAILED' };
  }
}

// Buttons replace the owner's current menu, so only when no other decision is open.
async function canShowButtons(clientId) {
  try {
    const p = await require('./marketingStore').load(clientId);
    return !(p?.ui && p.ui.expiresAt > Date.now() && !['crm_status', 'crm_leads', 'lead_contact'].includes(p.ui.decisionKey));
  } catch { return false; }
}

// The newest alerted lead answers plain "התקשרתי"; with buttons, one tap marks it contacted.
async function rememberLead(clientId, lead, buttons, phone) {
  await require('./marketingStore').update(clientId, null, (p) => { p.leadSpeedLast = lead.id; return { handled: false, changed: true }; });
  if (!buttons) return;
  const name = firstName(lead.name) || 'הליד';
  const ui = await require('./conversationUi').prepareChoices(clientId, `חזרת ל${name}? סמנו כאן ואמדוד לך את זמן התגובה ⏱`,
    [{ title: '📞 התקשרתי', text: '/lead-contacted ' + lead.id }, { title: '💬 שלחתי הודעה', text: '/lead-contacted ' + lead.id }], 'lead_contact');
  await require('./whatsappDelivery').enqueue(phone, ui.interactivePayload);
}

module.exports = { enabled, notifyOwner, suggestedReply, alertText, waNumber, businessNameFor };
