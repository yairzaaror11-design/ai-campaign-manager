'use strict';
// Spend safety: the owner's own daily ad-spend ceiling. Set on WhatsApp ("תקרה יומית 150"),
// enforced before any approval is even offered, and watched by the campaign guard.
const db = require('./db');

const SYMBOL = { ILS: '₪', USD: '$', EUR: '€' };
const money = (v, cur = 'ILS') => (Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + (SYMBOL[cur] || cur);
const exponent = (cur) => (['JPY', 'KRW'].includes(cur) ? 0 : 2);

async function get(clientId) {
  const row = (await db.query('SELECT daily_cap FROM client_spend_caps WHERE client_id=$1', [clientId])).rows[0];
  return row ? Number(row.daily_cap) : null;
}
async function set(clientId, amount) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e7) throw Error('INVALID_SPEND_CAP');
  await db.query(`INSERT INTO client_spend_caps(client_id,daily_cap) VALUES($1,$2)
    ON CONFLICT(client_id) DO UPDATE SET daily_cap=EXCLUDED.daily_cap, updated_at=NOW()`, [clientId, amount]);
}
async function clear(clientId) {
  return (await db.query('DELETE FROM client_spend_caps WHERE client_id=$1 RETURNING client_id', [clientId])).rows.length > 0;
}

// "תקרה יומית 150", "תקרת הוצאה 150 ש"ח ליום", "בטל את התקרה", "מה התקרה היומית?"
const CLEAR = /^(?:בטל|תבטל|הסר|תסיר|מחק|תמחק|להסיר|לבטל|בלי)\s+(?:את\s+)?(?:ה)?תקר(?:ה|ת)/u;
const START = /^(?:(?:מה|תראה|הצג|תגיד|קבע|תקבע|שים|תשים|הגדר|תגדיר|עדכן|תעדכן)\s+(?:לי\s+)?(?:את\s+)?(?:זה\s+)?)?(?:ה)?תקר(?:ה|ת)(?:\s|\?|$)/u;
const ABOUT_SPEND = /יומית|הוצאה|תקציב|ליום|ביום|^(?:מה\s+)?התקרה\??$/u;
function parse(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (t.length > 80) return null;
  if (CLEAR.test(t) && ABOUT_SPEND.test(t.replace(CLEAR, '')) || /^(?:בטל|תבטל|הסר|תסיר|מחק|תמחק|לבטל|להסיר|בלי) (?:את )?(?:ה)?תקרה(?: היומית)?$/u.test(t)) return { op: 'clear' };
  if (!START.test(t) || !ABOUT_SPEND.test(t)) return null;
  const n = t.replace(/(\d),(?=\d{3}(?!\d))/g, '$1').match(/\d{1,7}(?:\.\d{1,2})?/);
  return n ? { op: 'set', amount: Number(n[0]) } : { op: 'show' };
}

async function handle(clientId, message) {
  const cmd = parse(message);
  if (!cmd || !db.configured()) return null;
  if (cmd.op === 'set') {
    if (!(cmd.amount > 0)) return { handled: true, reply: 'כדי לקבוע תקרה צריך מספר גדול מאפס, למשל: תקרה יומית 150' };
    await set(clientId, cmd.amount);
    return { handled: true, reply: `סגרנו ✅ תקרת ההוצאה היומית שלך: ${money(cmd.amount)}.\nלא אכין לאישור שום קמפיין או שינוי תקציב שעובר אותה, ואם ביום מסוים ההוצאה בפועל תעבור אותה, אעדכן אותך מיד.\nלשינוי כתוב "תקרה יומית" ומספר חדש, ולביטול "בטל תקרה".` };
  }
  if (cmd.op === 'clear') {
    const had = await clear(clientId);
    return { handled: true, reply: had ? 'ביטלתי את תקרת ההוצאה היומית. כל שינוי בתקציב עדיין מחכה לאישור שלך, כמו תמיד.' : 'אין כרגע תקרת הוצאה יומית. אפשר לקבוע אחת, למשל: תקרה יומית 150' };
  }
  const cap = await get(clientId);
  return { handled: true, reply: cap ? `תקרת ההוצאה היומית שלך היא ${money(cap)}.\nלשינוי כתוב "תקרה יומית" ומספר חדש, ולביטול "בטל תקרה".` : 'עוד לא קבעת תקרת הוצאה יומית.\nאם תרצה, כתוב למשל "תקרה יומית 150", ואני לא אציע שום דבר שעובר את הסכום הזה ביום.' };
}

// Daily budget (minor units) that an approved plan would commit, or 0 if it adds none.
function planDailyMinor(plan) {
  const p = plan?.parameters || {}, n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  if (['CREATE_BUNDLE', 'CREATE_ADSET', 'CHANGE_BUDGET', 'DUPLICATE_CAMPAIGN'].includes(plan?.intent)) return n(p.dailyBudgetMinor);
  // Ad set budgets, plus the campaign budget when the campaign holds it (a copy of such a campaign).
  if (plan?.intent === 'ACTIVATE_BUNDLE') return (plan.review?.adSets || []).reduce((t, s) => t + n(s.daily_budget), 0) + n(plan.review?.currentDailyBudgetMinor);
  if (plan?.intent === 'RESUME_CAMPAIGN') return n(plan.review?.currentDailyBudgetMinor);
  return 0;
}

// Throws SPEND_CAP_EXCEEDED (with a ready Hebrew reply) before an approval is created.
async function assertWithinCap(clientId, plan) {
  if (!db.configured()) return;
  const cap = await get(clientId);
  const dailyMinor = planDailyMinor(plan);
  if (!cap || !dailyMinor) return;
  const cur = plan.parameters?.currency || plan.review?.currency || 'ILS', unit = 10 ** exponent(cur);
  if (dailyMinor <= Math.round(cap * unit)) return;
  const daily = dailyMinor / unit;
  const reply = `✋ עצרתי לפני האישור: התקציב היומי כאן הוא ${money(daily, cur)}, וזה מעל תקרת ההוצאה היומית שקבעת (${money(cap, cur)}).\nלא נשלח שום דבר ל־Meta.\nאם זה בסדר מבחינתך, כתוב "תקרה יומית ${Math.ceil(daily)}" ואז בקש שוב. אפשר גם לבקש תקציב נמוך יותר.`;
  throw Object.assign(Error('SPEND_CAP_EXCEEDED'), { reply, cap, daily });
}

module.exports = { get, set, clear, parse, handle, planDailyMinor, assertWithinCap, money };
