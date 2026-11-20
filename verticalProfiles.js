'use strict';
// Vertical profiles: what a business sells and what an item of it needs. One generic
// catalog ("מה אני מוכר") is shaped per vertical: the label, the item fields (stored in
// catalog_items.attributes), which of them are required, how text is read, and the
// vertical's advertising rules. Real-estate rules apply only to the real_estate profile.
const { logger } = require('./logger');

const PRICE_WORDS = /(?:מחיר|מבוקש|עולה|עלות|שכירות|שכ["״]ד)/;
function parseNumber(s) { return Number(String(s).replace(/,/g, '.').replace(/\.(?=\d{3}(?:\D|$))/g, '')); }
function parsePrice(t) {
  t = String(t || '');
  let m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:מיליון|מליון|מ['׳](?=\s|$|₪)|M\b)/i);
  if (m) return Math.round(parseNumber(m[1]) * 1_000_000);
  m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:אלף|K\b)/i);
  if (m) return Math.round(parseNumber(m[1]) * 1000);
  m = t.match(new RegExp(PRICE_WORDS.source + '[:\\s]*(?:של\\s*)?(?:החל מ[־-]?\\s*)?₪?\\s*(\\d{1,3}(?:,\\d{3})+|\\d{2,10})')) || t.match(/₪\s*(\d{1,3}(?:,\d{3})+|\d{1,10})/) || t.match(/(\d{1,3}(?:,\d{3})+|\d{1,10})\s*(?:₪|ש["״]ח|שקל)/) || t.match(/(?<![\d.])(\d{1,3}(?:,\d{3}){1,3})(?![\d])/);
  if (m) { const n = Number(m[1].replace(/,/g, '')); return n >= 1 ? n : null; }
  return null;
}
const money = (n) => Number(n).toLocaleString('en-US');
const FEATURE_WORDS = [['מעלית', 'מעלית'], ['חניה', 'חניה'], ['חנייה', 'חניה'], ['ממ"ד', 'ממ"ד'], ['ממ״ד', 'ממ"ד'], ['מרפסת שמש', 'מרפסת שמש'], ['מרפסת', 'מרפסת'], ['מחסן', 'מחסן'], ['משופצת', 'משופצת'], ['משופץ', 'משופץ'], ['נוף', 'נוף'], ['מיזוג', 'מיזוג'], ['גינה', 'גינה'], ['בריכה', 'בריכה'], ['מרוהטת', 'מרוהטת'], ['גישה לנכים', 'גישה לנכים'], ['כניסה מיידית', 'כניסה מיידית']];
const CITIES = ['תל אביב', 'תל אביב-יפו', 'ירושלים', 'חיפה', 'גבעתיים', 'רמת גן', 'בני ברק', 'חולון', 'בת ים', 'ראשון לציון', 'פתח תקווה', 'הרצליה', 'רעננה', 'כפר סבא', 'הוד השרון', 'רמת השרון', 'נתניה', 'חדרה', 'רחובות', 'נס ציונה', 'יבנה', 'אשדוד', 'אשקלון', 'באר שבע', 'מודיעין', 'שוהם', 'יהוד', 'אור יהודה', 'קריית אונו', 'גבעת שמואל', 'ראש העין', 'אלעד', 'לוד', 'רמלה', 'כפר יונה', 'זכרון יעקב', 'קיסריה', 'פרדס חנה', 'נהריה', 'עכו', 'כרמיאל', 'טבריה', 'עפולה', 'נצרת', 'יקנעם', 'קריית ביאליק', 'קריית מוצקין', 'קריית אתא', 'נשר', 'אילת', 'דימונה', 'ערד', 'גדרה', 'קריית גת', 'בית שמש', 'מבשרת ציון', 'מעלה אדומים', 'אריאל', 'יפו', 'צור הדסה', 'אבן יהודה', 'כוכב יאיר', 'טירת כרמל'];
const cityIn = (t) => [...CITIES].sort((a, b) => b.length - a.length).find((c) => new RegExp('(?:^|[\\sב,:-])' + c.replace(/[-\s]/g, '[-\\s]') + '(?=$|[\\s,.!:-])').test(t)) || null;
// A short item name: the text before the first comma, price or number.
function nameFrom(t, newPattern) {
  const s = String(t || '').replace(newPattern, '').split(/\n|[,.:]|\s(?=\d)|\s(?:ב|ל)?(?:מחיר|עולה|₪)/)[0].trim();
  return s.length >= 2 && s.length <= 80 ? s : null;
}

// ---------- Real estate ----------
const RE_KINDS = [['APARTMENT', 'דירה'], ['GARDEN', 'דירת גן'], ['PENTHOUSE', 'פנטהאוז'], ['DUPLEX', 'דופלקס'], ['HOUSE', 'בית פרטי'], ['OFFICE', 'משרד'], ['STORE', 'חנות'], ['LAND', 'מגרש'], ['OTHER', 'נכס']];
const WITH_ROOMS = ['APARTMENT', 'GARDEN', 'PENTHOUSE', 'DUPLEX', 'HOUSE'];
const RE_NEW = /^(?:(?:נכס|דירה|דירת\s+\S+|בית|בית פרטי|פנטהאו[זס]|דופלקס|קוטג['׳]|וילה|משרד|מגרש)\s+(?:חדש|חדשה)(?:\s+(?:למכירה|להשכרה))?|(?:הוסף|להוסיף|תוסיף|תוסיפי|אני רוצה להוסיף)\s+(?:נכס|דירה)(?:\s+חדש(?:ה)?)?|נכס\s+(?:חדש\s+)?(?:למכירה|להשכרה))\s*(?:[:：\-–]\s*|\s+|$)/;
function realEstateExtract(text) {
  const t = String(text || ''), out = {}, a = {};
  if (/פנטהאו[זס]/.test(t)) out.kind = 'PENTHOUSE';
  else if (/דירת גן/.test(t)) out.kind = 'GARDEN';
  else if (/דופלקס/.test(t)) out.kind = 'DUPLEX';
  else if (/בית פרטי|קוטג['׳]|וילה|דו[ -]משפחתי/.test(t)) out.kind = 'HOUSE';
  else if (/(?:^|\s)משרד(?:ים)?(?:\s|$|:)/.test(t)) out.kind = 'OFFICE';
  else if (/(?:^|\s)חנות(?:\s|$|:)/.test(t)) out.kind = 'STORE';
  else if (/(?:^|\s)מגרש(?:\s|$|:)/.test(t)) out.kind = 'LAND';
  if (/להשכרה|לשכירות|שכירות|להשכיר|לחודש|שכ["״]ד/.test(t)) a.dealType = 'RENT';
  else if (/למכירה|מכירה|למכור/.test(t)) a.dealType = 'SALE';
  const rooms = t.match(/(\d{1,2}(?:[.,]5)?)\s*חד(?:רים|['׳]|\b)/);
  if (rooms) a.rooms = parseNumber(rooms[1]);
  const size = t.match(/(\d{2,5})\s*(?:מ["״]ר|מטר(?:ים)?(?:\s*רבוע(?:ים)?)?|sqm)/i);
  if (size) a.sizeSqm = Number(size[1]);
  const floor = t.match(/קומה\s*(-?\d{1,3})/);
  if (floor) a.floor = Number(floor[1]); else if (/קומת קרקע/.test(t)) a.floor = 0;
  const priceText = t.replace(/(\d{1,2}(?:[.,]5)?)\s*חד(?:רים|['׳])?/g, ' ').replace(/(\d{2,5})\s*(?:מ["״]ר|מטר(?:ים)?)/g, ' ').replace(/קומה\s*-?\d{1,3}/g, ' ').replace(/(?:רישיון|רשיון)[^\d]{0,12}\d+/g, ' ');
  const price = parsePrice(priceText);
  if (price && price >= 100) out.price = price;
  if (!a.dealType && out.price) { if (out.price >= 200000) a.dealType = 'SALE'; else if (out.price <= 40000) a.dealType = 'RENT'; }
  const city = cityIn(t);
  if (city) a.city = city;
  const hood = t.match(/(?:בשכונת|שכונת|שכ['׳])\s+([֐-׿"'׳״ ]{2,30}?)(?=$|[,.\n]|\s+\d|\s+(?:ב|עם|קומה|מחיר))/);
  if (hood) a.neighbourhood = (a.city ? hood[1].replace(new RegExp('\\s*' + a.city + '$'), '') : hood[1]).trim();
  const street = t.match(/(?:ברחוב|רחוב|ברח['׳]|רח['׳])\s+([֐-׿"'׳״ ]{2,30}?(?:\s+\d{1,4})?)(?=$|[,.\n]|\s+(?:ב|עם|קומה|מחיר|\d+\s*חד))/);
  if (street) a.address = street[1].trim();
  const features = [...new Set(FEATURE_WORDS.filter(([w]) => t.includes(w)).map(([, l]) => l))].filter((f, _, all) => !(f === 'מרפסת' && all.includes('מרפסת שמש')));
  if (features.length) a.features = features;
  return { ...out, attributes: a };
}
function realEstateTitle(item) {
  const a = item.attributes || {}, kind = (RE_KINDS.find(([k]) => k === item.kind) || [null, 'נכס'])[1];
  const rooms = a.rooms && WITH_ROOMS.includes(item.kind) ? (item.kind === 'APARTMENT' ? `דירת ${a.rooms} חדרים` : `${kind} ${a.rooms} חדרים`) : kind;
  const where = a.address ? `ב${a.address}${a.city ? ', ' + a.city : ''}` : a.neighbourhood ? `בשכונת ${a.neighbourhood}${a.city ? ', ' + a.city : ''}` : a.city ? `ב${a.city}` : '';
  return `${rooms}${where ? ' ' + where : ''}`;
}

// ---------- Profiles ----------
const ROOM_CHOICES = ['2', '2.5', '3', '3.5', '4', '4.5', '5', '6'].map((r) => [r, `${r} חדרים`]);
const PROFILES = {
  real_estate: {
    key: 'real_estate', label: 'נכסים', item: 'נכס', itemPlural: 'נכסים', newWord: 'נכס חדש', example: 'דירה חדשה: 4 חדרים בגבעתיים 2.9 מיליון',
    kinds: RE_KINDS, defaultKind: 'APARTMENT', computedTitle: true, newPattern: RE_NEW, listWords: ['הנכסים שלי', 'הנכסים', 'נכסים', 'רשימת הנכסים', 'רשימת נכסים'],
    fields: [
      { key: 'dealType', label: 'סוג עסקה', type: 'choice', choices: [['SALE', 'למכירה'], ['RENT', 'להשכרה']], required: true, question: 'הנכס למכירה או להשכרה?' },
      { key: 'city', label: 'עיר', type: 'text', max: 80, required: true, question: 'באיזו עיר הנכס? אפשר להוסיף גם שכונה או רחוב.' },
      { key: 'neighbourhood', label: 'שכונה', type: 'text', max: 80 },
      { key: 'address', label: 'רחוב ומספר', type: 'text', max: 200 },
      { key: 'rooms', label: 'חדרים', type: 'number', min: 0.5, max: 30, step: 0.5, required: (i) => WITH_ROOMS.includes(i.kind), question: 'כמה חדרים?', buttons: ROOM_CHOICES },
      { key: 'sizeSqm', label: 'גודל במ"ר', type: 'number', min: 1, max: 100000, step: 1 },
      { key: 'floor', label: 'קומה', type: 'number', min: -5, max: 200, step: 1 },
      { key: 'features', label: 'מאפיינים', type: 'list' }
    ],
    priceRequired: true, priceQuestion: (i) => (i.attributes?.dealType === 'RENT' ? 'מה שכר הדירה לחודש? (למשל 6,500)' : 'מה המחיר המבוקש? (למשל 2.9 מיליון)'),
    priceSuffix: (i) => (i.attributes?.dealType === 'RENT' ? ' לחודש' : ''),
    consentRequired: true, consentQuestion: 'בעל הנכס הסכים שנפרסם את הנכס? בלי הסכמה שלו לא מפרסמים.', consentLabel: 'בעל הנכס הסכים שנפרסם את הנכס',
    license: { key: 'brokerLicense', label: 'רישיון תיווך', question: 'מה מספר רישיון התיווך שלך? הוא חייב להופיע בכל מודעה. אשמור אותו גם לנכסים הבאים.', pattern: /^[0-9]{3,10}$/, adLine: (n) => `רישיון תיווך מס' ${n}` },
    housingCategory: true, realPhotosOnly: true, discriminationSensitive: true,
    closeOutcomes: [{ key: 'SOLD', status: 'SOLD_OUT', label: 'נמכר', verb: /^(?:נמכר|נמכרה)$/ }, { key: 'RENTED', status: 'SOLD_OUT', label: 'הושכר', verb: /^(?:הושכר|הושכרה)$/ }],
    defaultOutcome: (i) => (i.attributes?.dealType === 'RENT' ? 'RENTED' : 'SOLD'),
    angles: ['הכירו את הנכס', 'סיור בנכס', 'השכונה והסביבה'],
    goal: (i) => `לידים של ${i.attributes?.dealType === 'RENT' ? 'שוכרים' : 'קונים'} מתאימים לנכס הזה`,
    extract: realEstateExtract, title: realEstateTitle,
    summary: (i) => [i.attributes?.sizeSqm && `${i.attributes.sizeSqm} מ"ר`, i.attributes?.floor != null && (i.attributes.floor === 0 ? 'קומת קרקע' : `קומה ${i.attributes.floor}`)].filter(Boolean),
    dealLabel: (i) => ({ SALE: 'למכירה', RENT: 'להשכרה' })[i.attributes?.dealType] || ''
  },
  services: {
    key: 'services', label: 'שירותים', item: 'שירות', itemPlural: 'שירותים', newWord: 'שירות חדש', example: 'שירות חדש: טיפול פנים 60 דקות 350 ש"ח',
    kinds: [['SERVICE', 'שירות']], defaultKind: 'SERVICE', listWords: ['השירותים שלי', 'השירותים', 'שירותים', 'רשימת השירותים'],
    fields: [
      { key: 'durationMinutes', label: 'משך בדקות', type: 'number', min: 1, max: 100000, step: 1 },
      { key: 'serviceArea', label: 'אזור שירות', type: 'text', max: 120 },
      { key: 'priceFrom', label: 'המחיר הוא "החל מ־"', type: 'boolean' }
    ],
    priceRequired: true, priceQuestion: () => 'כמה עולה השירות? (אם המחיר משתנה, כתוב "החל מ־200")', priceSuffix: () => '', pricePrefix: (i) => (i.attributes?.priceFrom ? 'החל מ־' : ''),
    closeOutcomes: [{ key: 'ENDED', status: 'ENDED', label: 'הופסק', verb: /^(?:הופסק|הסתיים|נגמר|הפסקתי(?:\s+לתת)?)$/ }],
    defaultOutcome: () => 'ENDED', angles: ['הכירו את השירות', 'למי זה מתאים', 'שאלות נפוצות'], goal: () => 'לידים של לקוחות שמתעניינים בשירות הזה',
    extract: (t) => {
      const a = {}, d = t.match(/(\d{1,4})\s*(דקות|דק['׳]|שעות|שעה)/);
      if (d) a.durationMinutes = /שע/.test(d[2]) ? Number(d[1]) * 60 : Number(d[1]);
      else if (/(?:^|\s)שעה(?:\s|$)/.test(t)) a.durationMinutes = 60;
      if (/החל מ|מחיר מ[־-]?\s*\d|מ[־-]\d/.test(t)) a.priceFrom = true;
      const area = t.match(/(?:באזור|אזור|בכל אזור)\s+([֐-׿"'׳״ ]{2,40}?)(?=$|[,.\n]|\s+\d)/) || (cityIn(t) && [null, cityIn(t)]);
      if (area) a.serviceArea = area[1].trim();
      const price = parsePrice(t.replace(/(\d{1,4})\s*(דקות|דק['׳]|שעות|שעה)/g, ' '));
      return { ...(price ? { price } : {}), attributes: a };
    },
    summary: (i) => [i.attributes?.durationMinutes && `${i.attributes.durationMinutes} דקות`, i.attributes?.serviceArea && `אזור: ${i.attributes.serviceArea}`].filter(Boolean)
  },
  retail: {
    key: 'retail', label: 'מוצרים', item: 'מוצר', itemPlural: 'מוצרים', newWord: 'מוצר חדש', example: 'מוצר חדש: שמלת קיץ כחולה 249 ש"ח',
    kinds: [['PRODUCT', 'מוצר']], defaultKind: 'PRODUCT', listWords: ['המוצרים שלי', 'המוצרים', 'מוצרים', 'רשימת המוצרים'],
    fields: [
      { key: 'sku', label: 'מק"ט', type: 'text', max: 40 },
      { key: 'stock', label: 'במלאי', type: 'number', min: 0, max: 1000000, step: 1 },
      { key: 'link', label: 'קישור למוצר', type: 'url', max: 300 }
    ],
    priceRequired: true, priceQuestion: () => 'כמה עולה המוצר?', priceSuffix: () => '', realPhotosOnly: true,
    closeOutcomes: [{ key: 'SOLD_OUT', status: 'SOLD_OUT', label: 'אזל מהמלאי', verb: /^(?:אזל|אזלה|אזל מהמלאי|נגמר המלאי|נגמר במלאי)$/ }, { key: 'ENDED', status: 'ENDED', label: 'ירד מהמכירה', verb: /^(?:ירד מהמכירה|הפסקתי למכור|לא נמכר יותר)$/ }],
    defaultOutcome: () => 'SOLD_OUT', angles: ['הכירו את המוצר', 'למי זה מתאים', 'איך משתמשים'], goal: () => 'לידים או פניות של קונים למוצר הזה',
    extract: (t) => {
      const a = {}, sku = t.match(/מק["״]ט[:\s]*([A-Za-z0-9-]{1,40})/), stock = t.match(/(?:במלאי|מלאי)[:\s]*(\d{1,6})|(\d{1,6})\s*(?:יח['׳]|יחידות)\s*במלאי/), link = t.match(/https?:\/\/\S{3,290}/);
      if (sku) a.sku = sku[1]; if (stock) a.stock = Number(stock[1] || stock[2]); if (link) a.link = link[0];
      const price = parsePrice(t.replace(/https?:\/\/\S+/g, ' ').replace(/מק["״]ט[:\s]*\S+/g, ' ').replace(/(?:במלאי|מלאי)[:\s]*\d+|\d+\s*(?:יח['׳]|יחידות)/g, ' '));
      return { ...(price ? { price } : {}), attributes: a };
    },
    summary: (i) => [i.attributes?.stock != null && `${i.attributes.stock} במלאי`, i.attributes?.sku && `מק"ט ${i.attributes.sku}`].filter(Boolean)
  },
  fitness: {
    key: 'fitness', label: 'חבילות ומנויים', item: 'חבילה', itemPlural: 'חבילות', newWord: 'חבילה חדשה', example: 'מנוי חדש: 8 אימונים בחודש 390 ש"ח',
    kinds: [['PACKAGE', 'חבילה'], ['MEMBERSHIP', 'מנוי']], defaultKind: 'PACKAGE', listWords: ['החבילות שלי', 'המנויים שלי', 'חבילות', 'מנויים'],
    fields: [
      { key: 'sessions', label: 'מספר אימונים/שיעורים', type: 'number', min: 1, max: 1000, step: 1 },
      { key: 'period', label: 'תקופה', type: 'choice', choices: [['', 'לא מוגדר'], ['MONTH', 'לחודש'], ['QUARTER', 'ל־3 חודשים'], ['YEAR', 'לשנה'], ['ONCE', 'חד פעמי']] }
    ],
    priceRequired: true, priceQuestion: () => 'כמה עולה החבילה?', priceSuffix: (i) => ({ MONTH: ' לחודש', QUARTER: ' ל־3 חודשים', YEAR: ' לשנה' })[i.attributes?.period] || '',
    closeOutcomes: [{ key: 'ENDED', status: 'ENDED', label: 'הסתיימה', verb: /^(?:הסתיים|הסתיימה|נגמר|נגמרה|הופסק|הופסקה)$/ }, { key: 'SOLD_OUT', status: 'SOLD_OUT', label: 'מלאה', verb: /^(?:מלא|מלאה|אין מקום)$/ }],
    defaultOutcome: () => 'ENDED', angles: ['הכירו את החבילה', 'למי זה מתאים', 'שאלות נפוצות'], goal: () => 'לידים של מתאמנים שמתעניינים בחבילה הזו',
    extract: (t) => {
      const a = {}, s = t.match(/(\d{1,3})\s*(?:אימונים|שיעורים|כניסות|מפגשים)/);
      if (s) a.sessions = Number(s[1]);
      if (/לחודש|חודשי|בחודש/.test(t)) a.period = 'MONTH'; else if (/(?:ל|ב)?(?:שלושה|3)\s*חודשים|רבעוני/.test(t)) a.period = 'QUARTER'; else if (/לשנה|שנתי/.test(t)) a.period = 'YEAR';
      const price = parsePrice(t.replace(/(\d{1,3})\s*(?:אימונים|שיעורים|כניסות|מפגשים)/g, ' ').replace(/\d+\s*חודשים/g, ' '));
      return { ...(price ? { price } : {}), attributes: a };
    },
    summary: (i) => [i.attributes?.sessions && `${i.attributes.sessions} אימונים`].filter(Boolean)
  },
  generic: {
    key: 'generic', label: 'מה אני מוכר', item: 'פריט', itemPlural: 'פריטים', newWord: 'פריט חדש', example: 'פריט חדש: סדנת קרמיקה 180 ש"ח',
    kinds: [['ITEM', 'פריט']], defaultKind: 'ITEM', listWords: ['מה אני מוכר', 'הפריטים שלי', 'הקטלוג שלי'],
    fields: [], priceRequired: true, priceQuestion: () => 'כמה זה עולה?', priceSuffix: () => '',
    closeOutcomes: [{ key: 'SOLD_OUT', status: 'SOLD_OUT', label: 'אזל', verb: /^(?:אזל|אזלה|נגמר המלאי)$/ }, { key: 'ENDED', status: 'ENDED', label: 'הסתיים', verb: /^(?:הסתיים|הסתיימה|הופסק)$/ }],
    defaultOutcome: () => 'ENDED', angles: ['הכירו את מה שאנחנו מציעים', 'למי זה מתאים', 'שאלות נפוצות'], goal: () => 'לידים של לקוחות שמתעניינים בזה',
    extract: (t) => { const price = parsePrice(t); return { ...(price ? { price } : {}), attributes: {} }; },
    summary: () => []
  }
};
// ---------- Funnels and deal terms (growth.js) ----------
// A funnel is who the campaign is for and what the lead form asks. The first funnel is the default.
// questions: lead-form CUSTOM questions [key, label]; leadIntent prefills the concierge's first answer.
const FUNNELS = {
  real_estate: [
    { key: 'buyers', label: 'קונים לנכס', hook: 'נכס שמתאים לך למכירה', goal: 'לידים של קונים מתאימים', when: (i) => i?.attributes?.dealType !== 'RENT', leadIntent: 'BUY', dealKind: 'SALE',
      questions: [['budget', 'מה טווח התקציב לרכישה?'], ['area', 'באיזה אזור אתם מחפשים?'], ['timing', 'מתי תרצו להיכנס לנכס?'], ['mortgage', 'יש לכם אישור עקרוני למשכנתא?']] },
    { key: 'renters', label: 'שוכרים לנכס', hook: 'דירה להשכרה שמתאימה לך', goal: 'לידים של שוכרים מתאימים', when: (i) => i?.attributes?.dealType === 'RENT', leadIntent: 'RENT', dealKind: 'RENT',
      questions: [['budget', 'מה התקציב החודשי לשכירות?'], ['area', 'באיזה אזור אתם מחפשים?'], ['timing', 'מתי תרצו להיכנס?']] },
    { key: 'sellers', label: 'מוכרי דירות — כמה שווה הדירה שלך?', hook: 'כמה שווה הדירה שלך? הערכת שווי חינם ממתווך מקומי', goal: 'לידים של בעלי דירות שחושבים למכור', standalone: true, leadIntent: 'SELL', dealKind: 'SALE',
      questions: [['address', 'איפה הנכס? עיר ורחוב'], ['rooms', 'כמה חדרים?'], ['timing', 'מתי אתם חושבים למכור?']] },
    { key: 'landlords', label: 'משכירי דירות', hook: 'רוצה להשכיר את הדירה בלי כאב ראש? נמצא לך שוכר מתאים', goal: 'לידים של בעלי דירות שרוצים להשכיר', standalone: true, leadIntent: 'SELL', dealKind: 'RENT',
      questions: [['address', 'איפה הנכס? עיר ורחוב'], ['rooms', 'כמה חדרים?'], ['available', 'מתי הדירה מתפנה?']] }
  ],
  services: [
    { key: 'quote', label: 'הצעת מחיר', hook: 'קבלו הצעת מחיר בלי התחייבות', goal: 'לידים שמבקשים הצעת מחיר', questions: [['need', 'במה אפשר לעזור?'], ['area', 'באיזו עיר?'], ['timing', 'מתי זה צריך לקרות?']] },
    { key: 'urgent', label: 'עבודה דחופה', hook: 'צריכים מישהו עוד היום? אנחנו זמינים', goal: 'לידים של עבודות דחופות', standalone: true, questions: [['need', 'מה קרה? בקצרה'], ['area', 'באיזו עיר?']] }
  ],
  retail: [
    { key: 'purchase', label: 'קונים למוצר', hook: 'המוצר שחיפשת, עכשיו אצלנו', goal: 'לידים של קונים למוצר', when: (i) => i?.status !== 'SOLD_OUT', questions: [['product', 'איזה מוצר מעניין אתכם?'], ['delivery', 'משלוח או איסוף עצמי?']] },
    { key: 'back_in_stock', label: 'חזר למלאי', hook: 'חזר למלאי! השאירו פרטים ונשמור לכם', goal: 'לידים של מי שחיכה למוצר שחזר', when: (i) => i?.status === 'SOLD_OUT', questions: [['product', 'איזה מוצר שמור לכם?'], ['quantity', 'כמה יחידות?']] }
  ],
  fitness: [
    { key: 'trial', label: 'אימון ניסיון', hook: 'אימון ניסיון ראשון עלינו', goal: 'לידים שרוצים לבוא לאימון ניסיון', questions: [['goal', 'מה המטרה העיקרית?'], ['slot_pref', 'איזו שעה ביום הכי נוחה?']] }
  ],
  generic: [
    { key: 'inquiry', label: 'פנייה', hook: 'רוצים לשמוע עוד? השאירו פרטים', goal: 'לידים של לקוחות שמתעניינים', questions: [['need', 'במה אפשר לעזור?'], ['timing', 'מתי זה רלוונטי?']] }
  ]
};
// How a closed deal is measured, in the business's own words. commission: the business earns a % of the price.
const DEALS = {
  real_estate: { commission: true, priceQuestion: (kind) => (kind === 'RENT' ? 'מה שכר הדירה החודשי בעסקה?' : 'מה מחיר העסקה?'), revenueLabel: 'עמלה' },
  services: { priceQuestion: () => 'כמה עלתה העבודה?', revenueLabel: 'מחיר העבודה' },
  retail: { priceQuestion: () => 'מה סכום ההזמנה?', revenueLabel: 'סכום ההזמנה' },
  fitness: { priceQuestion: () => 'כמה שילם על החבילה או המנוי?', revenueLabel: 'מחיר החבילה' },
  generic: { priceQuestion: () => 'מה סכום העסקה?', revenueLabel: 'סכום העסקה' }
};
// When a past customer is worth a reminder, and what to say (to the owner and to the customer).
const WINBACK = {
  real_estate: { days: 330, owner: 'עברה כמעט שנה מהעסקה', customer: 'עברה כמעט שנה מאז העסקה שעשינו יחד 🙂 אם אתם או מישהו שאתם מכירים חושבים על מעבר, מכירה או השכרה, נשמח לעזור.' },
  services: { days: 180, owner: 'עברו חצי שנה מהעבודה', customer: 'עברו כמה חודשים מאז שעבדנו יחד. אם צריך בדיקה, טיפול חוזר או משהו חדש, נשמח לעזור.' },
  retail: { days: 60, owner: 'עברו חודשיים מהקנייה', customer: 'הגיעו אלינו דברים חדשים שאולי יתאימו לכם. רוצים שנשלח פרטים?' },
  fitness: { days: 45, owner: 'עברו 6 שבועות', customer: 'מתגעגעים אליכם באימונים 💪 רוצים לחזור? נשמח לשמור לכם מקום.' },
  generic: { days: 90, owner: 'עברו 3 חודשים', customer: 'עבר קצת זמן מאז שעבדנו יחד. אם אפשר לעזור במשהו, נשמח.' }
};
for (const [k, p] of Object.entries(PROFILES)) { p.funnels = FUNNELS[k]; p.deal = DEALS[k]; p.winback = WINBACK[k]; }

const KEYS = Object.keys(PROFILES);
const CHOICES = [['real_estate', 'תיווך נדל"ן'], ['services', 'נותן שירות'], ['retail', 'חנות / מוצרים'], ['fitness', 'כושר / סטודיו'], ['generic', 'משהו אחר']];
// Generic "new item" words; a word that names a vertical is a hint when the business type is unknown.
const NEW_GENERIC = /^(?:(?:שירות|מוצר|פריט|חבילה|מנוי|טיפול|סדנה|קורס)\s+(?:חדש|חדשה)|(?:הוסף|להוסיף|תוסיף|תוסיפי|אני רוצה להוסיף)\s+(?:שירות|מוצר|פריט|חבילה|מנוי)(?:\s+חדש(?:ה)?)?)\s*(?:[:：\-–]\s*|\s+|$)/;
const HINT = [[RE_NEW, 'real_estate'], [/^(?:שירות|טיפול|סדנה|קורס)|(?:הוסף|להוסיף|תוסיף|אני רוצה להוסיף)\s+שירות/, 'services'], [/^מוצר|(?:הוסף|להוסיף|תוסיף|אני רוצה להוסיף)\s+מוצר/, 'retail'], [/^(?:חבילה|מנוי)|(?:הוסף|להוסיף|תוסיף|אני רוצה להוסיף)\s+(?:חבילה|מנוי)/, 'fitness']];

for (const p of Object.values(PROFILES)) {
  p.newPattern = p.newPattern || NEW_GENERIC;
  p.title = p.title || ((i) => i.title || p.item);
  p.dealLabel = p.dealLabel || (() => '');
  p.pricePrefix = p.pricePrefix || (() => '');
  p.consentRequired = !!p.consentRequired;
  p.realPhotosOnly = !!p.realPhotosOnly;
  p.housingCategory = !!p.housingCategory;
}

function get(key) { return PROFILES[key] || PROFILES.generic; }
function priceText(profile, item) { return item.price ? `${profile.pricePrefix(item)}${money(item.price)} ₪${profile.priceSuffix(item)}` : ''; }
const fieldRequired = (f, item) => (typeof f.required === 'function' ? f.required(item) : !!f.required);

// Infers the vertical from the business card the agent already holds.
function infer(text) {
  const t = String(text || '');
  if (/נדל["״]?ן|תיווך|מתווך|מתווכת|נכסים|דירות|השכרת דירות/.test(t)) return 'real_estate';
  if (/חדר כושר|סטודיו ל|סטודיו|פילאטיס|יוגה|אימונים|מאמן כושר|מאמנת כושר|קרוספיט|ספינינג|אומנויות לחימה/.test(t)) return 'fitness';
  if (/חנות|אונליין|מוצרים|בגדים|תכשיטים|נעליים|קוסמטיקה למכירה|מכירת|ספרים|צעצועים|רהיטים|חנות אינטרנט/.test(t)) return 'retail';
  if (/מספרה|קוסמטיקאית|טיפול|טיפולים|ציפורניים|רופא|מרפאה|קליניקה|עורך דין|עורכת דין|רואה חשבון|יועץ|יועצת|שיפוצים|אינסטלטור|חשמלאי|מוסך|הדברה|ניקיון|צלם|צלמת|מעצב|מעצבת|שיעורים פרטיים|מורה|מטפל|מטפלת|פסיכולוג|דיאטנית|שירות|שירותים/.test(t)) return 'services';
  return null;
}
async function detect(clientId) {
  try {
    const p = await require('./marketingStore').load(clientId);
    if (p?.businessVertical && PROFILES[p.businessVertical]) return { key: p.businessVertical, known: true };
    const facts = p ? require('./conversationFacts').all(p) : {};
    const key = infer([facts.businessType, facts.product, facts.businessName].filter(Boolean).join(' '));
    return key ? { key, known: true, inferred: true } : { key: 'generic', known: false };
  } catch (error) {
    logger.warn('Vertical detection fell back', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'DETECT_FAILED' });
    return { key: 'generic', known: false };
  }
}
async function choose(clientId, key) {
  if (!PROFILES[key]) throw Error('INVALID_VERTICAL');
  await require('./marketingStore').update(clientId, null, (p) => { if (p.businessVertical === key) return { handled: false }; p.businessVertical = key; return { handled: false, changed: true }; });
  return get(key);
}
// What the dashboard needs to draw the catalog form for this business.
function describe(key, known = true) {
  const p = get(key);
  return {
    key: p.key, known, label: known ? p.label : 'מה אני מוכר', item: p.item, itemPlural: p.itemPlural, example: p.example,
    kinds: p.kinds, computedTitle: !!p.computedTitle, consentRequired: p.consentRequired, consentLabel: p.consentLabel || null,
    license: p.license ? { key: p.license.key, label: p.license.label } : null,
    fields: p.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, choices: f.choices || null, step: f.step || null, min: f.min ?? null, max: f.max ?? null, required: typeof f.required === 'function' ? 'conditional' : !!f.required })),
    closeOutcomes: p.closeOutcomes.map((o) => ({ key: o.key, label: o.label })), choices: CHOICES
  };
}
async function summary(clientId) { const d = await detect(clientId); return describe(d.key, d.known); }

module.exports = { PROFILES, KEYS, CHOICES, NEW_GENERIC, HINT, WITH_ROOMS, CITIES, get, infer, detect, choose, describe, summary, parsePrice, parseNumber, priceText, fieldRequired, nameFrom, money };
