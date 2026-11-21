'use strict';
// Onboarding V2: "0 → ready campaign in 10 minutes" in WhatsApp (behind ONBOARDING_V2_ENABLED).
// One-sentence intro → link (read by the agent) → ≤3 button questions (what you sell → catalog
// item, goal → funnel, daily budget) → "הנה מה שהבנתי" → consent for lead/money alerts → work
// agreement with defaults → an instant sample ad (before Meta) → guided Meta connection →
// first campaign through the existing flow (created paused; activation is a separate question).
// All wording lives in onboardingCopy.js. Nothing here spends money or publishes anything.
const db = require('./db');
const copy = require('./onboardingCopy');

const STEPS = ['LINK', 'SELL', 'GOAL', 'BUDGET', 'SUMMARY', 'LICENSE', 'CONSENT', 'AGREEMENT', 'META', 'CAMPAIGN', 'DONE'];
const DECISION = 'onboarding';
const BUDGETS = [50, 100, 150];
const START = /^(?:\/start|היי|הי|שלום|היי שם|אהלן|הלו|נתחיל|בוא נתחיל|אני רוצה קמפיין|קמפיין חדש|אני רוצה להתחיל)[!.?\s👋]*$/u;
const CONTINUE = /^(?:להמשיך|נמשיך|המשך|תמשיך)$/u;

function enabled() { return process.env.ONBOARDING_V2_ENABLED === 'true'; }
async function state(clientId) {
  try { return (await db.query('SELECT * FROM onboarding_state WHERE client_id=$1', [clientId])).rows[0] || null; } catch { return null; }
}
async function save(clientId, step, answers) {
  await db.query(`INSERT INTO onboarding_state(client_id,step,answers) VALUES($1,$2,$3::jsonb)
    ON CONFLICT(client_id) DO UPDATE SET step=EXCLUDED.step,answers=EXCLUDED.answers,updated_at=NOW()`, [clientId, step, JSON.stringify(answers || {})]);
}
// "נתחיל מחדש" (reset): onboarding starts over with the conversation.
async function reset(clientId) { try { await db.query('DELETE FROM onboarding_state WHERE client_id=$1 AND completed_at IS NULL', [clientId]); } catch { /* table not there yet */ } }
async function finish(clientId) { await db.query('UPDATE onboarding_state SET step=$2,completed_at=COALESCE(completed_at,NOW()),updated_at=NOW() WHERE client_id=$1', [clientId, 'DONE']); }
// Lead alerts are muted only when the owner explicitly said "לא עכשיו".
async function alertsDeclined(clientId) {
  try { return (await db.query('SELECT alerts_consent FROM onboarding_state WHERE client_id=$1', [clientId])).rows[0]?.alerts_consent === false; } catch { return false; }
}

const linkIn = (text) => { const m = String(text).match(/https?:\/\/[^\s<>"']+/); return m ? m[0].replace(/[),.]+$/, '').replace(/^http:/, 'https:') : null; };
const short = (s, n = 20) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trim() + '…' : t; };
const facts = () => require('./conversationFacts');

// A reply with reply buttons (decision "onboarding"); `lead` texts go first as separate messages.
async function choices(clientId, body, titles, { lead = [], media = [] } = {}) {
  const items = titles.filter(Boolean).slice(0, 3).map((t) => (typeof t === 'string' ? { title: short(t), text: t } : { title: short(t.title), text: t.text }));
  const ui = await require('./conversationUi').prepareChoices(clientId, body, items, DECISION);
  return { ...ui, leadTexts: lead.filter(Boolean), media };
}
const plain = (text, extra = {}) => ({ text, leadTexts: [], media: [], ...extra });

// ---------- questions ----------
function vertical(answers) { return require('./verticalProfiles').infer([answers.business, answers.site?.name, answers.site?.description].filter(Boolean).join(' ')) || 'generic'; }
function askSell(clientId, answers, lead = []) {
  const ideas = [answers.site?.product, ...(copy.sellSuggestions[vertical(answers)] || [])].filter(Boolean);
  return choices(clientId, copy.askSell, [...ideas.slice(0, 2), { title: copy.sellOtherButton, text: copy.sellOtherButton }], { lead });
}
const goalKeys = (a = {}) => copy.goalsByVertical[vertical(a)] || copy.goalsByVertical.default;
const askGoal = (clientId, lead = [], a = {}) => choices(clientId, copy.askGoal, goalKeys(a).map((k) => ({ title: copy.goals[k].button, text: copy.goals[k].button })), { lead });
const askBudget = (clientId, lead = [], a = {}) => choices(clientId, copy.askBudget + '\n' + (copy.budgetHint[vertical(a)] || copy.budgetHint.generic), BUDGETS.map((n) => copy.budgetButton(n)), { lead });
function summaryText(a) {
  return [copy.summaryTitle, copy.summaryLines({ business: a.site?.name || a.business || '', item: a.item, goal: copy.goals[a.goal].label, daily: a.daily }), copy.summaryQuestion].filter(Boolean).join('\n');
}
const askSummary = (clientId, a) => choices(clientId, summaryText(a), [copy.summaryYes, copy.summaryFix]);
const askLicense = (clientId, lead = [], media = []) => choices(clientId, copy.askLicense, [copy.licenseLaterButton], { lead, media });
const askConsent = (clientId, lead = []) => choices(clientId, copy.askConsent, [copy.consentYes, copy.consentNo], { lead });
const askAgreement = (clientId, a, lead = []) => choices(clientId, copy.askAgreement({ monthly: a.daily * 30, daily: a.daily }), [copy.agreementDefaults, copy.agreementCustom, copy.agreementLater], { lead });
const askMeta = (clientId, lead = [], media = []) => choices(clientId, copy.askMeta, [copy.metaConnect, copy.metaNoAccount, copy.metaLater], { lead, media });

async function question(clientId, step, a, lead = []) {
  if (step === 'LINK') return choices(clientId, copy.askLink, [copy.noLinkButton], { lead });
  if (step === 'SELL') return askSell(clientId, a, lead);
  if (step === 'GOAL') return askGoal(clientId, lead, a);
  if (step === 'BUDGET') return askBudget(clientId, lead, a);
  if (step === 'LICENSE') return askLicense(clientId, lead);
  if (step === 'SUMMARY') return choices(clientId, summaryText(a), [copy.summaryYes, copy.summaryFix], { lead });
  if (step === 'CONSENT') return askConsent(clientId, lead);
  if (step === 'AGREEMENT') return askAgreement(clientId, a, lead);
  if (step === 'META') return askMeta(clientId, lead);
  return null;
}

// ---------- start ----------
async function isNew(clientId) {
  // An existing customer (past tasks, approvals or a Meta connection) never gets the first-time intro again.
  try {
    const { rows: [h] } = await db.query(`SELECT EXISTS(SELECT 1 FROM agent_tasks WHERE client_id=$1) OR EXISTS(SELECT 1 FROM action_plans WHERE client_id=$1) OR EXISTS(SELECT 1 FROM meta_connections WHERE client_id=$1) AS known`, [clientId]);
    if (h?.known) return false;
  } catch { /* tables missing in a fresh install: fall back to the profile */ }
  const p = await require('./marketingStore').load(clientId).catch(() => null);
  if (!p) return true;
  return !facts().value(p, 'businessType') && !facts().value(p, 'product');
}
async function start(clientId) {
  await save(clientId, 'LINK', {});
  let privacy = '';
  try { privacy = copy.privacy(require('./portalStore').origin() + '/privacy'); } catch { privacy = ''; }
  return choices(clientId, copy.askLink, [copy.noLinkButton], { lead: [[copy.intro, privacy].filter(Boolean).join('\n\n')] });
}

// ---------- confirming the card: write the facts the owner approved, build the real draft ----------
async function applyAnswers(clientId, a) {
  const goal = copy.goals[a.goal];
  const destination = a.goal === 'SALES' && !a.site?.source ? copy.goals.WHATSAPP.destination : goal.destination;
  await require('./marketingStore').update(clientId, null, (p) => {
    const f = facts(), j = require('./campaignJourney');
    const write = (field, value) => { if (!value) return; try { f.write(p, field, value, { source: 'onboarding_user_confirmed', evidence: 'הנה מה שהבנתי' }); } catch { /* an invalid fact is simply asked again later */ } };
    write('businessName', a.site?.name ? String(a.site.name).slice(0, 120) : null);
    write('businessType', String(a.business || a.site?.description || a.item).slice(0, 500));
    write('product', String(a.item).slice(0, 300));
    write('businessGoal', goal.businessGoal);
    write('leadDestination', destination);
    f.write(p, 'dailyBudget', { amount: a.daily, currency: 'ILS', period: 'day' }, { source: 'onboarding_user_confirmed', evidence: copy.budgetButton(a.daily) });
    if (a.site?.source) write('website', a.site.source);
    j.init(p);
    f.correctionsInvalidate?.(p, ['product', 'businessGoal', 'dailyBudget', 'leadDestination']);
    p.onboardingV2 = { step: 'CONFIRMED', at: new Date().toISOString() };
    return { handled: false, changed: true, audit: 'ONBOARDING_CONFIRMED' };
  });
  // "What you sell" becomes a catalog item (a draft; the catalog itself is still "בבדיקה").
  try {
    const key = vertical(a), input = { title: String(a.item).slice(0, 160), description: String(a.business || a.site?.description || '').slice(0, 2000) };
    if (key === 'real_estate') input.attributes = /להשכרה|שכירות/.test(a.item) ? { dealType: 'RENT' } : /למכירה|מכירה/.test(a.item) ? { dealType: 'SALE' } : {};
    await require('./catalog').create(clientId, input, { vertical: key });
  } catch (error) {
    require('./logger').logger.warn('Onboarding catalog item not created', { error: /^[A-Z_]+$/.test(error?.message) ? error.message : 'CATALOG_FAILED' });
  }
}
// The draft the owner will see in the sample ad and the plan (same builder as the regular journey).
async function draft(clientId) {
  let out = null;
  await require('./marketingStore').update(clientId, null, (p) => {
    const j = require('./campaignJourney');
    j.init(p);
    const r = j.stageReply(p, 'PLAN_REVIEW');
    out = p.journey.draft;
    return { handled: false, changed: true, reply: r.reply };
  });
  return out;
}

// ---------- the sample ad: image + text, before any connection ----------
async function defaultImage(clientId, prompt) {
  if (process.env.GRAPHICS_ENABLED !== 'true') return null;
  const asset = await require('./graphicService').createGraphic(clientId, prompt);
  return asset?.whatsapp_media_id ? { id: asset.whatsapp_media_id } : null;
}
async function sample(clientId, a, { makeImage = defaultImage } = {}) {
  const d = await draft(clientId);
  const ad = d?.creatives?.[0] || { headline: a.item, body: '', cta: '' };
  let image = null;
  try { image = await makeImage(clientId, `מודעת פרסום לרשתות חברתיות עבור ${a.site?.name || 'העסק'}: ${a.item}. ${ad.headline}. בלי טקסט על התמונה.`.slice(0, 1900)); } catch { image = null; }
  a.sampleAt = new Date().toISOString();
  const text = [copy.sampleIntro, copy.sampleAd(ad), image ? '' : copy.sampleNoImage, copy.sampleFooter].filter(Boolean).join('\n\n');
  return { text, media: image ? [{ id: image.id, caption: copy.sampleImageCaption }] : [] };
}
async function toSampleAndMeta(clientId, a, lead, options) {
  const s = a.sampleAt ? { text: '', media: [] } : await sample(clientId, a, options);
  await save(clientId, 'META', a);
  await require('./marketingStore').update(clientId, null, (p) => { p.onboardingV2 = { ...(p.onboardingV2 || {}), step: 'META' }; return { handled: false, changed: true }; });
  return askMeta(clientId, [...lead, s.text].filter(Boolean), s.media);
}

// ---------- broker license (real estate): stored on the profile, shared with the catalog ----------
async function brokerLicense(clientId) { try { return (await require('./marketingStore').load(clientId))?.brokerLicense || null; } catch { return null; } }
async function saveBrokerLicense(clientId, n) { await require('./marketingStore').update(clientId, null, (p) => { p.brokerLicense = String(n); return { handled: false, changed: true, audit: 'BROKER_LICENSE_SET' }; }); }

// ---------- main entry: returns null when the text is not ours ----------
async function handleText(clientId, text, options = {}) {
  if (!enabled() || !db.configured()) return null;
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t || t.length > 500) return null;
  if (require('./conversationControl').isReset(t)) return null;
  const row = await state(clientId);
  if (copy.consentOnWords.test(t) && row) {
    await db.query('UPDATE onboarding_state SET alerts_consent=TRUE,alerts_consent_at=NOW(),updated_at=NOW() WHERE client_id=$1', [clientId]);
    return plain(copy.consentOnReply);
  }
  if (!row) {
    if (!(START.test(t) || linkIn(t)) || !await isNew(clientId)) return null;
    const started = await start(clientId);
    if (!linkIn(t)) return started;
    // A first message that is already the link: intro first, then what was read.
    const next = await handleText(clientId, text, options);
    return next ? { ...next, leadTexts: [...started.leadTexts, ...(next.leadTexts || [])] } : started;
  }
  if (row.completed_at) return null;
  const a = { ...(row.answers || {}) };
  if (copy.skipWords.test(t)) { await finish(clientId); return plain(copy.skip); }
  if (CONTINUE.test(t)) return question(clientId, row.step, a, [copy.resumeHint]);
  // Commands that have their own handlers are never taken as an onboarding answer.
  if (require('./dashboardLink').request(t) || require('./undoActions').REQUEST.test(t) || require('./activityLog').REQUEST.test(t) || require('./activityLog').STATUS_REQUEST.test(t) || /^(?:הסכם\s+(?:ה)?עבודה|עצור את כל הפעולות האוטומטיות|נציג|אשר\s+\d{6})$/u.test(t)) return null;

  switch (row.step) {
    case 'LINK': {
      const url = linkIn(t);
      if (url) {
        if (!await require('./rateLimit').take('business-inspect:' + clientId, 6, 3600)) { a.linkFailed = true; await save(clientId, 'LINK', a); return question(clientId, 'LINK', a, [copy.linkRateLimited, copy.describeInstead]); }
        try { await options.onSlow?.(); } catch { /* progress notice is best effort */ }
        try {
          const found = await (options.inspect || require('./publicWebsite').inspect)(url);
          a.site = { source: found.source, name: found.facts?.businessName || '', description: found.facts?.businessType || '', product: found.facts?.product || '', image: found.brand?.images?.[0] || null };
          await save(clientId, 'SELL', a);
          return askSell(clientId, a, [copy.foundFromLink(a.site.name)]);
        } catch {
          a.linkFailed = true; await save(clientId, 'LINK', a);
          return plain(copy.linkFailed + '\n' + copy.describeInstead);
        }
      }
      if (t === copy.noLinkButton) { a.noLink = true; await save(clientId, 'LINK', a); return plain(copy.describeInstead); }
      if (t.length < 3) return null;
      a.business = t.slice(0, 500);
      await save(clientId, 'SELL', a);
      return askSell(clientId, a);
    }
    case 'SELL': {
      if (t === copy.sellOtherButton) return plain(copy.sellWrite);
      if (t.length < 2 || t.startsWith('/')) return null;
      a.item = t.slice(0, 160);
      await save(clientId, 'GOAL', a);
      return askGoal(clientId, [], a);
    }
    case 'GOAL': {
      const goal = Object.entries(copy.goals).find(([, g]) => g.button === t || g.label === t)?.[0]
        || (/וואטסאפ|ווטסאפ|whatsapp/i.test(t) ? 'WHATSAPP' : /צפי/.test(t) ? 'VIEWING' : /מכיר|קני|אתר/.test(t) ? 'SALES' : /ליד|טלפון|שיחה|פניות|טופס|יתקשר|התקשר|לחזור אלי|יחזרו|פרטים|שם ומספר/.test(t) ? 'LEADS' : null);
      // A question goes to the agent; anything else is re-asked instead of leaving the onboarding.
      if (!goal) return /[?？]\s*$/.test(t) ? null : askGoal(clientId, [copy.goalUnclear], a);
      a.goal = goal;
      await save(clientId, 'BUDGET', a);
      return askBudget(clientId, [], a);
    }
    case 'BUDGET': {
      const m = t.replace(/,/g, '').match(/\d{1,6}/);
      if (!m) return /[?？]\s*$/.test(t) ? null : askBudget(clientId, [copy.budgetInvalid], a);
      const n = Number(m[0]);
      if (n < 10 || n > 100000) return askBudget(clientId, [copy.budgetInvalid], a);
      a.daily = n;
      await save(clientId, 'SUMMARY', a);
      return askSummary(clientId, a);
    }
    case 'SUMMARY': {
      if (t === copy.summaryFix || /^(?:לא|לתקן|יש טעות)$/.test(t)) { delete a.item; delete a.goal; delete a.daily; await save(clientId, 'SELL', a); return askSell(clientId, a, [copy.summaryRestart]); }
      if (t !== copy.summaryYes && !/^(?:כן|נכון|מאשר|נכון, ממשיכים|נכון ✓)$/.test(t)) return null;
      await applyAnswers(clientId, a);
      a.confirmedAt = new Date().toISOString();
      // Value first: the sample ad right after the card, before any setup question.
      const s = await sample(clientId, a, options);
      if (vertical(a) === 'real_estate' && !await brokerLicense(clientId)) { await save(clientId, 'LICENSE', a); return askLicense(clientId, [s.text], s.media); }
      await save(clientId, 'CONSENT', a);
      return { ...(await askConsent(clientId, [s.text])), media: s.media };
    }
    case 'LICENSE': {
      if (t === copy.licenseLaterButton || /^(?:אחר כך|אח"כ|לא עכשיו)$/.test(t)) { await save(clientId, 'CONSENT', a); return askConsent(clientId, [copy.licenseLater]); }
      const m = t.replace(/[\s-]/g, '').match(/\d{3,10}/);
      if (!m) return askLicense(clientId, [copy.licenseInvalid]);
      await saveBrokerLicense(clientId, m[0]);
      await save(clientId, 'CONSENT', a);
      return askConsent(clientId, [copy.licenseSaved(m[0])]);
    }
    case 'CONSENT': {
      const yes = t === copy.consentYes || /^(?:כן|מאשר|בטח)$/.test(t), no = t === copy.consentNo || /^(?:לא|לא תודה)$/.test(t);
      if (!yes && !no) return null;
      await db.query('UPDATE onboarding_state SET alerts_consent=$2,alerts_consent_at=NOW(),updated_at=NOW() WHERE client_id=$1', [clientId, yes]);
      const lead = [yes ? copy.consentSaved : copy.consentDeclined];
      if (await require('./scopedAuthority').getAgreement(clientId).catch(() => null)) return toSampleAndMeta(clientId, a, lead, options);
      await save(clientId, 'AGREEMENT', a);
      return askAgreement(clientId, a, lead);
    }
    case 'AGREEMENT': {
      let lead;
      if (t === copy.agreementDefaults) {
        try {
          const authority = require('./scopedAuthority');
          await authority.withWhatsAppOwner(clientId, () => authority.setAgreement(clientId, { monthlyCeiling: a.daily * 30, maxDailyPerCampaign: a.daily, allow: { ...require('./workAgreement').PRESETS.protect } }));
          lead = [copy.agreementSaved];
        } catch { lead = [copy.agreementFailed]; }
      } else if (t === copy.agreementCustom) lead = [copy.agreementCustomHint];
      else if (t === copy.agreementLater) lead = [copy.agreementSkipped];
      else return null;
      return toSampleAndMeta(clientId, a, lead, options);
    }
    case 'META': {
      if (t === copy.metaLater) return plain(copy.metaLaterReply);
      if (t === copy.metaNoAccount) return plain(require('./metaConversation').noAccountGuide());
      if (t !== copy.metaConnect) return null;
      const r = await require('./metaConversation').offer(clientId, options.eventId || null);
      return { text: r.reply, historyReply: r.historyReply, leadTexts: [], media: [], decisionKey: r.decisionKey || null };
    }
    default: return null;
  }
}

// ---------- progress for the dashboard: "X מתוך 5" ----------
async function progress(clientId) {
  const row = await state(clientId);
  const p = await require('./marketingStore').load(clientId).catch(() => null);
  const c = (await db.query(`SELECT c.meta_ad_account_id IS NOT NULL AND EXISTS(SELECT 1 FROM meta_connections m WHERE m.client_id=c.id AND m.expires_at>NOW()) AS meta,
    EXISTS(SELECT 1 FROM action_plans a WHERE a.client_id=c.id AND a.intent IN ('CREATE_BUNDLE','CREATE_CAMPAIGN') AND a.status IN ('APPROVED','VERIFIED')) AS campaign
    FROM clients c WHERE c.id=$1`, [clientId])).rows[0] || {};
  const agreement = await require('./scopedAuthority').getAgreement(clientId).catch(() => null);
  const done = {
    business: !!(row?.answers?.confirmedAt || (p && (facts().value(p, 'businessType') || facts().value(p, 'product')))),
    sample: !!(row?.answers?.sampleAt || p?.journey?.draft),
    meta: !!c.meta, agreement: !!agreement, campaign: !!c.campaign
  };
  const steps = Object.entries(copy.progressSteps).map(([id, title]) => ({ id, title, done: done[id] }));
  const count = steps.filter((s) => s.done).length;
  return { enabled: enabled(), steps, done: count, total: steps.length, title: count === steps.length ? copy.progressDone : copy.progressTitle(count, steps.length),
    continueLabel: copy.progressContinue, tour: copy.tour, tourLabels: { open: copy.tourButton, skip: copy.tourSkip, next: copy.tourNext, done: copy.tourDone }, tourSeen: !!row?.tour_seen_at };
}
async function tourSeen(clientId) {
  await db.query(`INSERT INTO onboarding_state(client_id,step,tour_seen_at,completed_at) VALUES($1,'DONE',NOW(),NOW())
    ON CONFLICT(client_id) DO UPDATE SET tour_seen_at=NOW(),updated_at=NOW()`, [clientId]);
  return { ok: true };
}

// ---------- follow-ups: day 1 / 3 / 7 / 12 ----------
function followupFor(day, pr) {
  const f = copy.followups[day];
  if (day === 1) return pr.done < pr.total ? { text: f.unfinished, buttons: [{ title: copy.followupContinue, text: 'להמשיך' }] } : { text: f.finished };
  if (day === 3) {
    if (!pr.steps.find((s) => s.id === 'meta').done) return { text: f.noMeta, buttons: [{ title: copy.followupMeta, text: copy.metaConnect }] };
    if (!pr.steps.find((s) => s.id === 'campaign').done) return { text: f.noCampaign, buttons: [{ title: copy.followupCampaign, text: 'המשך ליצירת הקמפיין' }] };
    return { text: f.ok };
  }
  if (day === 7) return { text: f.any, buttons: [{ title: 'דוח עסקי', text: 'דוח עסקי' }, { title: 'מה עשית השבוע', text: 'מה עשית השבוע' }] };
  if (day === 12) return { text: f.any, buttons: [{ title: 'יותר לידים', text: 'יותר לידים' }, { title: 'לידים טובים יותר', text: 'לידים טובים יותר' }, { title: 'פחות עבודה ידנית', text: 'פחות עבודה ידנית' }] };
  return { text: f.any };
}
async function runDue({ now = new Date(), send } = {}) {
  if (!enabled() || !db.configured()) return { status: 'DISABLED' };
  if (!send && !require('./leadCheckins').businessHours(now)) return { status: 'NOT_DUE' };
  const rows = (await db.query(`SELECT o.client_id,o.started_at,o.followups_sent,c.phone FROM onboarding_state o JOIN clients c ON c.id=o.client_id
    WHERE o.started_at>$1::timestamptz-INTERVAL '13 days' AND o.alerts_consent IS NOT FALSE ORDER BY o.started_at LIMIT 200`, [now.toISOString()])).rows;
  const results = [];
  for (const r of rows) {
    const age = (now - new Date(r.started_at)) / 86400000;
    // Only the follow-up whose day has come and not yet passed by a full day (no stale catch-up messages).
    const day = [12, 7, 3, 1].find((d) => age >= d && age < d + 1 && !(r.followups_sent || []).includes(String(d)));
    if (!day) continue;
    try {
      if (!send && await require('./leadCheckins').ownerBusy(r.client_id)) { results.push('BUSY'); continue; }
      const claim = await db.query("UPDATE onboarding_state SET followups_sent=array_append(followups_sent,$2),updated_at=NOW() WHERE client_id=$1 AND NOT ($2=ANY(followups_sent)) RETURNING client_id", [r.client_id, String(day)]);
      if (!claim.rows.length) continue;
      const msg = followupFor(day, await progress(r.client_id));
      if (send) await send(r, day, msg);
      else await require('./metaConnection').context.run(String(r.client_id), () => require('./whatsappDelivery').messageContext.run({ eventId: `onboarding-followup:${r.client_id}:${day}`, sequence: 0 }, async () => {
        const ui = msg.buttons ? await require('./conversationUi').prepareChoices(r.client_id, msg.text, msg.buttons, DECISION) : { text: msg.text };
        await require('./whatsapp').safeSend(r.phone, ui.text, ui);
      }));
      results.push({ clientId: r.client_id, day });
    } catch (error) {
      require('./logger').logger.warn('Onboarding follow-up skipped', { error: /^[A-Z_]+$/.test(error?.message) ? error.message : 'FOLLOWUP_FAILED' });
      results.push('FAILED');
    }
  }
  return { status: 'RAN', results };
}

// The Meta OAuth finished during onboarding: the first campaign is next (existing paused flow).
function afterMetaConnected(p) { return enabled() && p?.onboardingV2?.step === 'META' ? copy.campaignReady : null; }

module.exports = { enabled, reset, STEPS, DECISION, state, start, handleText, progress, tourSeen, runDue, followupFor, alertsDeclined, afterMetaConnected, sample, linkIn };
