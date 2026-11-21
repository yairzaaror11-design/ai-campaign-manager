'use strict';
// Ad-copy compliance rules: one bad and one good example per rule.
const test = require('node:test'), assert = require('node:assert/strict');
const ac = require('../adCompliance');
const codes = (text, opts) => ac.check(text, opts).map((f) => f.code);
const severity = (text, code, opts) => ac.check(text, opts).find((f) => f.code === code)?.severity;

test('Meta personal attributes: questions or assertions about the reader are blocked', () => {
  const bad = {
    PERSONAL_HEALTH: ['סובלים מכאבי גב? בואו לטיפול', 'כואב לכם הגב כל בוקר?', 'יש לך עודף משקל? יש פתרון', 'אתם בהריון? קורס הכנה ללידה'],
    PERSONAL_FINANCE: ['יש לך חובות? נעזור לך לצאת מהם', 'נמאס לכם מחובות?', 'אתם במינוס? נסדר את זה', 'לא מצליחים לסגור את החודש?'],
    PERSONAL_AGE: ['בני 50+? יש לנו מסלול בשבילכם', 'אתם מעל גיל 60? בואו לסדנה', 'בגיל 40? הגיע הזמן'],
    PERSONAL_RELIGION: ['אתם שומרי שבת? יש לנו מסלול מיוחד', 'דתיים? יש לנו הפרדה'],
    PERSONAL_ETHNICITY: ['עולים חדשים? נעזור עם הבירוקרטיה', 'אתם יוצאי אתיופיה?'],
    PERSONAL_ORIENTATION: ['אתה גיי? אפליקציה חדשה', 'להט״ב? בואו לערב'],
    PERSONAL_DISABILITY: ['אתם עם מוגבלות? נעזור', 'יש לך אחוזי נכות? תבדוק זכויות'],
    PERSONAL_CRIMINAL: ['יש לך רישום פלילי? נמחק אותו', 'עבר פלילי? אנחנו כאן'],
  };
  for (const [code, texts] of Object.entries(bad)) for (const t of texts) assert.equal(severity(t, code), 'block', `${code}: ${t}`);
  const good = ['טיפול בכאבי גב בהרצליה', 'ייעוץ לסגירת חובות, פגישה ראשונה בלי התחייבות', 'סדנה לגיל השלישי בתל אביב', 'מסעדה כשרה בירושלים', 'אתם מוזמנים לבוא לשיעור ניסיון', 'דירת 4 חדרים עם מעלית', 'מאמן כושר אישי בגבעתיים'];
  for (const t of good) assert.deepEqual(codes(t).filter((c) => c.startsWith('PERSONAL_')), [], t);
});

test('prices must include VAT', () => {
  for (const t of ['טיפול פנים 300 ₪ לפני מע״מ', 'רק 99 ש"ח + מע"מ', 'מחיר 1,200 ₪ לא כולל מע״מ', 'המחיר בתוספת מע"מ', 'מע״מ לא כלול במחיר', 'Only 99 + VAT'])
    assert.equal(severity(t, 'PRICE_WITHOUT_VAT'), 'block', t);
  for (const t of ['טיפול פנים 300 ₪', 'המחיר כולל מע״מ', '1,200 ₪ כולל מע"מ']) assert.equal(severity(t, 'PRICE_WITHOUT_VAT'), undefined, t);
});

test('misleading absolutes are a warning, not a block', () => {
  for (const t of ['הכי זול בישראל!', 'הזול ביותר באזור', '100% הצלחה', 'תוצאה מובטחת', 'מספר 1 בישראל', 'הטובים ביותר בארץ', 'בלי סיכון'])
    assert.equal(severity(t, 'MISLEADING_ABSOLUTE'), 'warn', t);
  for (const t of ['מחירים הוגנים, 12 שנים בתחום', 'הכי טוב שתעשו השנה', 'שירות מהיר']) assert.equal(severity(t, 'MISLEADING_ABSOLUTE'), undefined, t);
});

test('medical: no promised results, prices, promotions, patients; "מומחה" is a warning', () => {
  const clinic = { industry: 'services', businessType: 'מרפאה לרפואה אסתטית' };
  assert.equal(severity('תוצאות מובטחות כבר מהטיפול הראשון', 'MEDICAL_RESULT_PROMISE', clinic), 'block');
  assert.equal(severity('95% הצלחה בטיפולי שיניים', 'MEDICAL_RESULT_PROMISE', clinic), 'block');
  assert.equal(severity('בוטוקס ב־900 ₪ בלבד', 'MEDICAL_PRICE_PROMO', clinic), 'block');
  assert.equal(severity('מבצע החודש על הלבנת שיניים', 'MEDICAL_PRICE_PROMO', clinic), 'block');
  assert.equal(severity('טיפול שני במתנה', 'MEDICAL_PRICE_PROMO', clinic), 'block');
  assert.equal(severity('תמונות לפני ואחרי של מטופלות', 'MEDICAL_PATIENTS', clinic), 'block');
  assert.equal(severity('מטופלים ממליצים עלינו', 'MEDICAL_PATIENTS', clinic), 'block');
  assert.equal(severity('ד״ר כהן, מומחה לאסתטיקה', 'MEDICAL_EXPERT_TITLE', clinic), 'warn');
  assert.equal(severity('ד״ר כהן, מומחה לאסתטיקה', 'MEDICAL_EXPERT_TITLE', { ...clinic, recognizedTitle: true }), undefined);
  // A compliant clinic ad.
  assert.deepEqual(codes('הזרקת בוטוקס במרפאה בהרצליה. רופאה עם 12 שנות ניסיון. קבעו פגישת ייעוץ.', clinic), []);
  // Medical words in the ad itself are enough for a service business.
  assert.equal(severity('בוטוקס ב־900 ₪', 'MEDICAL_PRICE_PROMO', { industry: 'services' }), 'block');
  // Not medical: a beautician or a shop may show prices and sales.
  assert.deepEqual(codes('טיפול פנים 250 ₪, מבצע החודש', { industry: 'services', businessType: 'קוסמטיקאית' }), []);
  assert.deepEqual(codes('מבצע 1+1 על כל הנעליים', { industry: 'retail' }), []);
  assert.equal(ac.isMedical({ industry: 'real_estate' }, 'רופא'), false);
});

test('real estate: the broker license number must appear', () => {
  assert.equal(severity('דירת 4 חדרים בחולון. השאירו פרטים.', 'ESTATE_LICENSE_MISSING', { industry: 'real_estate' }), 'block');
  assert.equal(severity('דירת 4 חדרים בחולון', 'ESTATE_LICENSE_MISSING', { industry: 'real_estate', licenseNumber: '12345678' }), 'block');
  assert.deepEqual(codes("דירת 4 חדרים בחולון\nרישיון תיווך מס' 12345678", { industry: 'real_estate', licenseNumber: '12345678' }), []);
  assert.deepEqual(codes('דירת 4 חדרים. רישיון תיווך 314159', { industry: 'real_estate' }), []);
  assert.deepEqual(codes('דירת 4 חדרים בחולון', { industry: 'services' }), []);
});

test('a price the owner did not give is a warning', () => {
  assert.equal(severity('שיעור ניסיון ב־50 ₪', 'PRICE_NOT_FROM_OWNER', { priceGiven: false }), 'warn');
  assert.equal(severity('שיעור ניסיון ב־50 ₪', 'PRICE_NOT_FROM_OWNER', { priceGiven: true }), undefined);
  assert.deepEqual(ac.prices('רק 1,200 ₪ או ₪99 או 30 ש"ח'), ['1200', '99', '30']);
});

test('owner message: blocks first with the fix and the offer, warnings in one line', () => {
  const f = ac.check('סובלים מכאבי גב? 200 ₪ +מע״מ. הכי זול בעיר');
  assert.deepEqual(f.map((x) => x.severity), ['block', 'block', 'warn']);
  const msg = ac.ownerMessage(f);
  assert.match(msg, /^לפני שמאשרים, צריך לתקן במודעה:/);
  assert.match(msg, /כולל מע״מ/);
  assert.match(msg, /לתקן לבד\?/);
  assert.equal(msg.split('\n').filter((l) => l.startsWith('כדאי לבדוק')).length, 1);
  const warnOnly = ac.ownerMessage(ac.check('הכי זול בעיר'));
  assert.doesNotMatch(warnOnly, /לתקן לבד|לפני שמאשרים/);
  const fix = ac.fixInstruction(f);
  assert.equal(fix.code, 'AD_COMPLIANCE');
  assert.match(fix.instruction, /PERSONAL_HEALTH/);
  assert.doesNotMatch(fix.instruction, /MISLEADING_ABSOLUTE/);
  assert.deepEqual(ac.check(''), []);
});

test('rules are data and every message is Hebrew', () => {
  for (const r of ac.RULES) {
    assert.ok(/^[A-Z_]+$/.test(r.code) && ['block', 'warn'].includes(r.severity) && r.patterns.length, r.code);
    assert.match(r.hebrewMessage, /[א-ת]/);
    assert.match(r.suggestion, /[א-ת]/);
  }
  assert.match(require('../taskPlanner').SYSTEM || ac.PLANNER_RULES, /COMPLIANCE|AD COPY/);
});
