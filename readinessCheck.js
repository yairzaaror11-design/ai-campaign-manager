'use strict';
// Pre-launch diagnosis (P4): before spending on ads, check the business is ready
// to turn leads into sales. Every finding is based on data SCORPIO has; when data
// is missing it says so instead of guessing.
const db = require('./db');

const LEVEL = { BLOCKER: 'חוסם', IMPORTANT: 'חשוב', NICE: 'מומלץ' };

async function facts(clientId) {
  const profile = await require('./marketingStore').load(clientId);
  return profile ? require('./conversationFacts').all(profile) : {};
}

async function leadHandling(clientId) {
  const r = (await db.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status<>'NEW')::int AS handled,
      COUNT(*) FILTER (WHERE status='NEW' AND created_at<NOW()-INTERVAL '1 day')::int AS stale,
      COUNT(*) FILTER (WHERE status='WON')::int AS won,
      COUNT(*) FILTER (WHERE status='WON' AND revenue_minor IS NOT NULL)::int AS won_with_amount
    FROM crm_leads WHERE client_id=$1 AND created_at>NOW()-INTERVAL '60 days'`, [clientId])).rows[0];
  return r;
}

// Meta inventory through the existing read-only checker; null when not connected.
async function metaInventory(clientId) {
  try {
    return await require('./metaConnection').context.run(String(clientId), () => require('./campaignSetup').read(clientId));
  } catch { return null; }
}

function findings({ f, leads, meta, media }) {
  const out = [];
  const add = (level, area, text, fix) => out.push({ level, area, text, fix });
  // 1. Offer and business understanding
  if (!f.product && !f.businessType) add('BLOCKER', 'העסק', 'עוד לא ברור מה העסק מוכר.', 'אפשר לספר לי בהודעה קולית קצרה מה העסק מוכר ולמי.');
  if (!f.offer) add('IMPORTANT', 'ההצעה', 'אין הצעה ברורה לקמפיין (מה הלקוח מקבל ולמה עכשיו).', 'כדאי להגדיר הצעה: מחיר, הטבה, או מה כלול בשירות.');
  if (!f.advantage) add('IMPORTANT', 'ההצעה', 'לא הוגדר למה לבחור דווקא בעסק הזה.', 'כדאי לספר לי על 1–2 יתרונות אמיתיים מול המתחרים.');
  if (!f.audience && !f.idealCustomer) add('IMPORTANT', 'קהל', 'לא הוגדר מי הלקוח הרצוי ומי לא מתאים.', 'כדאי לתאר לי את הלקוח הכי טוב שלך.');
  if (!f.geography && !f.serviceArea) add('IMPORTANT', 'קהל', 'לא הוגדר אזור הפרסום.', 'באיזה אזור אתה נותן שירות?');
  if (!f.proof) add('NICE', 'אמון', 'אין המלצות או עבודות להצגה.', 'כדאי לשלוח לי 2–3 המלצות או תמונות של עבודות.');
  // 2. Lead intake and follow-up
  if (!f.leadDestination) add('IMPORTANT', 'קבלת פניות', 'לא הוגדר איך מקבלים פניות (טופס, וואטסאפ או שיחה).', 'כדאי לבחור איך נוח לך לקבל פניות.');
  if (!f.leadOwner) add('IMPORTANT', 'טיפול בלידים', 'לא הוגדר מי חוזר לפניות ותוך כמה זמן.', 'כדאי לספר לי מי מטפל בפניות ובאילו שעות.');
  if (leads.total >= 3 && leads.handled / leads.total < 0.7) add('BLOCKER', 'טיפול בלידים', `רק ${leads.handled} מתוך ${leads.total} הפניות האחרונות עודכנו כמטופלות.`, 'לפני שמגדילים תקציב, כדאי לחזור לכל הפניות. יותר פרסום יביא עוד פניות שלא מטופלות.');
  if (leads.stale > 0) add('IMPORTANT', 'טיפול בלידים', `${leads.stale} פניות מחכות יותר מיום בלי טיפול.`, 'כדאי לעבור על הפניות ולעדכן מה קרה עם כל אחת. אפשר לבקש ממני את רשימת הפניות.');
  // 3. Measurement and sales data
  if (leads.total === 0) add('NICE', 'מדידה', 'עוד אין נתוני פניות במערכת, ולכן אי אפשר עדיין למדוד איזה קמפיין מביא לקוחות.', 'אחרי שהקמפיין יתחיל, כדאי לעדכן כל פנייה: נוצר קשר, פגישה, נסגרה.');
  else if (leads.won === 0) add('IMPORTANT', 'מדידה', 'אין עסקאות שסומנו כנסגרו, ולכן אי אפשר להוכיח שהפרסום מביא הכנסה.', 'כשנסגרת עסקה, כדאי לסמן אותה ולהוסיף סכום.');
  else if (leads.won_with_amount < leads.won) add('NICE', 'מדידה', 'חלק מהעסקאות נסגרו בלי סכום.', 'הוספת סכום לכל עסקה תאפשר לחשב רווחיות.');
  // 4. Ad account and tracking
  if (!meta) add('BLOCKER', 'חשבון פרסום', 'חשבון מטא לא מחובר או לא נבחר חשבון מודעות, ולכן לא נבדקו דף, פיקסל וטפסים.', 'אם תבקש ממני לחבר את מטא, אשלח לך קישור לחיבור.');
  else {
    if (!(meta.pages || []).length) add('BLOCKER', 'חשבון פרסום', 'לא נמצא עמוד פייסבוק שאפשר לפרסם ממנו.', 'צריך עמוד עסקי בפייסבוק עם הרשאת ניהול.');
    if (!(meta.pixels || []).length && f.website) add('IMPORTANT', 'מעקב', 'יש אתר אבל לא נמצא פיקסל של מטא, ולכן פעולות באתר לא יימדדו.', 'צריך להתקין פיקסל מטא באתר.');
  }
  // 5. Creative
  if (!media && !f.materials) add('NICE', 'קריאייטיב', 'אין תמונות או סרטונים של העסק.', 'כדאי לשלוח לי כמה תמונות אמיתיות, או לבקש ממני להכין גרפיקה.');
  return out;
}

async function run(clientId, { inventory = metaInventory } = {}) {
  const [f, leads, meta, media] = await Promise.all([
    facts(clientId), leadHandling(clientId), inventory(clientId),
    db.query("SELECT 1 FROM tenant_media WHERE client_id=$1 AND media_type IN ('image','video') AND expires_at>NOW() LIMIT 1", [clientId]).then((r) => r.rows.length > 0)
  ]);
  const list = findings({ f, leads, meta, media });
  const order = { BLOCKER: 0, IMPORTANT: 1, NICE: 2 };
  list.sort((a, b) => order[a.level] - order[b.level]);
  return { ready: !list.some((x) => x.level === 'BLOCKER'), findings: list };
}

function format(result) {
  if (!result.findings.length) return '✅ בדיקת מוכנות: לא מצאתי פערים לפני פרסום. אפשר להתקדם לתוכנית הקמפיין.';
  const lines = [result.ready ? '🟡 בדיקת מוכנות: אפשר לפרסם, אבל כדאי לסגור כמה פערים' : '🔴 בדיקת מוכנות: יש דברים שכדאי לסדר לפני שמוציאים כסף על פרסום', ''];
  result.findings.slice(0, 8).forEach((x, i) => { lines.push(`${i + 1}. [${LEVEL[x.level]}] ${x.text}`); lines.push(`   ← ${x.fix}`); });
  if (result.findings.length > 8) lines.push(`ועוד ${result.findings.length - 8} נקודות.`);
  lines.push('');
  lines.push('הבדיקה מבוססת רק על מה שנמסר למערכת ועל החשבון המחובר. מה שלא ידוע מסומן כחסר.');
  return lines.join('\n');
}

module.exports = { run, format, findings };
