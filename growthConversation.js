'use strict';
// WhatsApp words for growth (growth.js): funnels ("משפכים"), the after-sale loop ("ביקורות והמלצות"),
// the review link and commission defaults (set once), the team report, and the owner's one-tap
// answers to after-sale offers. Returns {text, interactivePayload?}, {task, clientId}, or null.
const db = require('./db');
const growth = require('./growth');

const FUNNELS = /^(?:משפכים|המשפכים|(?:(?:תראה|תציג|הצג)(?: לי)? את |אני רוצה לראות את |מה )?(?:ה)?סוגי (?:ה)?קמפיינים(?: שיש)?\??|איזה קמפיין (?:כדאי|לעשות|להריץ)\??|איזה קמפיין כדאי לי\??|קמפיין למוכרים|קמפיין למשכירים|קמפיין לקונים|קמפיין לשוכרים|כמה שווה הדירה שלך\??)$/;
const DIRECT = { 'קמפיין למוכרים': 'sellers', 'כמה שווה הדירה שלך': 'sellers', 'כמה שווה הדירה שלך?': 'sellers', 'קמפיין למשכירים': 'landlords', 'קמפיין לקונים': 'buyers', 'קמפיין לשוכרים': 'renters' };
const LOOP = /^(?:ביקורות והמלצות|לקוחות קודמים|לקוחות עבר|תודה ללקוחות|הודעות ללקוחות)$/;
// "קישור לביקורות https://..." and natural forms ("הקישור לביקורות שלי בגוגל הוא ..."), or a bare Google review link.
const REVIEW = /^(?:(?:ה)?(?:קישור|לינק) (?:ל|של )?(?:ה)?(?:ביקורות|ביקורת|גוגל)(?: שלי)?(?: בגוגל)?(?: הוא| זה)?|הקישור לביקורות)(?:\s*[:：-]?\s*(\S+))?$|^(https:\/\/(?:g\.page|maps\.app\.goo\.gl|g\.co|search\.google\.com\/local\/writereview)\S*)$/;
const COMMISSION = /^(?:עמלה|עמלת תיווך|העמלה שלי)(\s+בשכירות)?\s*[:：-]?\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*%?$/;
const LICENSE = /^(?:(?:ה)?מספר\s+)?(?:ה)?רישיון (?:ה)?תיווך(?:\s+שלי)?(?:\s+(?:הוא|זה))?\s*[:：-]?\s*(\d{3,10})$/;
const TEAM = /^(?:דוח צוות|הצוות שלי|דוח הצוות)$/;
const CMD = /^\/growth-(done|skip|consent|cadence|funnel)\s+(\S+)$/;
const DONE = /^(?:שלחתי ללקוח|שלחתי את ההודעה|שלחתי לו|שלחתי לה|שלחתי ללקוחה)[.!\s]*$/;
const SKIP = /^(?:דלג על ההודעה|לא לשלוח ללקוח|(?:תדלג|דלג|לדלג) על (?:ה)?הודעה(?: הזו| הזאת)?|אל תשלח לו|אל תשלח לה)[.!\s]*$/;

const clientByPhone = async (phone) => (await db.query('SELECT id FROM clients WHERE phone=$1', [String(phone).replace(/\D/g, '')])).rows[0]?.id || null;
const shortTitle = (label, max) => label.split(' — ')[0].slice(0, max);
async function choices(clientId, body, items, key = 'growth') {
  const max = items.length <= 3 ? 20 : 24;
  return require('./conversationUi').prepareChoices(clientId, body.slice(0, 1024), items.map((c) => ({ ...c, title: c.title.slice(0, max) })), key);
}

async function handleText(from, text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t || t.length > 600 || !db.configured()) return null;
  if (!(FUNNELS.test(t) || LOOP.test(t) || REVIEW.test(t) || COMMISSION.test(t) || LICENSE.test(t) || TEAM.test(t) || CMD.test(t) || DONE.test(t) || SKIP.test(t))) return null;
  const clientId = await clientByPhone(from);
  if (!clientId) return null;
  const store = require('./marketingStore');
  let m;

  if ((m = t.match(CMD))) {
    const [, cmd, arg] = m;
    if (cmd === 'funnel') return funnelCampaign(clientId, arg);
    if (cmd === 'cadence') {
      await growth.approveCadence(clientId, arg === 'yes');
      return { text: arg === 'yes' ? 'סגרנו ✅ מעכשיו אחרי כל עסקה הסוכן מטפל בתודה, בבקשת הביקורת, בבקשת ההמלצה ובתזכורת ללקוח, בדיוק בקצב הזה.\nהסוכן שולח בעצמו רק ללקוח שהסכים לקבל הודעות; לשאר תקבל ממני הודעה מוכנה לשליחה בלחיצה.\nלעצירה: "עצור את כל הפעולות האוטומטיות".' : 'בסדר. לא אשלח ללקוחות בעצמי. אחרי כל עסקה אשלח לך הודעה מוכנה, ואתה מחליט אם לשלוח.' };
    }
    if (cmd === 'consent') {
      try { await growth.setConsent(clientId, arg, true); } catch { return { text: 'לא מצאתי את הלקוח הזה. אפשר לסמן הסכמה בכרטיס הליד בדשבורד.' }; }
      return { text: 'סימנתי שהלקוח הסכים לקבל ממך הודעות ✅ מההודעה הבאה הסוכן ישלח לו בעצמו, לפי הקצב שאישרת.' };
    }
    const row = await growth.markOutreach(clientId, arg, cmd === 'done' ? 'LINK_GIVEN' : 'SKIPPED').catch(() => null);
    return { text: row ? (cmd === 'done' ? 'מעולה, סימנתי שנשלח 👍' : 'דילגתי. לא נשלח ללקוח הזה את ההודעה הזו.') : 'ההודעה הזו כבר טופלה.' };
  }
  if (DONE.test(t) || SKIP.test(t)) {
    const last = (await store.load(clientId))?.growthLast;
    if (!last) return null;
    const row = await growth.markOutreach(clientId, last, DONE.test(t) ? 'LINK_GIVEN' : 'SKIPPED').catch(() => null);
    return { text: row ? (DONE.test(t) ? 'מעולה, סימנתי שנשלח 👍' : 'דילגתי על ההודעה הזו.') : 'ההודעה הזו כבר טופלה.' };
  }
  if (FUNNELS.test(t)) {
    const direct = DIRECT[t];
    if (direct) return funnelCampaign(clientId, direct);
    const s = await growth.suggest(clientId);
    const rec = s.funnels.find((f) => f.key === s.recommended);
    const lines = ['🎯 סוגי קמפיינים שמתאימים לעסק שלך:', '', ...s.funnels.map((f) => `• ${f.label}${f.key === s.recommended ? ' ⭐ מומלץ עכשיו' : ''}\n  ${f.hook}`), '',
      `ההמלצה שלי: ${rec.label}${rec.used ? '' : ' (עוד לא הרצת קמפיין כזה בחודשיים האחרונים)'}.`, 'בחר ואכין טיוטה לבדיקה שלך. שום דבר לא עולה לאוויר בלי אישור.'];
    const items = [rec, ...s.funnels.filter((f) => f !== rec)].map((f) => ({ title: shortTitle(f.label, 24), text: '/growth-funnel ' + f.key }));
    return choices(clientId, lines.join('\n'), items.slice(0, 10));
  }
  if (LOOP.test(t)) {
    const o = await growth.overview(clientId);
    const lines = ['⭐ ביקורות, המלצות ולקוחות עבר', '', o.cadence, '',
      `קישור לביקורות בגוגל: ${o.settings.reviewUrl || 'עוד לא הוגדר. אם תשלח לי אותו, אשמור אותו'}`,
      o.settings.cadenceApproved ? '✅ אישרת את הקצב הזה. הסוכן פועל לפיו.' : 'לאשר את הקצב הזה פעם אחת? אחרי האישור לא אשאל שוב על כל לקוח.'];
    if (o.settings.cadenceApproved) return choices(clientId, lines.join('\n'), [{ title: 'לא לשלוח לבד', text: '/growth-cadence no' }]);
    return choices(clientId, lines.join('\n'), [{ title: 'מאשר את הקצב', text: '/growth-cadence yes' }, { title: 'לא עכשיו', text: '/growth-cadence no' }]);
  }
  if ((m = t.match(REVIEW))) {
    const url = m[1] || m[2];
    if (!url) return { text: 'שלח את הקישור לביקורות שלך בגוגל, למשל:\nקישור לביקורות https://g.page/r/...\nאת הקישור מוצאים בפרופיל העסק בגוגל, תחת "בקשת ביקורות".' };
    try { await growth.saveSettings(clientId, { reviewUrl: url }); } catch { return { text: 'הקישור לא נראה תקין. צריך קישור מלא שמתחיל ב־https://' }; }
    return { text: 'שמרתי ✅ הקישור יצורף לכל הודעת תודה אחרי עסקה.' };
  }
  if ((m = t.match(COMMISSION))) {
    const pct = Number(m[2].replace(',', '.'));
    try { await growth.saveSettings(clientId, m[1] ? { rentCommissionPct: pct } : { commissionPct: pct }); } catch { return { text: 'האחוז לא נראה תקין.' }; }
    return { text: `שמרתי ✅ ברירת המחדל לעמלה${m[1] ? ' בשכירות' : ''}: ${pct}%${m[1] ? ' משכר דירה חודשי' : ''}. אפשר לשנות בכל עסקה.` };
  }
  if ((m = t.match(LICENSE))) {
    await store.update(clientId, null, (p) => { p.brokerLicense = m[1]; return { handled: false, changed: true }; });
    return { text: `שמרתי את רישיון התיווך ${m[1]} ✅ הוא יופיע בכל מודעה. רוצה לבחור עכשיו סוג קמפיין? רק תבקש ממני את סוגי הקמפיינים.` };
  }
  if (TEAM.test(t)) return { text: await growth.teamReportText(clientId) };
  return null;
}

async function funnelCampaign(clientId, key) {
  const r = await require('./metaConnection').context.run(String(clientId), () => growth.prepareFunnelCampaign(clientId, key, { channel: 'WHATSAPP' }));
  return r.blocked ? { text: r.reply } : { task: r, clientId };
}

module.exports = { handleText };
