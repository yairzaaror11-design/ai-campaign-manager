'use strict';
// A good agency plans around the calendar. About three weeks before an Israeli
// holiday or a big shopping day, SCORPIO offers to prepare a matching campaign.
const db = require('./db');
const { logger } = require('./logger');

const enabled = () => process.env.SEASONAL_PROMPTS_ENABLED !== 'false';
const LEAD_DAYS = { min: 18, max: 24 };
// Hebrew-calendar occasions (month names as Node's ICU hebrew calendar prints them).
const HEBREW = [
  { key: 'rosh_hashana', name: 'ראש השנה', emoji: '🍎', month: ['Tishri'], day: 1 },
  { key: 'sukkot', name: 'סוכות', emoji: '🌿', month: ['Tishri'], day: 15 },
  { key: 'hanukkah', name: 'חנוכה', emoji: '🕎', month: ['Kislev'], day: 25 },
  { key: 'family_day', name: 'יום המשפחה', emoji: '👨‍👩‍👧', month: ['Shevat'], day: 30 },
  { key: 'purim', name: 'פורים', emoji: '🎭', month: ['Adar', 'Adar II'], day: 14 },
  { key: 'passover', name: 'פסח', emoji: '🍷', month: ['Nisan'], day: 15 },
  { key: 'shavuot', name: 'שבועות', emoji: '🧀', month: ['Sivan'], day: 6 },
  { key: 'tu_bav', name: 'ט״ו באב', emoji: '❤️', month: ['Av'], day: 15 }
];
const hebrewFormat = new Intl.DateTimeFormat('en-u-ca-hebrew', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long' });
function hebrewParts(date) {
  const parts = Object.fromEntries(hebrewFormat.formatToParts(date).map((p) => [p.type, p.value]));
  return { day: Number(parts.day), month: parts.month };
}
function blackFriday(year) { // the day after the 4th Thursday of November
  const first = new Date(Date.UTC(year, 10, 1, 12));
  const thursday = 1 + ((4 - first.getUTCDay() + 7) % 7) + 21;
  return new Date(Date.UTC(year, 10, thursday + 1, 12));
}
// Occasions whose date falls 18–24 days after `now`.
function upcoming(now = new Date()) {
  const found = [];
  for (let d = LEAD_DAYS.min; d <= LEAD_DAYS.max; d++) {
    const date = new Date(now.getTime() + d * 864e5);
    const h = hebrewParts(date);
    for (const o of HEBREW) if (o.day === h.day && o.month.includes(h.month)) found.push({ ...o, date, days: d });
    const bf = blackFriday(date.getUTCFullYear());
    if (bf.toISOString().slice(0, 10) === date.toISOString().slice(0, 10)) found.push({ key: 'black_friday', name: 'בלאק פריידיי', emoji: '🛍', date, days: d });
  }
  return found;
}
function message(o) {
  const weeks = Math.round(o.days / 7);
  return `${o.emoji} בעוד כ־${weeks} שבועות ${o.name}.\nעסקים שמתכננים מראש מקבלים פניות זולות יותר, לפני שכולם נכנסים לפרסם.\nאם יש לך הצעה או שירות שמתאים לתקופה הזו, אכין לך קמפיין מוכן לאישור.`;
}

async function dueClients(limit = 200) {
  return (await db.query(`SELECT c.id, c.phone FROM clients c
    JOIN whatsapp_contacts w ON w.phone=c.phone AND w.last_inbound_at>NOW()-INTERVAL '24 hours'
    WHERE c.meta_ad_account_id IS NOT NULL LIMIT $1`, [limit])).rows;
}

async function runDue({ now = new Date() } = {}) {
  if (!enabled() || !db.configured() || !require('./leadCheckins').businessHours(now)) return { status: 'NOT_DUE' };
  const occasions = upcoming(now);
  if (!occasions.length) return { status: 'NONE' };
  const o = occasions[0], year = o.date.getUTCFullYear(), results = [];
  for (const client of await dueClients()) {
    try {
      if (await require('./leadCheckins').ownerBusy(client.id)) { results.push('BUSY'); continue; }
      const claim = await db.query('INSERT INTO seasonal_prompts(client_id,occasion,year) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING client_id', [client.id, o.key, year]);
      if (!claim.rows.length) { results.push('ALREADY'); continue; }
      await require('./metaConnection').context.run(String(client.id), () => require('./whatsappDelivery').messageContext.run({ eventId: `season:${client.id}:${o.key}:${year}`, sequence: 0 }, async () => {
        const ui = await require('./conversationUi').prepareChoices(client.id, message(o), [{ title: 'תכין קמפיין לחג', text: `תכין לי קמפיין ל${o.name}` }, { title: 'לא הפעם', text: 'לא הפעם' }], 'guard_alert');
        await require('./whatsapp').safeSend(client.phone, ui.text, ui);
      }));
      results.push('SENT');
    } catch (error) {
      logger.warn('Seasonal prompt skipped', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'SEASONAL_FAILED' });
      results.push('FAILED');
    }
  }
  return { status: 'RAN', occasion: o.key, results };
}

module.exports = { enabled, upcoming, blackFriday, message, runDue };
