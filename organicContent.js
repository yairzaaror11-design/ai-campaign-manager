'use strict';
// Ongoing organic content. The owner gets a three-month posting calendar, picks how
// visuals are made (AI graphic, AI video, a real photo shoot or a mix), approves
// posts, and on each post's day receives it ready to publish on WhatsApp.
// Nothing is published to a social network from here; the owner posts it.
const crypto = require('node:crypto');
const db = require('./db');
const { logger } = require('./logger');

const WEEKS = 13;
const MODES = ['AI_GRAPHIC', 'AI_VIDEO', 'PHOTO', 'MIXED'];
const PER_WEEK = [1, 2, 3, 4, 5];
const DAYS = { 1: [2], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4] };
const MIX = ['AI_GRAPHIC', 'AI_VIDEO', 'AI_GRAPHIC', 'PHOTO'];
const PURPOSES = ['טיפ מקצועי', 'הכירו את העסק', 'מאחורי הקלעים', 'שאלות נפוצות', 'לקוח מרוצה', 'לפני ואחרי', 'שאלה לקהל', 'הזמנה לפנות'];
const MEDIA_LABEL = { AI_GRAPHIC: 'גרפיקה AI', AI_VIDEO: 'סרטון AI', PHOTO: 'צילום אמיתי' };
const MODE_LABEL = { ...MEDIA_LABEL, MIXED: 'שילוב' };
const FORMAT_LABEL = { POST: 'פוסט', STORY: 'סטורי', REEL: 'רילס' };
const DAY_NAME = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const enabled = () => process.env.ORGANIC_CONTENT_ENABLED !== 'false';
const fail = (code) => Error(code);
const israelDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();
const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const shortDate = (d) => { const [, m, day] = iso(d).split('-'); return `${DAY_NAME[weekday(iso(d))]} ${Number(day)}/${Number(m)}`; };

function slots(start, perWeek, weeks = WEEKS) {
  const days = DAYS[perWeek], out = [];
  for (let i = 0; i < weeks * 7; i++) { const d = addDays(start, i); if (days.includes(weekday(d))) out.push(d); }
  return out;
}
const mediaFor = (mode, i) => (mode === 'MIXED' ? MIX[i % MIX.length] : mode);
const formatFor = (media, i) => (media === 'AI_VIDEO' ? 'REEL' : i % 3 === 2 ? 'STORY' : 'POST');

async function facts(clientId) {
  try {
    const p = await require('./marketingStore').load(clientId);
    return p ? require('./conversationFacts').all(p) : {};
  } catch { return {}; }
}

// A plain fallback when the AI writer is unavailable: honest, generic, editable.
function fallbackPost(f, slot) {
  const what = f.product || f.businessType || 'השירות שלנו', name = f.businessName ? ` ב${f.businessName}` : '';
  const by = {
    'טיפ מקצועי': [`טיפ מקצועי על ${what}`, `💡 טיפ קטן מאיתנו${name}: לפני שבוחרים ${what}, כדאי לשאול שלוש שאלות פשוטות. מה בדיוק מקבלים, כמה זמן זה לוקח ומה קורה אם משהו לא מסתדר. שאלות? כתבו לנו 👇`],
    'הכירו את העסק': ['הכירו אותנו', `👋 נעים להכיר! אנחנו${name} ועוסקים ב${what}. מה שחשוב לנו: יחס אישי, זמינות ועבודה שאפשר לסמוך עליה. רוצים לשמוע עוד? שלחו הודעה.`],
    'מאחורי הקלעים': ['מאחורי הקלעים', `🎬 הצצה למה שקורה אצלנו${name} ביום רגיל של עבודה על ${what}. כל פרט קטן חשוב לנו.`],
    'שאלות נפוצות': ['שאלה שחוזרת אלינו', `❓ "כמה זמן זה לוקח?" זו השאלה שאנחנו שומעים הכי הרבה על ${what}. התשובה תלויה בכמה דברים, ונשמח להסביר בדיוק מה מתאים לכם. כתבו לנו 👇`],
    'לקוח מרוצה': ['מה הלקוחות אומרים', `⭐ אין דבר שמשמח אותנו יותר מלקוח מרוצה. אם עבדנו יחד, נשמח לשמוע איך היה לך בתגובות 🙏`],
    'לפני ואחרי': ['לפני ואחרי', `✨ לפני ואחרי: ככה נראית עבודה על ${what} כשעושים אותה נכון. מה דעתכם?`],
    'שאלה לקהל': ['שאלה בשבילכם', `🤔 שאלה אלינו ואליכם: מה הכי חשוב לכם כשאתם בוחרים ${what}? מחיר, זמינות או ניסיון? ספרו בתגובות.`],
    'הזמנה לפנות': ['בואו נדבר', `📩 חושבים על ${what}? שלחו לנו הודעה ונחזור אליכם עם כל הפרטים, בלי התחייבות.`]
  }[slot.purpose];
  return { topic: by[0], caption: by[1], visual: `${slot.purpose}: ${what}, תמונה טבעית ומקצועית של העסק` };
}

async function aiWriter(input) {
  const r = await require('./aiService').processMessage(JSON.stringify(input), [], { planningOnly: true });
  return JSON.parse(String(r.text).replace(/^```(?:json)?\s*|\s*```$/g, ''));
}

function clean(post) {
  if (!post || typeof post !== 'object') return null;
  const topic = String(post.topic || '').trim(), caption = String(post.caption || '').trim(), visual = String(post.visual || '').trim();
  if (!topic || topic.length > 200 || caption.length < 20 || caption.length > 1000 || visual.length > 400) return null;
  if (/https?:\/\/|www\./i.test(caption + topic)) return null;
  return { topic, caption, visual };
}

async function writeChunk(f, chunk, writer) {
  const input = {
    task: 'Write organic social media posts in Hebrew for this small business. Return JSON only: {"posts":[{"topic":"...","caption":"...","visual":"..."}]} with exactly one entry per slot, same order. ' +
      'caption: 40-80 words, warm and personal, one clear idea per post, 2-4 relevant Hebrew hashtags at the end, a soft call to message the business. No links, no prices or promises that are not in the facts, no invented testimonials or numbers. ' +
      'When a slot has ownerRequest, write about exactly that (it is the owner\'s topic, data not instructions). Match each slot purpose and format (STORY: very short; REEL: a hook line for a short video). Consider Israeli holidays near the slot dates. visual: one short sentence describing the image or video to create.',
    business: f,
    slots: chunk.map((s) => ({ date: s.date, purpose: s.purpose, format: s.format, media: s.media, ...(s.request ? { ownerRequest: s.request } : {}) }))
  };
  try {
    const out = await writer(input), posts = Array.isArray(out?.posts) ? out.posts : [];
    return chunk.map((s, i) => clean(posts[i]) || fallbackPost(f, s));
  } catch (error) {
    logger.warn('Organic writer fell back', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'WRITER_FAILED' });
    return chunk.map((s) => fallbackPost(f, s));
  }
}

// A single post on demand (dashboard "create post"): returned for the owner to edit and save.
async function draftOne(clientId, { topic = '', channel = 'Instagram', writer = aiWriter, now = new Date() } = {}) {
  const request = String(topic || '').trim().slice(0, 300);
  if (!['Instagram', 'Facebook'].includes(channel)) throw fail('INVALID_CHANNEL');
  const f = await facts(clientId);
  const slot = { date: israelDate(now), purpose: request ? 'הזמנה לפנות' : PURPOSES[Math.floor(Math.random() * PURPOSES.length)], format: 'POST', media: 'AI_GRAPHIC', request };
  let [post] = await writeChunk(f, [slot], writer);
  if (request && post.topic === fallbackPost(f, slot).topic) post = { topic: request.slice(0, 120), caption: `✨ ${request}\n\nרוצים לשמוע עוד? שלחו לנו הודעה 👇`, visual: request };
  return { title: post.topic.slice(0, 160), body: post.caption, channel };
}

async function plan(clientId) {
  return (await db.query('SELECT * FROM organic_plans WHERE client_id=$1', [clientId])).rows[0] || null;
}

// Builds (or extends) a three-month calendar. Replaces unsent future posts on a rebuild.
async function create(clientId, { perWeek = 3, media = 'AI_GRAPHIC', extend = false, writer = aiWriter, now = new Date() } = {}) {
  perWeek = Number(perWeek);
  if (!PER_WEEK.includes(perWeek)) throw fail('INVALID_POSTS_PER_WEEK');
  if (!MODES.includes(media)) throw fail('INVALID_MEDIA_MODE');
  const existing = await plan(clientId), today = israelDate(now);
  if (extend && !existing) throw fail('ORGANIC_PLAN_REQUIRED');
  const start = extend ? [addDays(iso(existing.ends_on), 1), addDays(today, 1)].sort().at(-1) : addDays(today, 1);
  const f = await facts(clientId);
  const dates = slots(start, perWeek);
  const items = dates.map((date, i) => { const m = mediaFor(media, i); return { date, media: m, format: formatFor(m, i), purpose: PURPOSES[i % PURPOSES.length] }; });
  const size = Math.ceil(items.length / 3), chunks = [0, 1, 2].map((k) => items.slice(k * size, (k + 1) * size)).filter((c) => c.length);
  const written = (await Promise.all(chunks.map((c) => writeChunk(f, c, writer)))).flat();
  const end = addDays(start, WEEKS * 7 - 1);
  await db.transaction(async (tx) => {
    if (!extend) await tx("DELETE FROM organic_posts WHERE client_id=$1 AND publish_on>=$2 AND status IN ('DRAFT','APPROVED')", [clientId, start]);
    await tx(`INSERT INTO organic_plans(client_id,status,posts_per_week,media_mode,starts_on,ends_on) VALUES($1,'ACTIVE',$2,$3,$4,$5)
      ON CONFLICT(client_id) DO UPDATE SET status='ACTIVE',posts_per_week=$2,media_mode=$3,starts_on=CASE WHEN $6 THEN organic_plans.starts_on ELSE $4 END,ends_on=$5,updated_at=NOW()`,
    [clientId, perWeek, media, start, end, extend]);
    for (let i = 0; i < items.length; i++) {
      const s = items[i], w = written[i];
      await tx('INSERT INTO organic_posts(id,client_id,publish_on,format,media,purpose,topic,caption,visual) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [crypto.randomUUID(), clientId, s.date, s.format, s.media, s.purpose, w.topic, w.caption, w.visual]);
    }
    await tx("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'ORGANIC_PLAN_CREATED',$2)", [clientId, extend ? 'EXTENDED' : 'CREATED']);
  });
  return { count: items.length, perWeek, media, startsOn: start, endsOn: end, first: items.slice(0, 3).map((s, i) => ({ ...s, ...written[i] })) };
}

async function overview(clientId, { now = new Date() } = {}) {
  const p = await plan(clientId), today = israelDate(now);
  const posts = (await db.query(`SELECT id,publish_on,format,media,purpose,topic,caption,visual,status,error FROM organic_posts
    WHERE client_id=$1 AND publish_on>=$2 ORDER BY publish_on LIMIT 120`, [clientId, addDays(today, -14)])).rows
    .map((x) => ({ ...x, publish_on: iso(x.publish_on) }));
  const shoots = (await db.query("SELECT id,status,details,created_at FROM photo_shoot_requests WHERE client_id=$1 AND status<>'DETAILS_PENDING' ORDER BY created_at DESC LIMIT 5", [clientId])).rows;
  const waiting = posts.filter((x) => x.status === 'DRAFT' && x.publish_on >= today).length;
  return { plan: p && { ...p, starts_on: iso(p.starts_on), ends_on: iso(p.ends_on), daysLeft: Math.round((new Date(iso(p.ends_on)) - new Date(today)) / 864e5) }, posts, shoots, waiting, today };
}

async function approveAll(clientId, { now = new Date() } = {}) {
  const r = await db.query("UPDATE organic_posts SET status='APPROVED',updated_at=NOW() WHERE client_id=$1 AND status='DRAFT' AND publish_on>=$2 RETURNING id", [clientId, israelDate(now)]);
  return r.rows.length;
}

async function updatePost(clientId, id, { action, caption } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw fail('INVALID_POST');
  if (action === 'edit') {
    const text = String(caption || '').trim();
    if (text.length < 1 || text.length > 1000) throw fail('INVALID_CAPTION');
    const r = await db.query("UPDATE organic_posts SET caption=$3,updated_at=NOW() WHERE id=$1 AND client_id=$2 AND status IN ('DRAFT','APPROVED') RETURNING id", [id, clientId, text]);
    if (!r.rows.length) throw fail('POST_NOT_EDITABLE');
    return { ok: true };
  }
  const to = { approve: 'APPROVED', skip: 'SKIPPED', restore: 'DRAFT' }[action];
  if (!to) throw fail('INVALID_ACTION');
  const from = action === 'restore' ? ['SKIPPED', 'APPROVED'] : ['DRAFT', 'APPROVED'];
  const r = await db.query('UPDATE organic_posts SET status=$3,updated_at=NOW() WHERE id=$1 AND client_id=$2 AND status=ANY($4) RETURNING id', [id, clientId, to, from]);
  if (!r.rows.length) throw fail('POST_NOT_EDITABLE');
  return { ok: true, status: to };
}

async function setStatus(clientId, status) {
  if (!['ACTIVE', 'PAUSED'].includes(status)) throw fail('INVALID_STATUS');
  const r = await db.query('UPDATE organic_plans SET status=$2,updated_at=NOW() WHERE client_id=$1 RETURNING client_id', [clientId, status]);
  if (!r.rows.length) throw fail('ORGANIC_PLAN_REQUIRED');
  return { ok: true, status };
}

// Photo-shoot requests: the owner describes address, times and what to shoot; the
// SCORPIO team (support operators) gets the request on WhatsApp and coordinates.
async function pendingShoot(clientId) {
  return (await db.query("SELECT id FROM photo_shoot_requests WHERE client_id=$1 AND status='DETAILS_PENDING' AND created_at>NOW()-INTERVAL '2 hours' ORDER BY created_at DESC LIMIT 1", [clientId])).rows[0] || null;
}
async function notifyTeam(clientId, details) {
  const ids = String(process.env.SUPPORT_OPERATOR_CLIENT_IDS || '').split(',').map((x) => x.trim()).filter((x) => /^[1-9]\d*$/.test(x));
  const f = await facts(clientId), who = f.businessName || f.businessType || `עסק #${clientId}`;
  for (const id of ids) {
    try {
      const phone = (await db.query('SELECT phone FROM clients WHERE id=$1', [id])).rows[0]?.phone;
      if (!phone) continue;
      await require('./metaConnection').context.run(String(id), () => require('./whatsappDelivery').messageContext.run({ eventId: `shoot:${clientId}:${crypto.randomUUID()}`, sequence: 0 }, () =>
        require('./whatsapp').safeSend(phone, `📸 בקשה חדשה ליום צילום\nעסק: ${who} (#${clientId})\n${details}`)));
    } catch (error) { logger.warn('Photo shoot notice not sent', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'NOTICE_FAILED' }); }
  }
  return ids.length;
}
async function requestShoot(clientId, details = null) {
  if (details === null) {
    const open = await pendingShoot(clientId);
    if (!open) await db.query('INSERT INTO photo_shoot_requests(id,client_id) VALUES($1,$2)', [crypto.randomUUID(), clientId]);
    return { status: 'DETAILS_PENDING' };
  }
  const text = String(details).trim();
  if (text.length < 5 || text.length > 1000) throw fail('INVALID_SHOOT_DETAILS');
  const open = await pendingShoot(clientId);
  if (open) await db.query("UPDATE photo_shoot_requests SET status='REQUESTED',details=$2,updated_at=NOW() WHERE id=$1", [open.id, text]);
  else await db.query("INSERT INTO photo_shoot_requests(id,client_id,status,details) VALUES($1,$2,'REQUESTED',$3)", [crypto.randomUUID(), clientId, text]);
  await db.query("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'PHOTO_SHOOT_REQUESTED','REQUESTED')", [clientId]);
  await notifyTeam(clientId, text);
  return { status: 'REQUESTED' };
}

// WhatsApp conversation.
const SETUP = /^(?:תוכן שוטף|תוכן אורגני|תוכן קבוע|פוסטים קבועים|לוח תוכן ל(?:שלושה|3|־3|-3) חודשים|תכין לי תוכן (?:שוטף|אורגני|לשלושה חודשים))$/;
const SETUP_WITH = /^תוכן שוטף (?:עם |ב)?(גרפיקות AI|סרטוני AI|יום צילום|צילום אמיתי|משולב|שילוב)$/;
const APPROVE = /^(?:אשר את כל התוכן|אשר את התוכן|אשר את כל הפוסטים|לאשר את כל הפוסטים|אשר פוסטים)$/;
const PAUSE = /^(?:עצור|הפסק|השהה|תעצור|תשהה) (?:את ה)?תוכן(?: ה?שוטף)?$/;
const RESUME = /^(?:המשך|חדש|תמשיך) (?:את ה)?תוכן (?:ה)?שוטף$/;
const EXTEND = /^(?:תמשיך את התוכן|עוד שלושה חודשים|עוד 3 חודשים)$/;
const STATUS = /^(?:התוכן שלי|לוח התוכן שלי|מה הפוסטים הבאים|הפוסטים הבאים)$/;
const SHOOT = /^(?:(?:אני\s+)?(?:רוצה|מבקש|מבקשת|צריך|צריכה)\s+)?(?:(?:להזמין|הזמן|תזמין|לקבוע)\s+)?יום צילום$/;
const CANCEL = /^(?:בטל|ביטול|לא עכשיו|עזוב)$/;
const MODE_OF = { 'גרפיקות AI': 'AI_GRAPHIC', 'סרטוני AI': 'AI_VIDEO', 'יום צילום': 'PHOTO', 'צילום אמיתי': 'PHOTO', 'משולב': 'MIXED', 'שילוב': 'MIXED' };

const line = (x) => `• ${shortDate(x.date || x.publish_on)}, ${FORMAT_LABEL[x.format]} עם ${MEDIA_LABEL[x.media]}: "${x.topic}"`;
function summary(result) {
  return `✅ הכנתי לך לוח תוכן ל־3 חודשים: ${result.count} פוסטים, ${result.perWeek} בשבוע (${MODE_LABEL[result.media]}).\n\nהנה הראשונים:\n${result.first.map(line).join('\n')}\n\nבכל יום פרסום אשלח לך כאן את הפוסט מוכן, עם הטקסט והתמונה. שום דבר לא נשלח בלי אישור שלך.`;
}

async function handle(clientId, text) {
  const t = String(text || '').trim();
  if (await pendingShoot(clientId)) {
    if (CANCEL.test(t)) { await db.query("UPDATE photo_shoot_requests SET status='CANCELLED',updated_at=NOW() WHERE client_id=$1 AND status='DETAILS_PENDING'", [clientId]); return { handled: true, reply: 'בסדר, ביטלתי את בקשת יום הצילום. אפשר לחזור לזה מתי שתרצה.' }; }
    if (t.length >= 8 && t.length <= 1000 && !t.startsWith('/') && !SETUP.test(t) && !SETUP_WITH.test(t) && !SHOOT.test(t)) {
      await requestShoot(clientId, t);
      return { handled: true, reply: 'קיבלתי! 📸 נחזור אליך תוך יום עסקים לתאם צלם ולסגור מחיר.\nאחרי הצילום אשתמש בתמונות בפוסטים ובמודעות שלך.' };
    }
  }
  if (SHOOT.test(t)) {
    await requestShoot(clientId);
    return { handled: true, reply: 'מעולה 📸 יום צילום בעסק נותן תמונות אמיתיות לפוסטים ולמודעות לכמה חודשים קדימה.\n\nכתוב לי בהודעה אחת:\n1. כתובת העסק\n2. ימים ושעות נוחים\n3. מה חשוב לצלם (צוות, מוצרים, עבודה, המקום)\n\nאפשר לכתוב "בטל" אם התחרטת.' };
  }
  const withMode = t.match(SETUP_WITH);
  if (withMode || SETUP.test(t)) {
    const current = await plan(clientId);
    if (!withMode && current) return status(clientId);
    if (!withMode) return { handled: true, reply: 'אכין לך פוסטים קבועים ל־3 חודשים קדימה, 3 בשבוע, ובכל יום פרסום אשלח לך את הפוסט מוכן.\n\nאיך תרצה את התמונות?', decisionKey: 'organic_setup' };
    const media = MODE_OF[withMode[1]];
    const result = await create(clientId, { perWeek: current?.posts_per_week || 3, media });
    return { handled: true, reply: summary(result), decisionKey: 'organic_review' };
  }
  if (APPROVE.test(t)) {
    if (!await plan(clientId)) return { handled: true, reply: 'עוד אין לוח תוכן. כתוב "תוכן שוטף" ואכין לך אחד ל־3 חודשים.' };
    const n = await approveAll(clientId);
    return { handled: true, reply: n ? `✅ אישרתי ${n} פוסטים. בכל יום פרסום אשלח לך כאן את הפוסט מוכן.` : 'כל הפוסטים כבר מאושרים ✓' };
  }
  if (PAUSE.test(t)) { try { await setStatus(clientId, 'PAUSED'); return { handled: true, reply: 'עצרתי את התוכן השוטף. כתוב "המשך תוכן שוטף" כשתרצה לחזור.' }; } catch { return { handled: true, reply: 'עוד אין תוכן שוטף פעיל.' }; } }
  if (RESUME.test(t)) { try { await setStatus(clientId, 'ACTIVE'); return { handled: true, reply: 'חזרנו ✓ הפוסטים המאושרים יגיעו אליך כרגיל.' }; } catch { return { handled: true, reply: 'עוד אין לוח תוכן. כתוב "תוכן שוטף" ואכין לך אחד.' }; } }
  if (EXTEND.test(t)) {
    const current = await plan(clientId);
    if (!current) return { handled: true, reply: 'עוד אין לוח תוכן. כתוב "תוכן שוטף" ואכין לך אחד ל־3 חודשים.' };
    const result = await create(clientId, { perWeek: current.posts_per_week, media: current.media_mode, extend: true });
    return { handled: true, reply: summary(result), decisionKey: 'organic_review' };
  }
  if (STATUS.test(t)) return status(clientId);
  return null;
}

async function status(clientId) {
  const o = await overview(clientId);
  if (!o.plan) return { handled: true, reply: 'עוד אין לוח תוכן. כתוב "תוכן שוטף" ואכין לך אחד ל־3 חודשים.' };
  const next = o.posts.filter((x) => x.publish_on >= o.today && ['DRAFT', 'APPROVED'].includes(x.status)).slice(0, 4);
  return {
    handled: true,
    reply: `📅 התוכן השוטף שלך${o.plan.status === 'PAUSED' ? ' (בהשהיה)' : ''}:\n${next.map(line).map((l, i) => l + (next[i].status === 'DRAFT' ? ' (מחכה לאישור)' : ' ✓')).join('\n') || 'אין פוסטים קרובים.'}\n\n${o.waiting ? `${o.waiting} פוסטים מחכים לאישור שלך.` : 'הכול מאושר ✓'}\n${require('./dashboardLink').hint('content')}`,
    decisionKey: o.waiting ? 'organic_review' : null
  };
}

// Background: deliver approved posts on their day and remind weekly about drafts.
async function claim(today) {
  return (await db.query(`UPDATE organic_posts SET status='SENDING',attempts=attempts+1,updated_at=NOW() WHERE id=(
    SELECT p.id FROM organic_posts p JOIN organic_plans pl ON pl.client_id=p.client_id AND pl.status='ACTIVE'
    JOIN clients c ON c.id=p.client_id JOIN whatsapp_contacts w ON w.phone=c.phone AND w.last_inbound_at>NOW()-INTERVAL '24 hours'
    WHERE p.status='APPROVED' AND p.publish_on<=$1 AND p.publish_on>=$2 ORDER BY p.publish_on LIMIT 1 FOR UPDATE OF p SKIP LOCKED)
    RETURNING *`, [today, addDays(today, -2)])).rows[0] || null;
}

async function deliver(post, phone) {
  const graphics = require('./graphicService'), delivery = require('./whatsappDelivery');
  let note = '';
  if (post.media === 'AI_VIDEO') {
    let r = { status: 'DISABLED' };
    try { r = await require('./videoService').request(post.client_id, phone, { prompt: post.visual || post.topic, aspectRatio: post.format === 'POST' ? '1:1' : '9:16', durationSeconds: 5 }, { eventId: `organic:${post.id}` }); } catch { r = { status: 'FAILED' }; }
    if (['QUEUED', 'ALREADY_QUEUED'].includes(r.status)) note = '🎬 הסרטון בהכנה ויגיע לכאן בעוד כמה דקות.';
    else post = { ...post, media: 'AI_GRAPHIC' };
  }
  if (post.media === 'AI_GRAPHIC') {
    try {
      const asset = await graphics.createGraphic(post.client_id, (`Organic social media ${post.format === 'STORY' ? 'story (vertical)' : 'post (square)'} image for a small business. ${post.visual}. Topic: ${post.topic}. Natural, warm, professional. Avoid text in the image.`).slice(0, 2000));
      await delivery.enqueue(phone, { type: 'image', image: { id: asset.whatsapp_media_id, caption: 'התמונה לפוסט של היום' } });
    } catch { note = 'לא הספקתי להכין תמונה הפעם. אפשר לפרסם עם תמונה אמיתית מהעסק.'; }
  }
  if (post.media === 'PHOTO' && post.catalog_item_id) note = await require('./catalog').deliverPhotos(post.client_id, post.catalog_item_id, phone);
  else if (post.media === 'PHOTO') note = '📸 מצרפים תמונה מיום הצילום (או כל תמונה טובה מהעסק) ומפרסמים.';
  const how = post.format === 'STORY' ? 'מעתיקים ומעלים לסטורי באינסטגרם ובפייסבוק.' : 'מעתיקים ומפרסמים באינסטגרם ובפייסבוק.';
  await require('./whatsapp').safeSend(phone, `📅 ה${FORMAT_LABEL[post.format]} של היום מוכן לפרסום!\n\n${post.caption}\n\n👆 ${how}${note ? '\n' + note : ''}`);
}

async function remind(today) {
  if (weekday(today) !== 0) return 0;
  const rows = (await db.query(`SELECT pl.client_id,c.phone,pl.ends_on,
      (SELECT COUNT(*)::int FROM organic_posts p WHERE p.client_id=pl.client_id AND p.status='DRAFT' AND p.publish_on BETWEEN $1 AND $2) AS waiting
    FROM organic_plans pl JOIN clients c ON c.id=pl.client_id JOIN whatsapp_contacts w ON w.phone=c.phone AND w.last_inbound_at>NOW()-INTERVAL '24 hours'
    WHERE pl.status='ACTIVE' AND (pl.last_reminded_on IS NULL OR pl.last_reminded_on<$1) LIMIT 200`, [today, addDays(today, 6)])).rows;
  let sent = 0;
  for (const r of rows) {
    const left = Math.round((new Date(iso(r.ends_on)) - new Date(today)) / 864e5);
    if (!r.waiting && left > 14) continue;
    if (await require('./leadCheckins').ownerBusy(r.client_id)) continue;
    const claimed = await db.query('UPDATE organic_plans SET last_reminded_on=$2 WHERE client_id=$1 AND (last_reminded_on IS NULL OR last_reminded_on<$2) RETURNING client_id', [r.client_id, today]);
    if (!claimed.rows.length) continue;
    const parts = [r.waiting ? `📅 יש לך ${r.waiting} פוסטים לשבוע הזה שמחכים לאישור.` : '', left <= 14 ? `לוח התוכן שלך נגמר בעוד ${Math.max(left, 0)} ימים. להכין עוד 3 חודשים?` : ''].filter(Boolean);
    const items = [...(r.waiting ? [{ title: 'אשר את הכל', text: 'אשר את כל התוכן' }] : []), ...(left <= 14 ? [{ title: 'עוד 3 חודשים', text: 'עוד 3 חודשים' }] : []), { title: 'לראות בדשבורד', text: 'דשבורד תוכן' }];
    try {
      await require('./metaConnection').context.run(String(r.client_id), () => require('./whatsappDelivery').messageContext.run({ eventId: `organic-remind:${r.client_id}:${today}`, sequence: 0 }, async () => {
        const ui = await require('./conversationUi').prepareChoices(r.client_id, parts.join('\n'), items, 'guard_alert');
        await require('./whatsapp').safeSend(r.phone, ui.text, ui);
      }));
      sent++;
    } catch (error) { logger.warn('Organic reminder skipped', { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'REMIND_FAILED' }); }
  }
  return sent;
}

async function runDue({ now = new Date(), send = deliver, limit = 20 } = {}) {
  if (!enabled() || !db.configured() || !require('./leadCheckins').businessHours(now)) return { status: 'NOT_DUE' };
  const today = israelDate(now);
  await db.query("UPDATE organic_posts SET status='APPROVED',updated_at=NOW() WHERE status='SENDING' AND attempts<3 AND updated_at<NOW()-INTERVAL '30 minutes'");
  await db.query("UPDATE organic_posts SET status='SKIPPED',error='MISSED',updated_at=NOW() WHERE status IN ('APPROVED','SENDING') AND publish_on<$1", [addDays(today, -2)]);
  const results = [];
  for (let i = 0; i < limit; i++) {
    const post = await claim(today);
    if (!post) break;
    try {
      const phone = (await db.query('SELECT phone FROM clients WHERE id=$1', [post.client_id])).rows[0].phone;
      await require('./metaConnection').context.run(String(post.client_id), () => require('./whatsappDelivery').messageContext.run({ eventId: `organic:${post.id}:${post.attempts}`, sequence: 0 }, () => send(post, phone)));
      await db.query("UPDATE organic_posts SET status='SENT',sent_at=NOW(),error=NULL,updated_at=NOW() WHERE id=$1", [post.id]);
      results.push('SENT');
    } catch (error) {
      const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'DELIVERY_FAILED';
      const paused = code === 'HUMAN_SUPPORT_PAUSED';
      await db.query("UPDATE organic_posts SET status=CASE WHEN $3 THEN 'APPROVED' WHEN attempts>=3 THEN 'FAILED' ELSE 'APPROVED' END,attempts=attempts-CASE WHEN $3 THEN 1 ELSE 0 END,error=$2,updated_at=NOW() WHERE id=$1", [post.id, code, paused]);
      logger.warn('Organic post not delivered', { error: code });
      results.push('FAILED');
      if (paused) break;
    }
  }
  const reminded = await remind(today);
  return { status: 'RAN', results, reminded };
}

module.exports = { enabled, slots, create, draftOne, overview, approveAll, updatePost, setStatus, requestShoot, handle, runDue, deliver, israelDate, MODES, PER_WEEK, MEDIA_LABEL, FORMAT_LABEL };
