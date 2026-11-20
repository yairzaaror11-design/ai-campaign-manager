'use strict';
// WhatsApp commands for channels: the owner forwards a lead ("ליד חדש: …"), asks for the
// business page ("הדף שלי") or publishes the waiting pages ("פרסם דף").
const db = require('./db');

const MAYBE = /^(?:ליד|לקוח|לקוחה|פנייה|פניה|הדף|דף|עמוד|הדפים|פרסם|תפרסם|לפרסם)/;
async function handleText(from, text) {
  const t = String(text || '').trim();
  if (!t || t.length > 1600 || t.startsWith('/') || !MAYBE.test(t) || !db.configured()) return null;
  const clientId = (await db.query('SELECT id FROM clients WHERE phone=$1', [String(from)])).rows[0]?.id;
  if (!clientId) return null;
  const eventId = require('./whatsappDelivery').messageContext.getStore()?.eventId || null;
  const lead = await require('./leadIntake').handleForward(clientId, t, { eventId });
  if (lead) return lead;
  return require('./landingPages').handleText(clientId, t.replace(/\s+/g, ' '));
}
module.exports = { handleText };
