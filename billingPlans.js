'use strict';
// SCORPIO AI plans and prices — the one place to change them.
// Monthly only, a flat fee. Never a percentage of ad spend: the business pays
// its ad budget directly to Meta, and that money never passes through us.
const PLANS = Object.freeze({
  basic: Object.freeze({
    key: 'basic',
    name: 'בסיס',
    priceIls: 199,
    features: Object.freeze(['קמפיינים ב־Meta', 'ניהול לידים', 'התראות על לידים חדשים', 'דוחות ביצועים']),
  }),
  growth: Object.freeze({
    key: 'growth',
    name: 'צמיחה',
    priceIls: 449,
    features: Object.freeze(['כל מה שבבסיס', 'תוכן אורגני שוטף', 'סרטוני AI', 'המלצה יומית', 'החזרת מכירות ל־Meta לשיפור הקמפיינים']),
  }),
  premium: Object.freeze({
    key: 'premium',
    name: 'ליווי',
    priceIls: 1290,
    features: Object.freeze(['כל מה שבצמיחה', 'בדיקה אנושית של הקמפיינים והתוכן', 'יום צילום בעסק פעם ברבעון']),
  }),
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

module.exports = { PLANS, TRIAL_DAYS, TRIAL_REMINDER_DAYS, CURRENCY, AD_BUDGET_NOTE, NOT_ENABLED_NOTE, CANCEL_HOW, REFUND_POLICY, plan, list, priceMinor, priceText, label };
