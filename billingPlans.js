'use strict';
// SCORPIO AI plans and prices — the one place to change them.
// Monthly only, a flat fee. Never a percentage of ad spend: the business pays
// its ad budget directly to Meta, and that money never passes through us.
// A feature is shown as active only while it really works. Anything behind a switch that is off,
// or with no process behind it yet, is shown with "(בקרוב)". Never promise what does not run today.
const SOON = ' (בקרוב)';
const LIVE = {
  // Short AI videos: off until VIDEO_ENABLED and a Higgsfield key are set.
  video: () => require('./videoService').enabled(),
  // A person reviewing campaigns and content: there is no such process in the product yet.
  humanReview: () => false,
  // Lead stages sent back to Meta (Conversion Leads): off unless META_CRM_FEEDBACK_ENABLED.
  crmFeedback: () => process.env.META_CRM_FEEDBACK_ENABLED === 'true',
  // The automatic weekly report: off unless WEEKLY_REPORTS_ENABLED. On-demand reports always work.
  weeklyReport: () => process.env.WEEKLY_REPORTS_ENABLED === 'true',
};
const FEATURES = Object.freeze({
  basic: ['קמפיינים ב־Meta', 'ניהול לידים', 'התראות על לידים חדשים', 'דוחות ביצועים לפי בקשה', { text: 'דוח שבועי אוטומטי', live: LIVE.weeklyReport }],
  growth: ['כל מה שבבסיס', 'תוכן אורגני שוטף', { text: 'סרטוני AI', live: LIVE.video }, 'המלצה יומית', { text: 'החזרת מכירות ל־Meta לשיפור הקמפיינים', live: LIVE.crmFeedback }],
  premium: ['כל מה שבצמיחה', { text: 'בדיקה אנושית של הקמפיינים והתוכן', live: LIVE.humanReview }, 'יום צילום בעסק פעם ברבעון'],
});
function isLive(f) { try { return f.live(); } catch { return false; } }
function features(key) {
  return Object.freeze((FEATURES[key] || []).map((f) => (typeof f === 'string' ? f : isLive(f) ? f.text : f.text + SOON)));
}
const define = (key, name, priceIls) => Object.freeze({ key, name, priceIls, get features() { return features(key); } });
const PLANS = Object.freeze({
  basic: define('basic', 'בסיס', 199),
  growth: define('growth', 'צמיחה', 449),
  premium: define('premium', 'ליווי', 1290),
});

const TRIAL_DAYS = 14;
const TRIAL_REMINDER_DAYS = 3;
const CURRENCY = 'ILS';
const AD_BUDGET_NOTE = 'תקציב הפרסום משולם על ידך ישירות ל־Meta. אנחנו לא נוגעים בו ולא לוקחים ממנו אחוזים.';
const NOT_ENABLED_NOTE = 'התשלום עוד לא הופעל — לא יתבצע שום חיוב.';
const CANCEL_HOW = 'לביטול: כותבים בוואטסאפ "בטל מנוי" או לוחצים "ביטול מנוי" בדשבורד. בלי טלפונים ובלי מיילים.';
const REFUND_POLICY = 'החזר מלא בחודש התשלום הראשון, בלי שאלות.';

function plan(key) {
  return Object.prototype.hasOwnProperty.call(PLANS, key) ? PLANS[key] : null;
}
function list() { return Object.values(PLANS); }
function priceMinor(key) { const p = plan(key); return p ? p.priceIls * 100 : null; }
function priceText(key) { const p = plan(key); return p ? `₪${p.priceIls.toLocaleString('en-US')} לחודש` : ''; }
// "צמיחה (₪449 לחודש)"
function label(key) { const p = plan(key); return p ? `${p.name} (${priceText(key)})` : ''; }

module.exports = { PLANS, SOON, features, TRIAL_DAYS, TRIAL_REMINDER_DAYS, CURRENCY, AD_BUDGET_NOTE, NOT_ENABLED_NOTE, CANCEL_HOW, REFUND_POLICY, plan, list, priceMinor, priceText, label };
