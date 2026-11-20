'use strict';
// WhatsApp conversation for "what I sell" (מה אני מוכר): the owner sends photos and/or
// a short description, the agent fills in the fields of the business's vertical, asks
// only for what the profile marks required (with buttons where it can), asks for the
// owner's consent where the vertical needs it (real estate), shows the card to confirm,
// and offers a lead campaign and organic posts for the item.
// Commands: "הנכסים שלי" / "השירותים שלי" / "המוצרים שלי" / "מה אני מוכר",
// "נכס נמכר", "מוצר אזל", "שירות הופסק" ... (by name or by buttons).
const db = require('./db');
const catalog = require('./catalog');
const V = require('./verticalProfiles');
const { logger } = require('./logger');

const TTL = 6 * 60 * 60 * 1000;
const isNew = (t) => Object.values(V.PROFILES).some((p) => p.newPattern.test(t)) || V.NEW_GENERIC.test(t);
const stripNew = (t) => { for (const p of [...Object.values(V.PROFILES).map((x) => x.newPattern), V.NEW_GENERIC]) if (p.test(t)) return t.replace(p, '').trim(); return t; };
const LIST = new RegExp('^(?:' + [...new Set(Object.values(V.PROFILES).flatMap((p) => p.listWords))].join('|') + '|תראה לי את (?:ה)?(?:נכסים|מוצרים|שירותים|חבילות))\\??$');
const VERBS = 'נמכר|נמכרה|הושכר|הושכרה|אזל מהמלאי|נגמר המלאי|אזל|אזלה|הסתיים|הסתיימה|הופסק|הופסקה|ירד מהמכירה';
const CLOSE = new RegExp(`^(?:(?:ה)?(?:נכס|דירה|מוצר|שירות|חבילה|מנוי|פריט)\\s+)?(?:(.{2,40}?)\\s+)?(${VERBS})(?:\\s+(.{2,40}))?[.! ]*$`);
const CONSENT = /^(?:יש הסכמה|יש הסכמה (?:של|מ)בעל(?:ת)? הנכס|בעל(?:ת)? הנכס הסכים|בעלת הנכס הסכימה|קיבלתי הסכמה)[.! ]*$/;
const CANCEL = /^(?:בטל|ביטול|בטל נכס|בטל מוצר|בטל שירות|עזוב|לא משנה)[.! ]*$/;
const CMD = /^\/catalog-(vertical|set|consent|confirm|fix|cancel|campaign|posts|close|open|later)(?:\s+([0-9a-f-]{36}|[a-z_]{3,20}))?(?:\s+(\S+))?(?:\s+(\S+))?$/i;

const choice = (title, text) => ({ title, text });
// WhatsApp limits: 20 characters on a button (up to 3 choices), 24 on a list row.
const fit = (items) => items.map((c) => ({ ...c, title: c.title.slice(0, items.length <= 3 ? 20 : 24) }));
const ui = (clientId, body, items) => require('./conversationUi').prepareChoices(clientId, body.slice(0, 1024), fit(items), 'catalog');
const plain = (text) => ({ text });
const clientByPhone = async (phone) => (await db.query('SELECT id FROM clients WHERE phone=$1', [String(phone)])).rows[0]?.id || null;
const profileOf = (item) => V.get(item.vertical);

async function intake(clientId) {
  const p = await require('./marketingStore').load(clientId);
  const x = p?.catalogIntake;
  return x && x.expiresAt > Date.now() ? x : null;
}
async function setIntake(clientId, value) {
  await require('./marketingStore').update(clientId, null, (p) => {
    if (value) p.catalogIntake = { ...value, expiresAt: Date.now() + TTL };
    else if (p.catalogIntake) delete p.catalogIntake;
    else return { handled: false };
    return { handled: false, changed: true };
  });
}
const photoCount = async (clientId, id) => (await catalog.photoIds(clientId, id)).length;

// Asks the next missing thing, the consent where needed, or shows the card to confirm.
async function next(clientId, id, prefix = '') {
  const item = await catalog.get(clientId, id), profile = profileOf(item);
  const need = catalog.missing(item)[0], lead = prefix ? prefix + '\n\n' : '';
  if (need === 'title') { await setIntake(clientId, { id, awaiting: 'title' }); return plain(`${lead}מה שם ה${profile.item}? (למשל: ${V.nameFrom(profile.example, profile.newPattern) || profile.item})`); }
  if (need === 'price') { await setIntake(clientId, { id, awaiting: 'price' }); return plain(lead + profile.priceQuestion(item)); }
  if (need === 'license') { await setIntake(clientId, { id, awaiting: 'license' }); return plain(lead + profile.license.question); }
  if (need) {
    const f = profile.fields.find((x) => x.key === need);
    await setIntake(clientId, { id, awaiting: need });
    const options = f.buttons || (f.type === 'choice' ? f.choices.filter(([k]) => k) : null);
    if (options) return ui(clientId, lead + (f.question || `${f.label}?`), options.map(([v, label]) => choice(label, `/catalog-set ${id} ${f.key} ${v}`)));
    return plain(lead + (f.question || `${f.label}?`));
  }
  if (item.consent_required && !item.owner_consent) {
    await setIntake(clientId, { id, awaiting: 'consent' });
    return ui(clientId, lead + (profile.consentQuestion || 'יש הסכמה לפרסום?'), [choice('כן, יש הסכמה', `/catalog-consent ${id} yes`), choice('עוד לא', `/catalog-consent ${id} no`)]);
  }
  await setIntake(clientId, { id, awaiting: 'confirm' });
  return ui(clientId, `${lead}הנה ה${profile.item}:\n\n${catalog.card(item, { photos: await photoCount(clientId, id) })}\n\nהכול נכון?`, [choice('הפרטים נכונים', `/catalog-confirm ${id}`), choice('לתקן פרט', `/catalog-fix ${id}`), choice('לבטל', `/catalog-cancel ${id}`)]);
}

// Which vertical a new item belongs to: the business's (known/inferred), a hint in the words, or a question.
async function verticalFor(clientId, text) {
  const d = await V.detect(clientId);
  if (d.known) return d.key;
  const hint = V.HINT.find(([re]) => re.test(text));
  if (hint) { await V.choose(clientId, hint[1]); return hint[1]; }
  return null;
}
async function askVertical(clientId, pendingText) {
  await setIntake(clientId, { awaiting: 'vertical', pendingText: String(pendingText || '').slice(0, 2000) });
  return ui(clientId, 'כדי לשאול רק את מה שצריך: מה העסק מוכר?', V.CHOICES.map(([k, label]) => choice(label, `/catalog-vertical ${k}`)));
}

async function start(clientId, text, photoInput = null) {
  const key = await verticalFor(clientId, text || '');
  if (!key) {
    if (photoInput) return null; // a photo alone never asks: the existing media flow handles it
    return askVertical(clientId, text);
  }
  const profile = V.get(key);
  const fields = text ? await catalog.extract(profile, text) : { attributes: {} };
  const description = text ? stripNew(text).slice(0, 2000) : '';
  const item = await catalog.create(clientId, { ...fields, description }, { vertical: key });
  let note = '';
  if (photoInput) { try { await catalog.addPhoto(clientId, item.id, photoInput); note = '📸 התמונה נשמרה. אפשר לשלוח עוד תמונות.'; } catch (error) { note = error.message === 'INVALID_PHOTO' ? 'לא הצלחתי לשמור את התמונה. אפשר לשלוח אותה שוב.' : ''; } }
  if (!stripNew(text || '')) { await setIntake(clientId, { id: item.id, awaiting: 'describe' }); return plain(`${note ? note + '\n\n' : ''}✨ ${profile.item} חדש. תכתוב לי בהודעה אחת מה זה, למשל: "${profile.example}". אפשר לשלוח גם תמונות.`); }
  return next(clientId, item.id, [`✨ קיבלתי, רשמתי את ה${profile.item}.`, note].filter(Boolean).join('\n'));
}

// A typed answer to the question we asked. Returns null when it is not an answer.
async function answer(clientId, x, t) {
  if (x.awaiting === 'vertical') return null;
  const item = await catalog.get(clientId, x.id).catch(() => null);
  if (!item) { await setIntake(clientId, null); return null; }
  const profile = profileOf(item), found = catalog.localExtract(profile, t), patch = { attributes: {} };
  const f = profile.fields.find((y) => y.key === x.awaiting);
  if (x.awaiting === 'consent') {
    if (/^(?:כן|יש|הסכים|הסכימה|יש הסכמה)(?:\s|$|,)/.test(t)) return command(clientId, [null, 'consent', item.id, 'yes']);
    if (/^(?:לא|עוד לא|אין)(?:\s|$|,)/.test(t)) return command(clientId, [null, 'consent', item.id, 'no']);
    return null;
  }
  if (x.awaiting === 'title') {
    const name = t.trim();
    if (name.length < 2 || name.length > 80 || name.startsWith('/')) return null;
    patch.title = name;
  } else if (x.awaiting === 'price') {
    const n = V.parsePrice(t) || (/^\s*[\d,.]+\s*$/.test(t) ? Number(t.replace(/[,\s]/g, '')) : null);
    if (!n) return t.length > 40 ? null : plain('לא הבנתי את המחיר. אפשר לכתוב רק מספר, למשל "350" או "2.9 מיליון".');
    patch.price = Math.round(n);
  } else if (x.awaiting === 'license') {
    const m = t.match(/^\D{0,30}?(\d{3,10})\D{0,10}$/);
    if (!m) return t.length > 40 ? null : plain(`מספר ה${profile.license.label} הוא מספר (למשל 314159). מה המספר שלך?`);
    patch.licenseNumber = m[1];
  } else if (f) {
    if (found.attributes[f.key] !== undefined) patch.attributes[f.key] = found.attributes[f.key];
    else if (f.type === 'choice') {
      const c = f.choices.find(([k, label]) => k && (t.includes(label.replace(/^ל/, '')) || t === k));
      if (!c) return null;
      patch.attributes[f.key] = c[0];
    } else if (f.type === 'number') {
      const n = /^\s*-?\d{1,6}(?:[.,]5)?\s*$/.test(t) ? Number(t.replace(',', '.')) : null;
      if (n == null) return t.length > 40 ? null : plain(`${f.label}: אפשר לכתוב מספר.`);
      patch.attributes[f.key] = n;
    } else if (f.type === 'text') {
      const v = t.replace(/^(?:ב|זה ב|העיר\s+)/, '').trim();
      if (v.length < 2 || v.length > 60 || /\d{4,}|[?/]/.test(v)) return null;
      patch.attributes[f.key] = v;
    } else return null;
  } else if (['describe', 'confirm', 'fix'].includes(x.awaiting)) {
    const more = await catalog.extract(profile, t);
    const any = more.price || more.title || more.kind || Object.keys(more.attributes).length;
    if (!any) return x.awaiting === 'describe' && t.length >= 4 ? (await catalog.update(clientId, item.id, { description: t }), next(clientId, item.id, 'שמרתי את התיאור.')) : x.awaiting === 'fix' && t.length <= 60 ? plain('מה לשנות? למשל "מחיר 350", או כתוב את הפרט החדש.') : null;
    Object.assign(patch, more);
    if (x.awaiting === 'describe' && !item.description) patch.description = t;
  } else return null;
  // Other details the owner wrote in the same answer are kept too.
  for (const [k, v] of Object.entries(found.attributes)) if (patch.attributes[k] === undefined && (item.attributes?.[k] == null || ['confirm', 'fix'].includes(x.awaiting))) patch.attributes[k] = v;
  if (found.kind && !patch.kind && item.kind === profile.defaultKind) patch.kind = found.kind;
  if (patch.attributes.features && item.attributes?.features?.length) patch.attributes.features = [...new Set([...item.attributes.features, ...patch.attributes.features])];
  try { await catalog.update(clientId, item.id, patch); }
  catch (error) { if (error.message === 'INVALID_LICENSE') return plain('מספר הרישיון לא נראה תקין. כתוב רק את המספר.'); return plain('אחד הפרטים לא נראה תקין. אפשר לכתוב אותו שוב?'); }
  return next(clientId, item.id, ['fix', 'confirm'].includes(x.awaiting) ? 'עדכנתי.' : '');
}

async function afterConfirm(clientId, id) {
  let item;
  try { item = await catalog.activate(clientId, id); }
  catch (error) { if (['ITEM_CONSENT_REQUIRED', 'ITEM_INCOMPLETE'].includes(error.message)) return next(clientId, id); throw error; }
  await setIntake(clientId, null);
  const profile = profileOf(item), license = profile.license ? `\n\nבכל מודעה ופוסט יופיע ה${profile.license.label} ${item.attributes.licenseNumber}.` : '';
  // Its own public page with a lead form (published when the work agreement allows it).
  const page = require('./landingPages').itemLine(await require('./landingPages').onItemActive(clientId, item).catch(() => null));
  return ui(clientId, `✅ ${catalog.title(item)} נשמר ומשווק.${page ? '\n' + page : ''}\n\nמה להכין לו?\n• קמפיין לידים ב־Meta (טיוטה לבדיקה שלך)\n• פוסטים לרשתות${license}`, [choice('קמפיין לידים', `/catalog-campaign ${id}`), choice('פוסטים', `/catalog-posts ${id}`), choice('אחר כך', '/catalog-later')]);
}

async function open(clientId, id) {
  const item = await catalog.get(clientId, id), profile = profileOf(item), items = [];
  if (item.status === 'ACTIVE') items.push(choice('קמפיין לידים', `/catalog-campaign ${id}`), choice('פוסטים', `/catalog-posts ${id}`));
  if (catalog.OPEN.includes(item.status)) { const o = profile.closeOutcomes.find((x) => x.key === profile.defaultOutcome(item)); items.push(choice(o.label, `/catalog-close ${id} ${o.key}`)); }
  const body = `${catalog.card(item, { photos: await photoCount(clientId, id) })}\nמצב: ${catalog.statusLabel(item)}`;
  if (item.status === 'DRAFT') return next(clientId, id, body);
  return items.length ? ui(clientId, body, items.slice(0, 3)) : plain(body);
}

async function listReply(clientId) {
  const profile = V.get((await V.detect(clientId)).key);
  const all = (await catalog.list(clientId)).slice(0, 10);
  if (!all.length) return plain(`עוד אין ${profile.itemPlural}. שלח לי תמונות ותיאור קצר, למשל "${profile.example}", ואכין את זה.`);
  const lines = all.map((i, n) => `${n + 1}. ${catalog.title(i)} · ${catalog.priceText(i) || 'בלי מחיר'} · ${catalog.statusLabel(i)} · ${i.leads} לידים`);
  return ui(clientId, `🏷️ ${profile.label} שלך:\n${lines.join('\n')}\n\n${require('./dashboardLink').hint('catalog')}`, all.map((i, n) => choice(`${n + 1}. ${catalog.title(i)}`, `/catalog-open ${i.id}`)));
}

async function closeReply(clientId, id, outcome) {
  const r = await catalog.close(clientId, id, outcome);
  if (!r.approval) return plain(r.reply);
  return require('./conversationUi').prepareApproval(clientId, r.approval, r.reply + '\n\n' + require('./actionPlan').formatActionPlan(r.approval.actionPlan));
}

async function command(clientId, [, name, id, arg, value]) {
  name = name.toLowerCase();
  if (name === 'later') { await setIntake(clientId, null); return plain('בסדר. כשתרצה, כתוב "מה אני מוכר" ובחר מהרשימה.'); }
  if (name === 'vertical') {
    if (!V.PROFILES[id]) return plain('הבחירה הזו כבר לא עדכנית.');
    const x = await intake(clientId);
    await V.choose(clientId, id);
    await setIntake(clientId, null);
    if (x?.awaiting === 'vertical') return start(clientId, x.pendingText || V.get(id).newWord);
    return plain(`רשמתי ✓ מעכשיו "${V.get(id).label}" הם מה שאתה מוכר.`);
  }
  if (!id) return plain('הבחירה הזו כבר לא עדכנית. כתוב "מה אני מוכר" כדי לבחור מהרשימה.');
  let item;
  try { item = await catalog.get(clientId, id); } catch { return plain('לא מצאתי את זה. כתוב "מה אני מוכר" כדי לבחור מהרשימה.'); }
  const profile = profileOf(item);
  if (name === 'set') {
    const f = profile.fields.find((x) => x.key === arg);
    if (!f) return null;
    try { await catalog.update(clientId, id, { attributes: { [f.key]: f.type === 'number' ? Number(value) : value } }); } catch { return plain('הערך הזה לא תקין.'); }
    return next(clientId, id);
  }
  if (name === 'consent') {
    if (arg === 'yes') { await catalog.setConsent(clientId, id, true); return next(clientId, id, '✅ רשמתי את ההסכמה להיום.'); }
    await setIntake(clientId, null);
    return plain(`שמרתי כטיוטה:\n\n${catalog.card(item, { photos: await photoCount(clientId, id) })}\n\nבלי הסכמה לא אפרסם. כשתהיה הסכמה כתוב "יש הסכמה" ואמשיך משם.`);
  }
  if (name === 'confirm') return afterConfirm(clientId, id);
  if (name === 'fix') { await setIntake(clientId, { id, awaiting: 'fix' }); return plain('מה לתקן? כתוב את הפרט החדש, למשל "מחיר 350".'); }
  if (name === 'cancel') {
    await setIntake(clientId, null);
    if (item.status === 'DRAFT') { await catalog.remove(clientId, id); return plain('ביטלתי. אפשר להתחיל מחדש מתי שתרצה.'); }
    return plain('בסדר, לא שיניתי כלום.');
  }
  if (name === 'open') return open(clientId, id);
  if (name === 'campaign') { const r = await catalog.prepareCampaign(clientId, id); return r.blocked ? plain(r.reply) : { task: r }; }
  if (name === 'posts') return plain((await catalog.preparePosts(clientId, id)).reply);
  if (name === 'close' && profile.closeOutcomes.some((o) => o.key === arg)) return closeReply(clientId, id, arg);
  return null;
}

// Text entry point (also the button choices). Returns null when it is not about the catalog.
async function handleClient(clientId, text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const cmd = t.match(CMD);
  if (cmd) return command(clientId, cmd);
  if (LIST.test(t)) return listReply(clientId);
  if (isNew(t)) { await setIntake(clientId, null); return start(clientId, t); }
  const x = await intake(clientId);
  if (x && CANCEL.test(t)) {
    await setIntake(clientId, null);
    const item = x.id ? await catalog.get(clientId, x.id).catch(() => null) : null;
    if (item?.status === 'DRAFT' && !item.owner_consent && x.awaiting !== 'confirm') await catalog.remove(clientId, x.id);
    return plain('בסדר, עצרתי את ההוספה.');
  }
  if (CONSENT.test(t)) {
    const waiting = (await catalog.list(clientId, { statuses: ['DRAFT', 'PAUSED'] })).filter((i) => i.consent_required && !i.owner_consent);
    if (!waiting.length) return null;
    if (waiting.length > 1) return ui(clientId, 'לאיזה נכס יש הסכמה?', waiting.slice(0, 10).map((i, n) => choice(`${n + 1}. ${catalog.title(i)}`, `/catalog-consent ${i.id} yes`)));
    await catalog.setConsent(clientId, waiting[0].id, true);
    return next(clientId, waiting[0].id, '✅ רשמתי את הסכמת בעל הנכס להיום.');
  }
  const closing = t.length <= 60 && t.match(CLOSE);
  if (closing) {
    const open = await catalog.list(clientId, { statuses: catalog.OPEN });
    if (!open.length) return null;
    const name = closing[1] || closing[3] || '', verb = closing[2];
    const matches = name ? await catalog.find(clientId, name) : open;
    const outcomeFor = (i) => { const p = profileOf(i); return (p.closeOutcomes.find((o) => o.verb.test(verb)) || p.closeOutcomes.find((o) => o.key === p.defaultOutcome(i))).key; };
    if (matches.length === 1 && name) return closeReply(clientId, matches[0].id, outcomeFor(matches[0]));
    return ui(clientId, `על מה מדובר? (${verb})`, (matches.length ? matches : open).slice(0, 10).map((i, n) => choice(`${n + 1}. ${catalog.title(i)}`, `/catalog-close ${i.id} ${outcomeFor(i)}`)));
  }
  if (x && x.id && !t.startsWith('/')) return answer(clientId, x, t);
  return null;
}

async function handleText(from, text) {
  if (!db.configured()) return null;
  const t = String(text || '').trim();
  if (t.length > 2000) return null;
  const clientId = await clientByPhone(from);
  if (!clientId) return null;
  try {
    return await require('./metaConnection').context.run(String(clientId), async () => {
      const r = await handleClient(clientId, t);
      return r && { ...r, clientId };
    });
  } catch (error) {
    logger.warn('Catalog conversation failed', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'CATALOG_FAILED' });
    return { clientId, text: 'משהו לא עבד בשמירה. אפשר לנסות שוב, או לפתוח את המסך בדשבורד.' };
  }
}

// A photo from WhatsApp: joins the item being added, or starts one when the caption
// describes an item. Plain photos with no catalog context are left to the existing flow.
async function handlePhoto(clientId, media) {
  if (!db.configured() || media?.type !== 'image') return null;
  const caption = String(media.caption || '').trim();
  const photoInput = { buffer: media.buffer, mimeType: media.mimeType, mediaId: media.mediaId };
  return require('./metaConnection').context.run(String(clientId), async () => {
    try {
      const x = await intake(clientId);
      if (x?.id) {
        let count;
        try { count = (await catalog.addPhoto(clientId, x.id, photoInput)).count; }
        catch (error) { return plain(error.message === 'TOO_MANY_PHOTOS' ? `אפשר לשמור עד ${catalog.MAX_PHOTOS} תמונות. התמונה הזו לא נשמרה.` : 'לא הצלחתי לשמור את התמונה. אפשר לשלוח אותה שוב.'); }
        if (caption) return answer(clientId, { ...x, awaiting: ['describe', 'confirm'].includes(x.awaiting) ? x.awaiting : 'fix' }, caption).then((r) => r || next(clientId, x.id, `📸 נשמרה תמונה ${count}.`));
        return count === 1 || x.awaiting === 'describe' ? next(clientId, x.id, `📸 נשמרה תמונה ${count}.`) : plain(`📸 נשמרה תמונה ${count}.`);
      }
      if (!caption || !isNew(caption)) {
        // A caption that clearly describes a property (rooms + price) also counts for real-estate offices.
        const d = await V.detect(clientId);
        const looks = d.key === 'real_estate' && caption && (() => { const f = catalog.localExtract(V.get('real_estate'), caption); return f.price && (f.attributes.rooms || f.attributes.city); })();
        if (!looks) return null;
      }
      return start(clientId, caption, photoInput);
    } catch (error) {
      logger.warn('Catalog photo not handled', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'CATALOG_PHOTO_FAILED' });
      return null;
    }
  });
}

module.exports = { handleText, handleClient, handlePhoto, LIST, CLOSE, isNew };
