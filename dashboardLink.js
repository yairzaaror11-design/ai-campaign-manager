'use strict';
// One-tap sign-in to the dashboard from WhatsApp, optionally straight to a screen.
// The link is personal, single-use and valid for 10 minutes; the address is never
// written to AI history.
const SCREENS = { 'לידים': 'leads', 'פניות': 'leads', 'ביצועים': 'performance', 'דוח': 'performance', 'תוצאות': 'performance', 'קמפיין': 'campaign', 'מותג': 'brand', 'תוכן': 'content', 'מכירות': 'sales', 'אישורים': 'approvals', 'נכסים': 'catalog', 'מוצרים': 'catalog', 'שירותים': 'catalog', 'קטלוג': 'catalog' };
const PATTERN = /^(?:פתח(?:י)?\s+(?:לי\s+)?(?:את\s+)?)?(?:ה)?(?:דשבורד|תצוגה מקדימה|החשבון שלי|ניהול לידים)(?:\s+(?:של\s+)?(?:ה)?(לידים|פניות|ביצועים|דוח|תוצאות|קמפיין|מותג|תוכן|מכירות|אישורים|נכסים|מוצרים|שירותים|קטלוג))?$/;
const ALLOWED = new Set(Object.values(SCREENS));

// Flexible ways owners ask for the link: "שלח לי קישור לדשבורד", "תן לינק למערכת",
// "איך נכנסים לדשבורד?", "אני רוצה להיכנס לחשבון שלי".
const FLEX = [
  /^(?:(?:אפשר|תוכל|תוכלי)\s+)?(?:(?:ל)?(?:שלוח|תשלח|שלח|תשלחי|שלחי|תן|תני|לתת|תביא|תביאי|להביא|צריך|אני צריך|אני צריכה|רוצה|אני רוצה)\s+)?(?:לי\s+)?(?:את\s+)?(?:ה)?(?:קישור|לינק|כניסה|גישה)\s+(?:ל|אל\s+|של\s+)?(?:ה)?(?:דשבורד|מערכת|פורטל|חשבון(?:\s+שלי)?|אזור האישי|ממשק)(?:\s+שלי)?[?.!\s]*$/u,
  /^(?:איך\s+(?:אני\s+)?(?:נכנס|נכנסים|להיכנס|אכנס)|אני\s+רוצה\s+להיכנס|רוצה\s+להיכנס)\s+(?:ל|אל\s+)(?:ה)?(?:דשבורד|מערכת|פורטל|חשבון(?:\s+שלי)?|אזור האישי)[?.!\s]*$/u,
  /^(?:דשבורד|הדשבורד|לינק לדשבורד|קישור לדשבורד)\s*(?:בבקשה|פליז|please)[?.!\s]*$/iu
];
function request(text) {
  const n = String(text || '').trim();
  if (FLEX.some((re) => re.test(n))) return { screen: null };
  const m = n.match(PATTERN);
  if (!m) return null;
  return { screen: m[1] ? SCREENS[m[1]] : /ניהול לידים/.test(text) ? 'leads' : null };
}

async function handle(clientId, text) {
  const r = request(text);
  if (!r) return null;
  let address;
  try { address = await require('./portalStore').createTicket(clientId, r.screen); }
  catch { return { handled: true, reply: 'הדשבורד עדיין לא זמין כרגע. אפשר להמשיך כאן בשיחה, הכל נשמר.' }; }
  return { handled: true, reply: '🔐 הקישור האישי שלך לדשבורד (תקף ל־10 דקות, לשימוש אחד):\n' + address + '\n\nכל מה שכאן בשיחה מופיע גם שם, ולהפך.', historyReply: 'נשלח קישור אישי לדשבורד. כתובת הקישור לא נשמרה בהיסטוריית AI.' };
}

// A short hint that bot messages append, so the owner always knows how to see more.
const hint = (screen) => `לפירוט מלא בדשבורד כתבו: דשבורד ${Object.keys(SCREENS).find((k) => SCREENS[k] === screen) || ''}`.trim();

module.exports = { request, handle, hint, ALLOWED, PATTERN };
