'use strict';
// Qualification question sets and meeting words per business type, for the lead
// concierge. Kept small and data-only so it can be folded into verticalProfiles.js.
// Each question: key, body (to the lead, plural-neutral), options [title, value, points],
// free (typed answers accepted), ask(answers) to skip it. At most 4 are asked.
const TIMING = (body) => ({
  key: 'timing', body,
  options: [['כמה שיותר מהר', 'NOW', 3], ['בחודש הקרוב', '1-3', 2], ['בעוד כמה חודשים', '3-6', 1], ['רק בודקים כרגע', 'BROWSING', -2]]
});
const BUDGET_FREE = { key: 'budget', body: 'מה התקציב המשוער? אפשר לכתוב סכום או טווח.', options: [['עוד לא יודעים', 'UNKNOWN', 0]], free: true };

const PROFILES = {
  real_estate: {
    label: 'נדל״ן ותיווך', businessWord: 'המשרד', subject: 'חיפוש נכס',
    meeting: { noun: 'צפייה', to: 'לצפייה', booked: 'צפייה נקבעה', plural: 'צפיות' },
    questions: [
      { key: 'intent', body: 'קודם כול, אתם מחפשים לקנות או לשכור?', options: [['קנייה', 'BUY', 0], ['שכירות', 'RENT', 1], ['מוכרים נכס', 'SELL', 2]] },
      { key: 'budget', body: (a) => a.intent?.value === 'RENT' ? 'מה התקציב החודשי לשכירות?' : 'מה טווח התקציב לרכישה?', free: true,
        options: (a) => a.intent?.value === 'RENT'
          ? [['עד 4,000 ₪', 'עד 4,000 ₪'], ['4,000–6,000 ₪', '4,000–6,000 ₪'], ['6,000–8,000 ₪', '6,000–8,000 ₪'], ['8,000–12,000 ₪', '8,000–12,000 ₪'], ['מעל 12,000 ₪', 'מעל 12,000 ₪']]
          : [['עד 1.5 מיליון', 'עד 1.5 מיליון'], ['1.5–2.5 מיליון', '1.5–2.5 מיליון'], ['2.5–3.5 מיליון', '2.5–3.5 מיליון'], ['3.5–5 מיליון', '3.5–5 מיליון'], ['מעל 5 מיליון', 'מעל 5 מיליון']] },
      { key: 'area', body: 'באיזה אזור או עיר אתם מחפשים? אפשר לכתוב בחופשיות.', options: [['גמיש', 'גמיש']], free: true },
      { key: 'timing', body: 'מתי תרצו להיכנס לנכס?', options: [['מיידי (עד חודש)', 'NOW', 3], ['1–3 חודשים', '1-3', 2], ['3–6 חודשים', '3-6', 1], ['רק בודקים כרגע', 'BROWSING', -2]] },
      { key: 'mortgage', body: 'יש לכם אישור עקרוני למשכנתא?', ask: (a) => a.intent?.value === 'BUY',
        options: [['יש אישור עקרוני', 'APPROVED', 2], ['בתהליך', 'IN_PROGRESS', 1], ['עוד לא', 'NO', 0], ['לא צריך משכנתא', 'NOT_NEEDED', 2]] }
    ],
    stop: (a) => a.intent?.value === 'SELL'
  },
  services: {
    label: 'נותני שירות', businessWord: 'העסק', subject: 'הפנייה שלכם',
    meeting: { noun: 'פגישה', to: 'לפגישה', booked: 'פגישה נקבעה', plural: 'פגישות' },
    questions: [
      { key: 'need', body: 'במה אפשר לעזור? אפשר לכתוב במילים שלכם.', options: [['עוד לא בטוחים', 'UNSURE']], free: true },
      { key: 'area', body: 'איפה זה? עיר או אזור.', options: [['לא משנה', 'גמיש']], free: true },
      TIMING('מתי תרצו שזה יקרה?'),
      BUDGET_FREE
    ]
  },
  retail: {
    label: 'חנויות ומוצרים', businessWord: 'החנות', subject: 'המוצר שהתעניינתם בו',
    meeting: null,
    questions: [
      { key: 'product', body: 'איזה מוצר מעניין אתכם? אפשר לכתוב בחופשיות.', options: [['עוד לא בטוחים', 'UNSURE']], free: true },
      { key: 'quantity', body: 'כמה יחידות בערך?', options: [['אחת', '1', 0], ['2–5', '2-5', 1], ['יותר מ־5', '6+', 2]], free: true },
      { key: 'delivery', body: 'איך נוח לכם לקבל?', options: [['משלוח', 'DELIVERY', 1], ['איסוף עצמי', 'PICKUP', 1], ['עוד לא יודעים', 'UNKNOWN', 0]] }
    ]
  },
  fitness: {
    label: 'כושר ואימונים', businessWord: 'הסטודיו', subject: 'האימונים',
    meeting: { noun: 'אימון ניסיון', to: 'לאימון ניסיון', booked: 'אימון ניסיון נקבע', plural: 'אימוני ניסיון' },
    questions: [
      { key: 'goal', body: 'מה המטרה העיקרית?', options: [['ירידה במשקל', 'WEIGHT', 0], ['כוח וחיטוב', 'STRENGTH', 0], ['כושר ובריאות', 'HEALTH', 0], ['משהו אחר', 'OTHER', 0]], free: true },
      TIMING('מתי תרצו להתחיל?'),
      { key: 'slot_pref', body: 'איזו שעה ביום הכי נוחה לכם?', options: [['בוקר', 'MORNING', 0], ['צהריים', 'NOON', 0], ['ערב', 'EVENING', 0]] }
    ]
  },
  default: {
    label: 'כללי', businessWord: 'העסק', subject: 'הפנייה שלכם',
    meeting: { noun: 'פגישה', to: 'לפגישה', booked: 'פגישה נקבעה', plural: 'פגישות' },
    questions: [
      { key: 'need', body: 'במה אפשר לעזור? אפשר לכתוב במילים שלכם.', options: [['עוד לא בטוחים', 'UNSURE']], free: true },
      TIMING('מתי זה רלוונטי עבורכם?'),
      BUDGET_FREE
    ]
  }
};
const KEYS = Object.keys(PROFILES);

// Business type from the owner's own words (businessType / product).
function detect(facts = {}) {
  const t = [facts.businessType, facts.product, facts.businessName].filter((v) => typeof v === 'string').join(' ');
  if (/(נדל|תיווך|מתווך|מתווכת|נכסים|דירות|דירה)/.test(t)) return 'real_estate';
  if (/(כושר|אימון|אימונים|מאמן|מאמנת|סטודיו|יוגה|פילאטיס|קרוספיט|ריצה)/.test(t)) return 'fitness';
  if (/(חנות|חנויות|אונליין|משלוח|קמעונ|בגדים|תכשיט|מוצרי|רהיטים|מתנות)/.test(t)) return 'retail';
  if (/(שירות|קליניק|מרפאה|רופא|עורך דין|עו״ד|רואה חשבון|שיפוץ|שיפוצים|אינסטלט|חשמלאי|טיפול|ייעוץ|יועץ|מספרה|קוסמטי|צלם|מורה|שיעורים|הובלות|ניקיון|הנדימן)/.test(t)) return 'services';
  return 'default';
}
const get = (key) => PROFILES[KEYS.includes(key) ? key : 'default'];

module.exports = { PROFILES, KEYS, detect, get };
