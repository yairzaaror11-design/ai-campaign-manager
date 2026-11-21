'use strict';
// Ad-copy compliance check: Meta's personal-attributes policy, Israeli consumer-protection
// pricing (full price incl. VAT), the doctors' advertising regulations (2008) and the real-estate
// broker license line. Based on research_notes/.../copywriting_standards.md. Not legal advice:
// the rules are deliberately conservative and kept as data so a lawyer can adjust them.
//
// check(adText, {industry, businessType, priceGiven, licenseNumber, recognizedTitle})
//   -> [{code, severity:'block'|'warn', hebrewMessage, suggestion, match}]

// Hebrew has no \b in JS regexes: a match may start only where no Hebrew letter precedes it
// (one or two prefix letters are allowed: "וסובלים", "במתנה").
const HE = '\\u0590-\\u05FF';
const word = (src) => new RegExp(`(?<![${HE}])[ושבלהכמ]{0,2}(?:${src})`, 'iu');
const YOU = '(?:אתה|את|אתם|אתן)\\s+';
const HAVE = '(?:יש|נמאס)\\s+(?:לך|לכם|לכן)\\s+(?:מ)?';
const Q = '[^.!?\\n]{0,40}\\?';

const PERSONAL = {
  severity: 'block',
  hebrewMessage: 'Meta אוסרת לפנות לקורא לגבי מצב אישי: בריאות, כסף, גיל, דת, מוצא, נטייה, מוגבלות או עבר פלילי.',
  suggestion: 'כותבים על השירות ולא על הקורא, למשל ״טיפול בכאבי גב בהרצליה״.',
};

const RULES = [
  // Meta: personal attributes (asserting or implying the reader's attribute).
  { code: 'PERSONAL_HEALTH', ...PERSONAL, patterns: [
    word('סובל(?:ים|ת|ות)?\\s+מ'),
    word('(?:כואב|כואבים|כואבת)\\s+(?:לך|לכם)'),
    word(HAVE + '(?:כאבי|כאב|סוכרת|לחץ\\s+דם|עודף\\s+משקל|משקל\\s+עודף|דיכאון|חרדה|חרדות|בעיות\\s+(?:שינה|עור|פוריות|זיקפה)|אקנה|נשירת\\s+שיער|קרחת)'),
    word(YOU + '(?:חולה|חולים|חולות|בדיכאון|בהריון|סוכרתי(?:ים|ת)?|שמנ(?:ים|ה)?|במשקל\\s+עודף)'),
    word('(?:עודף\\s+משקל|קרחת|נשירת\\s+שיער|דיכאון|חרדות?|אקנה)' + '\\s*\\?'),
    word('רוצ(?:ים|ה|ות)\\s+לרדת\\s+במשקל' + Q),
  ] },
  { code: 'PERSONAL_FINANCE', ...PERSONAL, patterns: [
    word(HAVE + 'חובות'),
    word(YOU + '(?:במינוס|בחובות|בפשיטת\\s+רגל|בהליך\\s+פשיטת\\s+רגל|בהוצאה\\s+לפועל)'),
    word('(?:חובות|מינוס|פשיטת\\s+רגל|הוצאה\\s+לפועל)\\s*\\?'),
    word('(?:במינוס|בחובות)\\s*\\?'),
    word('לא\\s+מצליח(?:ים|ה|ות)?\\s+לסגור\\s+את\\s+החודש'),
  ] },
  { code: 'PERSONAL_AGE', ...PERSONAL, patterns: [
    word('בנ(?:י|ות)\\s*\\d{2}\\s*(?:\\+|ומעלה|פלוס)?\\s*\\?'),
    word('בגיל\\s*\\d{2}\\s*(?:\\+|ומעלה|פלוס)?\\s*\\?'),
    word(YOU + '(?:מעל\\s+(?:גיל\\s+)?\\d{2}|בגיל\\s+\\d{2}|בני\\s+\\d{2}|בנות\\s+\\d{2}|פנסיונר(?:ים|ית)?|גמלאי(?:ם|ת)?)'),
    word('(?:פנסיונרים|גמלאים)\\s*\\?'),
  ] },
  { code: 'PERSONAL_RELIGION', ...PERSONAL, patterns: [
    word(YOU + '(?:דתי(?:ים|ה|ות)?|חרדי(?:ם|ת|ות)?|מוסלמי(?:ם|ת)?|נוצרי(?:ם|ת)?|שומר(?:ים|ת|ות)?\\s+(?:שבת|מסורת))'),
    word('(?:דתיים|חרדים|שומרי\\s+שבת|שומרות\\s+שבת|מוסלמים|נוצרים)\\s*\\?'),
  ] },
  { code: 'PERSONAL_ETHNICITY', ...PERSONAL, patterns: [
    word(YOU + '(?:ערבי(?:ם|ה|יה)?|יוצא(?:י|ת)?\\s+אתיופיה|עול(?:ה|ים|ות)\\s+חדש(?:ים|ה|ות)?)'),
    word('(?:עולים\\s+חדשים|יוצאי\\s+אתיופיה|דוברי\\s+רוסית)\\s*\\?'),
  ] },
  { code: 'PERSONAL_ORIENTATION', ...PERSONAL, patterns: [
    word(YOU + '(?:הומו|הומואים|לסבית|לסביות|גיי|גאים|גאה|ביסקסואל(?:ים|ית)?|טרנס(?:ים|ית)?)'),
    word('(?:הומו|גיי|לסבית|להט[״"]?ב(?:ים)?)\\s*\\?'),
  ] },
  { code: 'PERSONAL_DISABILITY', ...PERSONAL, patterns: [
    word(YOU + '(?:נכ(?:ה|ים|ות)|עם\\s+מוגבלות|בכיסא\\s+גלגלים|עיוור(?:ים|ת)?|חירש(?:ים|ת)?)'),
    word('(?:יש|יש\\s+לך|יש\\s+לכם)\\s+(?:אחוזי\\s+)?(?:נכות|מוגבלות)'),
    word('(?:נכים|עם\\s+מוגבלות|בעלי\\s+מוגבלות)\\s*\\?'),
  ] },
  { code: 'PERSONAL_CRIMINAL', ...PERSONAL, patterns: [
    word('(?:רישום|עבר|תיק)\\s+פלילי' + '\\s*\\?'),
    word('יש\\s+(?:לך|לכם|לכן)\\s+(?:רישום|עבר|תיק)\\s+פלילי'),
    word(YOU + '(?:עם\\s+)?(?:רישום|עבר)\\s+פלילי'),
  ] },

  // Consumer Protection Law s.17: the price shown must be the full price, VAT included.
  { code: 'PRICE_WITHOUT_VAT', severity: 'block',
    hebrewMessage: 'לפי חוק הגנת הצרכן מפרסמים רק מחיר מלא, כולל מע״מ.',
    suggestion: 'כותבים את המחיר הסופי, בלי ״+מע״מ״.',
    patterns: [
      /(?:לפני|ללא|בלי|בתוספת|לא\s+כולל|אינו\s+כולל|אינם\s+כוללים|לא\s+כוללים)\s+מע["״'׳]?מ/u,
      /\+\s*מע["״'׳]?מ/u,
      /מע["״'׳]?מ\s+(?:לא\s+כלול|בנפרד|יתווסף)/u,
      /\+\s*vat\b|\bplus\s+vat\b|\bexcl(?:uding|\.)?\s+vat\b/i,
    ] },

  // Misleading absolutes (Consumer Protection Law s.2): only if the owner can prove it.
  { code: 'MISLEADING_ABSOLUTE', severity: 'warn',
    hebrewMessage: 'טענה מוחלטת כמו ״הכי זול״, ״100% הצלחה״ או ״מובטח״ מותרת רק אם אפשר להוכיח אותה.',
    suggestion: 'עדיף עובדה שאפשר להוכיח: מחיר, שנים בתחום או מספר לקוחות אמיתי.',
    patterns: [
      word('הכי\\s+זול(?:ה|ים|ות)?|הזול(?:ה|ים|ות)?\\s+ביותר'),
      word('(?:הכי\\s+(?:טוב|טובה|טובים)|(?:הטוב|הטובה|הטובים)\\s+ביותר)\\s+(?:בישראל|בארץ|באזור|בעיר)'),
      word('מספר\\s*1\\s+(?:בישראל|בארץ|באזור)'),
      /#\s*1\b/u,
      /100\s*%\s*(?:הצלחה|תוצאות|שביעות\s+רצון)|הצלחה\s+של\s+100\s*%/u,
      word('מובטח(?:ת|ים|ות)?|מבטיח(?:ים|ה)?\\s+(?:תוצאות|הצלחה)|בלי\\s+סיכון|ללא\\s+סיכון'),
    ] },

  // Doctors' advertising regulations (2008) and the parallel dentists' rules. Medical only.
  { code: 'MEDICAL_RESULT_PROMISE', severity: 'block', medical: true,
    hebrewMessage: 'בפרסום רפואי אסור להבטיח תוצאה או לציין אחוזי הצלחה.',
    suggestion: 'מתארים את הטיפול ואת התהליך, בלי הבטחה.',
    patterns: [
      word('(?:תוצאות|תוצאה|הצלחה)\\s+(?:מובטחת|מובטחות|בטוחה|בטוחות|מוכחת|מוכחות)'),
      word('מבטיח(?:ים|ה)?\\s+(?:תוצאות|תוצאה|הצלחה)'),
      /\d+\s*%\s*(?:הצלחה|מהמטופלים|שיפור)/u,
      word('(?:אחוזי|שיעורי|שיעור|אחוז)\\s+הצלחה'),
    ] },
  { code: 'MEDICAL_PRICE_PROMO', severity: 'block', medical: true,
    hebrewMessage: 'בפרסום רפואי אסור לציין מחיר, מבצע, הנחה, מתנה או הגרלה.',
    suggestion: 'מזמינים לפגישת ייעוץ, בלי מחיר ובלי הטבה.',
    patterns: [
      /\d[\d,.]*\s*(?:₪|ש["״]?ח|שקלים|שקל)|₪\s*\d/u,
      // "מבצעים טיפולים" (performing) is not a sale.
      word('מבצע(?:ים)?(?![\u0590-\u05FF])(?!\\s+(?:את|טיפול|טיפולי|טיפולים|הזרקות|ניתוחי|ניתוחים|בדיקות|הלבנ|השתלות))|הנח(?:ה|ות)|מתנה|מתנות|הגרל(?:ה|ות)|קופון|1\\s*\\+\\s*1'),
      /\d+\s*%\s*הנחה/u,
    ] },
  { code: 'MEDICAL_PATIENTS', severity: 'block', medical: true,
    hebrewMessage: 'בפרסום רפואי אסור ״לפני ואחרי״ או המלצות וסיפורים של מטופלים.',
    suggestion: 'מתארים את הטיפול עצמו.',
    patterns: [
      word('לפני\\s*(?:ו|\\/|-|–)\\s*אחרי|לפני\\s+ואחרי'),
      /before\s*(?:&|and|\/)?\s*after/i,
      word('המלצ(?:ה|ות)\\s+(?:של\\s+)?מטופל(?:ים|ות|ת)?'),
      word('מטופל(?:ים|ות|ת)?\\s+(?:מספר(?:ים|ת|ות)?|ממליצ(?:ים|ה|ות)?|מרוצ(?:ים|ה|ות))'),
      word('(?:סיפור|סיפורים)\\s+(?:של\\s+)?מטופל'),
    ] },
  { code: 'MEDICAL_EXPERT_TITLE', severity: 'warn', medical: true, unlessTitle: true,
    hebrewMessage: 'בפרסום רפואי, ״מומחה״ מותר רק עם תואר מומחה מוכר ממשרד הבריאות.',
    suggestion: 'אם אין תואר כזה, כותבים את שנות הניסיון במקום.',
    patterns: [word('מומח(?:ה|ית|ים|יות)')] },
];

// Medical businesses: doctors, dentists, clinics and medical aesthetics (botox, fillers).
// A beautician is not covered by the doctors' regulations, so plain "טיפול"/"קוסמטיקה" is not medical.
const MEDICAL = /רופא|רופאה|רופאת|ד["״]ר|דוקטור|מרפא(?:ה|ת)|קליניק(?:ה|ת)\s+(?:רפואית|לרפואת|אסתטית|לאסתטיקה)|רפואה\s+אסתטית|רפואת\s+שיניים|שיננית|אורתודונט|בוטוקס|פילר|חומצה\s+היאלורונית|דרמטולוג|כירורג|ניתוחי|ניתוח\s+(?:פלסטי|אף|קיצור|להרזיה)|השתלת\s+שיער|אסתטיקה\s+רפואית/u;
const LICENSE = /רישיון\s*(?:תיווך)?\s*(?:מס(?:פר|['׳.])?)?\s*:?\s*\d{3,10}/u;
const PRICE_SRC = '\\d[\\d,.]*\\s*(?:₪|ש["״]?ח|שקלים|שקל)|₪\\s*\\d[\\d,.]*';
const PRICE = new RegExp(PRICE_SRC, 'u');

function isMedical({ industry, businessType } = {}, text = '') {
  if (industry === 'medical') return true;
  if (industry && !['services', 'generic'].includes(industry)) return false;
  return MEDICAL.test(String(businessType || '')) || MEDICAL.test(text);
}

function check(adText, options = {}) {
  const text = String(adText || '').normalize('NFC');
  const findings = [];
  if (!text.trim()) return findings;
  const medical = isMedical(options, text);
  const seen = new Set();
  for (const rule of RULES) {
    if (rule.medical && !medical) continue;
    if (rule.unlessTitle && options.recognizedTitle) continue;
    for (const re of rule.patterns) {
      const m = text.match(re);
      if (!m) continue;
      if (!seen.has(rule.code)) {
        seen.add(rule.code);
        findings.push({ code: rule.code, severity: rule.severity, hebrewMessage: rule.hebrewMessage, suggestion: rule.suggestion, match: m[0].trim() });
      }
      break;
    }
  }
  // Real estate: the broker license number must appear in every ad.
  if (options.industry === 'real_estate') {
    const n = options.licenseNumber ? String(options.licenseNumber) : null;
    if (!(n ? text.includes(n) : LICENSE.test(text))) {
      findings.push({ code: 'ESTATE_LICENSE_MISSING', severity: 'block', hebrewMessage: 'במודעת תיווך חייב להופיע מספר רישיון התיווך.', suggestion: n ? `מוסיפים בסוף המודעה: רישיון תיווך מס' ${n}` : 'מוסיפים בסוף המודעה את מספר הרישיון.', match: null });
    }
  }
  // Any price in an ad must come from the owner (non-medical; medical prices are blocked above).
  if (options.priceGiven === false && !medical && PRICE.test(text)) {
    findings.push({ code: 'PRICE_NOT_FROM_OWNER', severity: 'warn', hebrewMessage: 'יש במודעה מחיר שלא קיבלתי ממך, כדאי לוודא שהוא נכון וכולל מע״מ.', suggestion: 'משאירים רק מחיר שבעל העסק מסר.', match: text.match(PRICE)[0] });
  }
  // Blocks first, so the owner sees what stops approval at the top.
  return findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'block' ? -1 : 1));
}

const blocking = (findings) => findings.filter((f) => f.severity === 'block');
const warnings = (findings) => findings.filter((f) => f.severity === 'warn');

// The numbers that look like prices in the ad.
function prices(text) { return [...String(text || '').matchAll(new RegExp(PRICE_SRC, 'gu'))].map((m) => m[0].replace(/[^\d]/g, '')).filter(Boolean); }

// One short owner-facing message: what must be fixed, then one line for warnings.
function ownerMessage(findings) {
  const blocks = blocking(findings), warns = warnings(findings);
  const lines = [];
  if (blocks.length) {
    lines.push('לפני שמאשרים, צריך לתקן במודעה:');
    const unique = [...new Map(blocks.map((f) => [f.hebrewMessage, f])).values()];
    for (const f of unique) lines.push('• ' + f.hebrewMessage + ' ' + f.suggestion);
  }
  if (warns.length) lines.push('כדאי לבדוק: ' + [...new Set(warns.map((f) => f.hebrewMessage))].join(' '));
  if (blocks.length) lines.push('', 'לתקן לבד? אכין נוסח מתוקן ואשלח לך לבדיקה.');
  return lines.join('\n');
}

// Planner feedback for an automatic fix: precise, in English, for the model.
function fixInstruction(findings) {
  return {
    code: 'AD_COMPLIANCE',
    instruction: 'The owner asked you to fix legal/policy problems in the prepared ad copy. Revise the existing prepared draft step with op "draft" (same stepId; resend campaignDraft/formDraft if the draft has them, changing only what is needed). Keep facts, offer and tone; do not add new claims. Fix every item: '
      + blocking(findings).map((f) => `${f.code}${f.match ? ` (found: "${f.match}")` : ''}: ${f.suggestion}`).join(' | '),
  };
}

// Short rule summary for the planning prompt, so drafts are written compliant to begin with.
const PLANNER_RULES = `AD COPY COMPLIANCE (checked by the backend before the owner can approve)
- Meta personal attributes: never ask or assert the reader's health, finances/debts, age, religion, ethnicity, sexual orientation, disability or criminal record ("סובלים מ...?", "יש לך חובות?", "בני 50+?"). Write about the service: "טיפול בכאבי גב בהרצליה".
- Prices: only full prices including VAT; never "+מע״מ" or "לפני מע״מ". Never invent a price.
- Doctors, dentists, clinics, medical aesthetics: no prices, discounts, gifts or raffles; no promised results or success rates; no patients, testimonials or before/after; "מומחה" only with a recognized specialist title.
- Real estate: every ad carries the broker license line "רישיון תיווך מס' N" (the backend adds it).
- No unprovable absolutes ("הכי זול בישראל", "100% הצלחה", "מובטח").`;

module.exports = { RULES, check, blocking, warnings, prices, ownerMessage, fixInstruction, isMedical, PLANNER_RULES };
