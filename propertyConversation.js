'use strict';
// WhatsApp conversation for properties (נכסים): the broker sends photos and/or a
// short description, the agent fills in the fields, asks only for what is missing
// (with buttons), asks for the property owner's consent and shows the property card
// to confirm. Then it offers a lead campaign and organic posts for the property.
// Commands: "הנכסים שלי", "נכס נמכר" / "נכס הושכר" (by name or by buttons).
const db = require('./db');
const props = require('./properties');
const { logger } = require('./logger');

const TTL = 6 * 60 * 60 * 1000;
const NEW = /^(?:(?:נכס|דירה|דירת\s+\S+|בית|בית פרטי|פנטהאו[זס]|דופלקס|קוטג['׳]|וילה|משרד|חנות|מגרש)\s+(?:חדש|חדשה)(?:\s+(?:למכירה|להשכרה))?|(?:הוסף|להוסיף|תוסיף|תוסיפי|אני רוצה להוסיף)\s+(?:נכס|דירה)(?:\s+חדש(?:ה)?)?|נכס\s+(?:חדש\s+)?(?:למכירה|להשכרה))\s*(?:[:：\-–]\s*|\s+|$)/;
const LIST = /^(?:הנכסים שלי|הנכסים|נכסים|רשימת (?:ה)?נכסים|תראה לי את הנכסים|מה הנכסים שלי)\??$/;
const CLOSE = /^(?:(?:ה)?(?:נכס|דירה)\s+)?(?:(.{2,40}?)\s+)?(נמכר|נמכרה|הושכר|הושכרה)(?:\s+(.{2,40}))?[.! ]*$/;
const CONSENT = /^(?:יש הסכמה|יש הסכמה (?:של|מ)בעל(?:ת)? הנכס|בעל(?:ת)? הנכס הסכים|בעלת הנכס הסכימה|קיבלתי הסכמה)[.! ]*$/;
const CANCEL = /^(?:בטל|ביטול|בטל נכס|עזוב|לא משנה)[.! ]*$/;
const CMD = /^\/property-(deal|rooms|consent|confirm|fix|cancel|campaign|posts|sold|open|later)(?:\s+([0-9a-f-]{36}))?(?:\s+(\S+))?$/i;

const choice = (title, text) => ({ title, text });
// WhatsApp limits: 20 characters on a button (up to 3 choices), 24 on a list row.
const fit = (items) => items.map((c) => ({ ...c, title: c.title.slice(0, items.length <= 3 ? 20 : 24) }));
const clientByPhone = async (phone) => (await db.query('SELECT id FROM clients WHERE phone=$1', [String(phone)])).rows[0]?.id || null;
const ui = (clientId, body, items) => require('./conversationUi').prepareChoices(clientId, body.slice(0, 1024), fit(items), 'property');
const plain = (text) => ({ text });

async function intake(clientId) {
  const p = await require('./marketingStore').load(clientId);
  const x = p?.propertyIntake;
  return x && x.expiresAt > Date.now() ? x : null;
}
async function setIntake(clientId, value) {
  await require('./marketingStore').update(clientId, null, (p) => {
    if (value) p.propertyIntake = { ...value, expiresAt: Date.now() + TTL };
    else if (p.propertyIntake) delete p.propertyIntake;
    else return { handled: false };
    return { handled: false, changed: true };
  });
}
const photoCount = async (clientId, id) => (await props.photoIds(clientId, id)).length;

// Asks the next missing thing, or the consent, or shows the card to confirm.
async function next(clientId, id, prefix = '') {
  const p = await props.get(clientId, id);
  const need = props.missing(p);
  const lead = prefix ? prefix + '\n\n' : '';
  if (need[0] === 'deal') { await setIntake(clientId, { id, awaiting: 'deal' }); return ui(clientId, `${lead}הנכס למכירה או להשכרה?`, [choice('למכירה', `/property-deal ${id} SALE`), choice('להשכרה', `/property-deal ${id} RENT`)]); }
  if (need[0] === 'city') { await setIntake(clientId, { id, awaiting: 'city' }); return plain(`${lead}באיזו עיר הנכס? אפשר להוסיף גם שכונה או רחוב.`); }
  if (need[0] === 'price') { await setIntake(clientId, { id, awaiting: 'price' }); return plain(`${lead}${p.deal_type === 'RENT' ? 'מה שכר הדירה לחודש?' : 'מה המחיר המבוקש?'} (למשל ${p.deal_type === 'RENT' ? '6,500' : '2.9 מיליון'})`); }
  if (need[0] === 'rooms') {
    await setIntake(clientId, { id, awaiting: 'rooms' });
    return ui(clientId, `${lead}כמה חדרים?`, ['2', '2.5', '3', '3.5', '4', '4.5', '5', '6'].map((r) => choice(`${r} חדרים`, `/property-rooms ${id} ${r}`)));
  }
  if (need[0] === 'license') { await setIntake(clientId, { id, awaiting: 'license' }); return plain(`${lead}מה מספר רישיון התיווך שלך? הוא חייב להופיע בכל מודעה. אשמור אותו גם לנכסים הבאים.`); }
  if (!p.owner_consent) {
    await setIntake(clientId, { id, awaiting: 'consent' });
    return ui(clientId, `${lead}בעל הנכס הסכים שנפרסם את הנכס? בלי הסכמה שלו לא מפרסמים.`, [choice('כן, יש הסכמה', `/property-consent ${id} yes`), choice('עוד לא', `/property-consent ${id} no`)]);
  }
  await setIntake(clientId, { id, awaiting: 'confirm' });
  return ui(clientId, `${lead}הנה הנכס:\n\n${props.card(p, { photos: await photoCount(clientId, id) })}\n\nהכול נכון?`, [choice('הנכס נכון', `/property-confirm ${id}`), choice('לתקן פרט', `/property-fix ${id}`), choice('לבטל', `/property-cancel ${id}`)]);
}

async function start(clientId, text, photoInput = null) {
  const fields = text ? await props.extract(text) : {};
  const property = await props.create(clientId, { ...fields, description: text ? String(text).replace(NEW, '').trim().slice(0, 2000) : '' });
  let note = '';
  if (photoInput) { try { await props.addPhoto(clientId, property.id, photoInput); note = '📸 התמונה נשמרה. אפשר לשלוח עוד תמונות של הנכס.'; } catch (error) { note = error.message === 'INVALID_PHOTO' ? 'לא הצלחתי לשמור את התמונה. אפשר לשלוח אותה שוב.' : ''; } }
  if (!text) { await setIntake(clientId, { id: property.id, awaiting: 'describe' }); return plain(`${note ? note + '\n\n' : ''}🏠 נכס חדש. תכתוב לי בהודעה אחת מה יש בו, למשל: "4 חדרים בגבעתיים, 2.9 מיליון, קומה 3, מעלית וחניה". אפשר לשלוח גם תמונות.`); }
  return next(clientId, property.id, ['🏠 קיבלתי, רשמתי את הנכס.', note].filter(Boolean).join('\n'));
}

// A typed answer to the question we asked. Returns null when it is not an answer.
async function answer(clientId, x, t) {
  const p = await props.get(clientId, x.id).catch(() => null);
  if (!p) { await setIntake(clientId, null); return null; }
  const found = props.localExtract(t), patch = {};
  if (x.awaiting === 'consent') {
    if (/^(?:כן|יש|הסכים|הסכימה|יש הסכמה)\b/.test(t)) return command(clientId, [null, 'consent', p.id, 'yes']);
    if (/^(?:לא|עוד לא|אין)\b/.test(t)) return command(clientId, [null, 'consent', p.id, 'no']);
    return null;
  }
  if (x.awaiting === 'deal') {
    const deal = /השכר|שכירות/.test(t) ? 'RENT' : /מכיר/.test(t) ? 'SALE' : null;
    if (!deal) return null;
    patch.dealType = deal;
  } else if (x.awaiting === 'city') {
    if (!found.city) {
      const c = t.replace(/^(?:ב|זה ב|הנכס ב|העיר\s+)/, '').trim();
      if (c.length < 2 || c.length > 40 || /\d{3,}|[?/]/.test(c)) return null;
      patch.city = c;
    }
  } else if (x.awaiting === 'price') {
    const n = props.parsePrice(t) || (/^\s*[\d,.]+\s*$/.test(t) ? Number(t.replace(/[,\s]/g, '')) : null);
    if (!n || n < 100) return t.length > 40 ? null : plain('לא הבנתי את המחיר. אפשר לכתוב למשל "2.9 מיליון" או "6,500".');
    patch.price = n;
  } else if (x.awaiting === 'rooms') {
    const n = found.rooms || (/^\s*\d{1,2}(?:[.,]5)?\s*$/.test(t) ? Number(t.replace(',', '.')) : null);
    if (!n) return t.length > 40 ? null : plain('כמה חדרים יש בנכס? אפשר לבחור מהכפתורים או לכתוב מספר.');
    patch.rooms = n;
  } else if (x.awaiting === 'license') {
    const m = t.match(/^\D{0,30}?(\d{3,10})\D{0,10}$/);
    if (!m) return t.length > 40 ? null : plain('מספר רישיון התיווך הוא מספר (למשל 314159). מה המספר שלך?');
    patch.licenseNumber = m[1];
  } else if (['describe', 'confirm', 'fix'].includes(x.awaiting)) {
    const more = await props.extract(t);
    if (!Object.keys(more).length) return x.awaiting === 'describe' && t.length >= 4 ? (await props.update(clientId, p.id, { description: t }), next(clientId, p.id, 'שמרתי את התיאור.')) : x.awaiting === 'fix' && t.length <= 60 ? plain('מה לשנות? למשל "מחיר 2.8 מיליון", "קומה 4" או "120 מ"ר".') : null;
    Object.assign(patch, more);
    if (x.awaiting === 'describe' && !p.description) patch.description = t;
  } else return null;
  for (const k of ['dealType', 'kind', 'rooms', 'sizeSqm', 'floor', 'neighbourhood', 'address', 'features']) if (patch[k] === undefined && found[k] !== undefined && (p[{ dealType: 'deal_type', kind: 'property_kind', sizeSqm: 'size_sqm' }[k] || k] == null || ['confirm', 'fix'].includes(x.awaiting))) patch[k] = found[k];
  if (patch.features && p.features?.length) patch.features = [...new Set([...p.features, ...patch.features])];
  try { await props.update(clientId, p.id, patch); }
  catch (error) { if (error.message === 'INVALID_LICENSE') return plain('מספר הרישיון לא נראה תקין. כתוב רק את המספר.'); return plain('אחד הפרטים לא נראה תקין. אפשר לכתוב אותו שוב?'); }
  return next(clientId, p.id, x.awaiting === 'fix' || x.awaiting === 'confirm' ? 'עדכנתי.' : '');
}

async function afterConfirm(clientId, id) {
  let p;
  try { p = await props.activate(clientId, id); }
  catch (error) {
    if (error.message === 'PROPERTY_CONSENT_REQUIRED' || error.message === 'PROPERTY_INCOMPLETE') return next(clientId, id);
    throw error;
  }
  await setIntake(clientId, null);
  return ui(clientId, `✅ הנכס ${props.title(p)} נשמר ומשווק.\n\nמה להכין לו?\n• קמפיין לידים ב־Meta (טיוטה לבדיקה שלך)\n• פוסטים לרשתות עם התמונות של הנכס\n\nבכל מודעה ופוסט יופיע רישיון התיווך ${p.license_number}.`, [choice('קמפיין לידים', `/property-campaign ${id}`), choice('פוסטים לנכס', `/property-posts ${id}`), choice('אחר כך', '/property-later')]);
}

async function open(clientId, id) {
  const p = await props.get(clientId, id);
  const items = [];
  if (p.status === 'ACTIVE') items.push(choice('קמפיין לידים', `/property-campaign ${id}`), choice('פוסטים לנכס', `/property-posts ${id}`));
  if (['ACTIVE', 'PAUSED', 'DRAFT'].includes(p.status) && p.owner_consent) items.push(choice(p.deal_type === 'RENT' ? 'הושכר' : 'נמכר', `/property-sold ${id} ${p.deal_type === 'RENT' ? 'RENTED' : 'SOLD'}`));
  const body = `${props.card(p, { photos: await photoCount(clientId, id) })}\nמצב: ${props.STATUS_LABEL[p.status]}`;
  if (p.status === 'DRAFT') return next(clientId, id, body);
  return items.length ? ui(clientId, body, items.slice(0, 3)) : plain(body);
}

async function listReply(clientId) {
  const all = (await props.list(clientId)).slice(0, 10);
  if (!all.length) return plain('עוד אין נכסים. שלח לי תמונות ותיאור קצר, למשל "דירה חדשה: 4 חדרים בגבעתיים 2.9 מיליון", ואכין את הנכס.');
  const lines = all.map((p, i) => `${i + 1}. ${props.title(p)} · ${props.priceText(p) || 'בלי מחיר'} · ${props.STATUS_LABEL[p.status]} · ${p.leads} לידים`);
  const body = `🏠 הנכסים שלך:\n${lines.join('\n')}\n\n${require('./dashboardLink').hint('properties')}`;
  return ui(clientId, body, all.map((p, i) => choice(`${i + 1}. ${props.title(p)}`.slice(0, 24), `/property-open ${p.id}`)));
}

async function closeReply(clientId, id, outcome) {
  const r = await props.close(clientId, id, outcome);
  if (!r.approval) return plain(r.reply);
  return require('./conversationUi').prepareApproval(clientId, r.approval, r.reply + '\n\n' + require('./actionPlan').formatActionPlan(r.approval.actionPlan));
}

async function command(clientId, [, name, id, arg]) {
  name = name.toLowerCase();
  if (name === 'later') { await setIntake(clientId, null); return plain('בסדר. כשתרצה, כתוב "הנכסים שלי" ובחר את הנכס.'); }
  if (!id) return plain('הבחירה הזו כבר לא עדכנית. כתוב "הנכסים שלי" כדי לבחור נכס.');
  let p;
  try { p = await props.get(clientId, id); } catch { return plain('לא מצאתי את הנכס הזה. כתוב "הנכסים שלי" כדי לבחור מהרשימה.'); }
  if (name === 'deal' && ['SALE', 'RENT'].includes(arg)) { await props.update(clientId, id, { dealType: arg }); return next(clientId, id); }
  if (name === 'rooms') { try { await props.update(clientId, id, { rooms: Number(arg) }); } catch { return plain('מספר החדרים לא תקין.'); } return next(clientId, id); }
  if (name === 'consent') {
    if (arg === 'yes') { await props.setConsent(clientId, id, true); return next(clientId, id, '✅ רשמתי את הסכמת בעל הנכס להיום.'); }
    await setIntake(clientId, null);
    return plain(`שמרתי את הנכס כטיוטה:\n\n${props.card(p, { photos: await photoCount(clientId, id) })}\n\nבלי הסכמה של בעל הנכס לא אפרסם אותו. כשתהיה הסכמה כתוב "יש הסכמה" ואמשיך משם.`);
  }
  if (name === 'confirm') return afterConfirm(clientId, id);
  if (name === 'fix') { await setIntake(clientId, { id, awaiting: 'fix' }); return plain('מה לתקן? כתוב למשל "מחיר 2.8 מיליון", "קומה 4", "120 מ"ר" או "רחוב הרצל 5".'); }
  if (name === 'cancel') {
    await setIntake(clientId, null);
    if (p.status === 'DRAFT') { await props.remove(clientId, id); return plain('ביטלתי את הנכס. אפשר להתחיל מחדש מתי שתרצה.'); }
    return plain('בסדר, לא שיניתי כלום בנכס.');
  }
  if (name === 'open') return open(clientId, id);
  if (name === 'campaign') {
    const r = await props.prepareCampaign(clientId, id);
    if (r.blocked) return plain(r.reply);
    return { task: r };
  }
  if (name === 'posts') return plain((await props.preparePosts(clientId, id)).reply);
  if (name === 'sold' && ['SOLD', 'RENTED'].includes(arg)) return closeReply(clientId, id, arg);
  return null;
}

// Text entry point (also the button choices). Returns null when it is not about properties.
async function handleClient(clientId, text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const cmd = t.match(CMD);
  if (cmd) return command(clientId, cmd);
  if (LIST.test(t)) return listReply(clientId);
  if (NEW.test(t)) { const rest = t.replace(NEW, '').trim(); await setIntake(clientId, null); return start(clientId, rest ? t : ''); }
  const x = await intake(clientId);
  if (x && CANCEL.test(t)) {
    await setIntake(clientId, null);
    const p = await props.get(clientId, x.id).catch(() => null);
    if (p?.status === 'DRAFT' && !p.owner_consent && x.awaiting !== 'confirm') await props.remove(clientId, x.id);
    return plain('בסדר, עצרתי את הוספת הנכס.');
  }
  if (CONSENT.test(t)) {
    const waiting = (await props.list(clientId, { statuses: ['DRAFT', 'PAUSED'] })).filter((p) => !p.owner_consent);
    if (!waiting.length) return null;
    if (waiting.length > 1) return ui(clientId, 'לאיזה נכס יש הסכמה?', waiting.slice(0, 10).map((p, i) => choice(`${i + 1}. ${props.title(p)}`.slice(0, 24), `/property-consent ${p.id} yes`)));
    await props.setConsent(clientId, waiting[0].id, true);
    return next(clientId, waiting[0].id, '✅ רשמתי את הסכמת בעל הנכס להיום.');
  }
  const closing = t.length <= 60 && t.match(CLOSE);
  if (closing) {
    const open = await props.list(clientId, { statuses: ['ACTIVE', 'PAUSED', 'DRAFT'] });
    if (!open.length) return null;
    const outcome = /הושכר/.test(closing[2]) ? 'RENTED' : 'SOLD', name = closing[1] || closing[3] || '';
    const matches = name ? await props.find(clientId, name) : open;
    if (matches.length === 1 && name) return closeReply(clientId, matches[0].id, outcome);
    const pickFrom = matches.length ? matches : open;
    return ui(clientId, `איזה נכס ${outcome === 'RENTED' ? 'הושכר' : 'נמכר'}?`, pickFrom.slice(0, 10).map((p, i) => choice(`${i + 1}. ${props.title(p)}`.slice(0, 24), `/property-sold ${p.id} ${outcome}`)));
  }
  if (x && !t.startsWith('/')) return answer(clientId, x, t);
  return null;
}

async function handleText(from, text) {
  if (!db.configured()) return null;
  const t = String(text || '').trim();
  if (!CMD.test(t) && !LIST.test(t) && !NEW.test(t) && !CONSENT.test(t) && !CLOSE.test(t) && !CANCEL.test(t) && t.length > 400) return null;
  const clientId = await clientByPhone(from);
  if (!clientId) return null;
  try {
    return await require('./metaConnection').context.run(String(clientId), async () => {
      const r = await handleClient(clientId, t);
      return r && { ...r, clientId };
    });
  } catch (error) {
    logger.warn('Property conversation failed', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'PROPERTY_FAILED' });
    return { clientId, text: 'משהו לא עבד בשמירת הנכס. אפשר לנסות שוב, או לפתוח את מסך הנכסים בדשבורד.' };
  }
}

// A photo from WhatsApp: joins the property being added, or starts one when the
// caption describes a property. Plain photos with no property context are left alone.
async function handlePhoto(clientId, media) {
  if (!db.configured() || media?.type !== 'image') return null;
  const caption = String(media.caption || '').trim();
  const photoInput = { buffer: media.buffer, mimeType: media.mimeType, mediaId: media.mediaId };
  return require('./metaConnection').context.run(String(clientId), async () => {
    try {
      const x = await intake(clientId);
      if (x) {
        let count;
        try { count = (await props.addPhoto(clientId, x.id, photoInput)).count; }
        catch (error) { return plain(error.message === 'TOO_MANY_PHOTOS' ? `אפשר לשמור עד ${props.MAX_PHOTOS} תמונות לנכס. התמונה הזו לא נשמרה.` : 'לא הצלחתי לשמור את התמונה. אפשר לשלוח אותה שוב.'); }
        if (caption) return answer(clientId, { ...x, awaiting: ['describe', 'confirm'].includes(x.awaiting) ? x.awaiting : 'fix' }, caption).then((r) => r || next(clientId, x.id, `📸 נשמרה תמונה ${count} לנכס.`));
        return count === 1 || x.awaiting === 'describe' ? next(clientId, x.id, `📸 נשמרה תמונה ${count} לנכס.`) : plain(`📸 נשמרה תמונה ${count} לנכס.`);
      }
      const fields = caption ? props.localExtract(caption) : {};
      const looksLikeProperty = NEW.test(caption) || (fields.price && (fields.rooms || fields.city));
      if (!looksLikeProperty) return null;
      return start(clientId, caption, photoInput);
    } catch (error) {
      logger.warn('Property photo not handled', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'PROPERTY_PHOTO_FAILED' });
      return null;
    }
  });
}

module.exports = { handleText, handleClient, handlePhoto, NEW, LIST, CLOSE };
