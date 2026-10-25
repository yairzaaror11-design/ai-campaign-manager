'use strict';
const crypto = require('node:crypto');

const WORKFLOWS = Object.freeze({
  WEBSITE_LEADS: { objective: 'OUTCOME_LEADS', requires: ['websiteUrl', 'conversionEvent', 'pixelId'] },
  WEBSITE_SALES: { objective: 'OUTCOME_SALES', requires: ['websiteUrl', 'conversionEvent', 'pixelId'] },
  INSTANT_FORMS: { objective: 'OUTCOME_LEADS', requires: ['pageId', 'formId'] },
  WHATSAPP_MESSAGES: { objective: 'OUTCOME_ENGAGEMENT', requires: ['pageId', 'whatsappNumberId'] },
  TRAFFIC: { objective: 'OUTCOME_TRAFFIC', requires: ['websiteUrl'] },
  AWARENESS: { objective: 'OUTCOME_AWARENESS', requires: [] },
  VIDEO_VIEWS: { objective: 'OUTCOME_ENGAGEMENT', requires: ['videoId'] },
  ENGAGEMENT: { objective: 'OUTCOME_ENGAGEMENT', requires: ['pageId'] },
  REMARKETING: { objective: 'OUTCOME_SALES', requires: ['customAudienceId', 'conversionEvent'] }
});

const QUESTIONS = Object.freeze({
  businessName: 'מה שם העסק?',
  product: 'איזה מוצר או שירות נפרסם?',
  audience: 'מי קהל היעד?',
  geography: 'באילו אזורים נפרסם?',
  dailyBudget: 'מה התקציב היומי?',
  websiteUrl: 'מה כתובת אתר הנחיתה?',
  conversionEvent: 'מה אירוע ההמרה?',
  pixelId: 'מה מזהה ה-Pixel או Dataset?',
  pageId: 'מה מזהה דף הפייסבוק?',
  formId: 'מה מזהה טופס הלידים?',
  whatsappNumberId: 'מה מזהה מספר ה-WhatsApp?',
  videoId: 'מה מזהה הסרטון?',
  customAudienceId: 'מה מזהה קהל הרימרקטינג?'
});

function newBrief({ tenantId, adAccountId, type, dailyBudget }) {
  if (!tenantId || !/^act_\\d+$/.test(String(adAccountId))) throw Error('Invalid tenant or ad account');
  if (!WORKFLOWS[type]) throw Error('Unsupported campaign workflow');
  const brief = { id: crypto.randomUUID(), tenantId, adAccountId, type, status: 'COLLECTING', revision: 1, fields: {} };
  if (dailyBudget !== undefined) return updateBrief(brief, { dailyBudget });
  return brief;
}

function updateBrief(brief, changes) {
  if (!['COLLECTING', 'REVIEW'].includes(brief.status)) throw Error('Brief is immutable');
  const allowed = new Set([...Object.keys(QUESTIONS)]);
  for (const [key, value] of Object.entries(changes)) {
    if (!allowed.has(key)) throw Error('Unknown brief field');
    if (key === 'dailyBudget' && (!Number.isFinite(Number(value)) || Number(value) <= 0)) throw Error('Invalid budget');
    if (typeof value !== 'string' && typeof value !== 'number') throw Error('Invalid brief value');
  }
  return { ...brief, fields: { ...brief.fields, ...changes }, revision: brief.revision + 1, status: 'COLLECTING' };
}

function missingFields(brief) {
  const required = ['businessName', 'product', 'audience', 'geography', 'dailyBudget', ...WORKFLOWS[brief.type].requires];
  return [...new Set(required)].filter(key => !String(brief.fields[key] ?? '').trim());
}

function nextQuestion(brief) {
  const missing = missingFields(brief);
  return missing.length ? { field: missing[0], question: QUESTIONS[missing[0]] } : null;
}

function reviewBrief(brief) {
  if (missingFields(brief).length) throw Error('Brief incomplete');
  return { ...brief, status: 'REVIEW' };
}

function approveBrief(brief, expectedRevision) {
  if (brief.status !== 'REVIEW' || brief.revision !== expectedRevision) throw Error('Stale or unreviewed brief');
  return { ...brief, status: 'APPROVED', approvedAt: new Date().toISOString() };
}

function cancelBrief(brief) { return { ...brief, status: 'CANCELLED' }; }

function draftStrategy(brief) {
  if (brief.status !== 'APPROVED') throw Error('Brief approval required');
  return { briefId: brief.id, tenantId: brief.tenantId, objective: WORKFLOWS[brief.type].objective,
    audience: brief.fields.audience, geography: brief.fields.geography,
    dailyBudget: Number(brief.fields.dailyBudget),
    adSets: [{ name: 'Initial audience test', budgetShare: 1 }],
    competitorResearch: { status: 'NOT_RESEARCHED', sources: [], claims: [] },
    status: 'PROPOSED', disclaimer: 'Requires Meta capability and permissions validation before execution' };
}

module.exports = { WORKFLOWS, newBrief, updateBrief, missingFields, nextQuestion, reviewBrief, approveBrief, cancelBrief, draftStrategy };
