'use strict';
// Experience wave: onboarding V2, undo (24h), sign-in with a WhatsApp code, "בבדיקה" registry.
// Tests share one Postgres in CI: unique phone numbers, every assertion scoped to our client_id.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { openDatabase } = require('./helpers/isolatedDatabase');
const copy = require('../onboardingCopy');

const phone = () => '97258' + String(crypto.randomInt(0, 10_000_000)).padStart(7, '0');
const withEnv = async (vars, work) => {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await work(); } finally { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test('onboarding wording: one module, buttons fit WhatsApp, singular and honest', () => {
  const titles = [copy.noLinkButton, copy.sellOtherButton, ...Object.values(copy.goals).map((g) => g.button), ...[50, 100, 150].map(copy.budgetButton),
    copy.summaryYes, copy.summaryFix, copy.consentYes, copy.consentNo, copy.agreementDefaults, copy.agreementCustom, copy.agreementLater,
    copy.metaConnect, copy.metaNoAccount, copy.metaLater, copy.followupContinue, copy.followupMeta, copy.followupCampaign, ...Object.values(copy.sellSuggestions).flat()];
  for (const t of titles) assert.ok(t.length <= 20, 'button too long: ' + t);
  assert.match(copy.intro, /מנהל לך את הפרסום/); assert.match(copy.intro, /בלי האישור שלך/);
  assert.equal(copy.tour.length, 5);
  assert.match(copy.progressTitle(2, 5), /2 מתוך 5/);
  assert.doesNotMatch(Object.values(copy).filter((v) => typeof v === 'string').join(' '), /שלחו|לחצו|תבחרו/, 'singular masculine');
});

test('dashboard link: flexible phrases, nothing else', () => {
  const link = require('../dashboardLink');
  for (const t of ['שלח לי קישור לדשבורד', 'תשלח לי לינק לדשבורד', 'אפשר קישור לדשבורד?', 'איך נכנסים לדשבורד?', 'אני רוצה להיכנס לחשבון שלי', 'קישור לדשבורד בבקשה', 'דשבורד לידים'])
    assert.ok(link.request(t), t);
  for (const t of ['שלח לי קישור', 'שלח לי קישור לחיבור Meta', 'תכין לי קמפיין לדשבורד']) assert.equal(link.request(t), null, t);
});

test('experience flows on the database', async (t) => {
  const { db, close } = await openDatabase();
  try {
    await withEnv({ ONBOARDING_V2_ENABLED: 'true', APP_PUBLIC_URL: 'https://example.test/' }, async () => {
      const onboarding = require('../onboarding');

      await t.test('0 → sample ad → Meta: link, 3 button questions, card, consent, agreement defaults', async () => {
        const id = (await db.query('INSERT INTO clients(phone) VALUES($1) RETURNING id', [phone()])).rows[0].id;
        const run = (text, extra = {}) => require('../metaConnection').context.run(String(id), () => require('../whatsappDelivery').messageContext.run({ eventId: 'ob-' + crypto.randomUUID(), sequence: 0 }, () => onboarding.handleText(id, text, extra)));
        assert.equal(await run('מה המצב עם הקמפיין שלי'), null, 'only a greeting / start / link opens onboarding');
        const intro = await run('היי');
        assert.match(intro.leadTexts[0], /אני הסוכן של SCORPIO/);
        assert.equal(intro.interactivePayload.interactive.action.buttons[0].reply.title, copy.noLinkButton);
        const inspect = async (url) => ({ source: url, facts: { businessName: 'תיווך הגבעה', businessType: 'משרד תיווך נדל"ן בגבעתיים' }, brand: { images: [] } });
        const sell = await run('https://hagiva.example.co.il', { inspect });
        assert.match(sell.leadTexts[0], /קראתי את העמוד של תיווך הגבעה/);
        assert.deepEqual(sell.interactivePayload.interactive.action.buttons.map((b) => b.reply.title), ['גיוס בעלי נכסים', 'נכס למכירה/השכרה', copy.sellOtherButton]);
        assert.match((await run('דירה למכירה')).text, /איך הכי נכון שלקוחות יפנו אליך[\s\S]*ההמלצה שלי/);
        assert.match((await run(copy.goals.LEADS.button)).text, /מה התקציב היומי/);
        const card = await run(copy.budgetButton(100));
        assert.match(card.text, /ההמלצה שלי לקמפיין הראשון/);
        assert.match(card.text, /תקציב יומי: 100 ₪ \(כ־3,000 ₪ בחודש\)/);
        // Value first: the sample ad comes right after the card; brokers are then asked for the license number.
        const lic = await run(copy.summaryYes, { makeImage: async () => ({ id: 'wa-media-1' }) });
        assert.match(lic.leadTexts[0], /מודעה לדוגמה/);
        assert.match(lic.leadTexts[0], /שום דבר לא עלה לאוויר/);
        assert.deepEqual(lic.media, [{ id: 'wa-media-1', caption: copy.sampleImageCaption }]);
        assert.match(lic.text, /רישיון התיווך/);
        assert.match((await run('12')).leadTexts[0], /3 עד 10 ספרות/);
        const consent = await run('רישיון 1234567');
        assert.equal(consent.leadTexts[0], copy.licenseSaved('1234567'));
        assert.match(consent.text, /אשלח לך לכאן מיד/);
        assert.equal((await require('../marketingStore').load(id)).brokerLicense, '1234567');
        const p = await require('../marketingStore').load(id), facts = require('../conversationFacts');
        assert.equal(facts.value(p, 'product'), 'דירה למכירה');
        assert.deepEqual(facts.value(p, 'dailyBudget'), { amount: 100, currency: 'ILS', period: 'day' });
        const item = (await db.query('SELECT vertical,attributes FROM catalog_items WHERE client_id=$1', [id])).rows[0];
        assert.equal(item.vertical, 'real_estate');
        assert.equal(item.attributes.dealType, 'SALE');
        const agreement = await run(copy.consentNo);
        assert.match(agreement.leadTexts[0], /לידים חדשים יחכו לך בדשבורד/);
        assert.equal(await onboarding.alertsDeclined(id), true);
        assert.equal((await require('../leadAlert').notifyOwner(id, { id: crypto.randomUUID(), name: 'דנה' })).status, 'ALERTS_DECLINED');
        assert.match(agreement.text, /מעל 100 ₪ ליום \(תקרה של 3,000 ₪ בחודש\)/);
        const meta = await run(copy.agreementDefaults);
        assert.deepEqual(meta.leadTexts, [copy.agreementSaved], 'the sample ad is not repeated');
        assert.deepEqual(meta.media, []);
        assert.match(meta.text, /נחבר את חשבון הפרסום שלך בפייסבוק ובאינסטגרם/);
        const a = await require('../scopedAuthority').getAgreement(id);
        assert.equal(a.monthlyCeiling, 3000); assert.equal(a.maxDailyPerCampaign, 100);
        assert.equal(a.allow.activateNew, false, 'activation always waits for the owner');
        const after = await require('../marketingStore').load(id);
        assert.equal(after.journey.stage, 'PLAN_REVIEW', 'the existing paused "create campaign" flow continues from here');
        assert.ok(after.journey.draft?.creatives?.length);
        assert.equal(onboarding.afterMetaConnected(after), copy.campaignReady);
        assert.equal((await run(copy.metaLater)).text, copy.metaLaterReply);
        const pr = await onboarding.progress(id);
        assert.equal(pr.total, 5);
        assert.deepEqual(pr.steps.filter((s) => s.done).map((s) => s.id), ['business', 'sample', 'agreement']);
        assert.equal(pr.title, copy.progressTitle(3, 5));
        assert.equal((await run('תשלח לי התראות על לידים')).text, copy.consentOnReply);
        assert.equal(await onboarding.alertsDeclined(id), false);
        // Follow-ups: day 1 once, never twice; scoped to this business.
        await db.query("UPDATE onboarding_state SET started_at=NOW()-INTERVAL '26 hours' WHERE client_id=$1", [id]);
        const sent = [];
        const send = async (r, day, msg) => { if (String(r.client_id) === String(id)) sent.push({ day, msg }); };
        await onboarding.runDue({ send });
        await onboarding.runDue({ send });
        assert.equal(sent.length, 1);
        assert.equal(sent[0].day, 1);
        assert.equal(sent[0].msg.text, copy.followups[1].unfinished);
        await db.query("UPDATE onboarding_state SET started_at=NOW()-INTERVAL '74 hours' WHERE client_id=$1", [id]);
        await onboarding.runDue({ send });
        assert.equal(sent[1].day, 3);
        assert.equal(sent[1].msg.text, copy.followups[3].noMeta);
        assert.equal((await run('דלג על ההיכרות')).text, copy.skip);
        assert.equal(await run('היי'), null, 'finished onboarding never restarts');
      });

      await t.test('onboarding stays out of the way: existing businesses and the flag off', async () => {
        const id = (await db.query('INSERT INTO clients(phone) VALUES($1) RETURNING id', [phone()])).rows[0].id;
        await require('../marketingStore').update(id, null, (p) => { require('../conversationFacts').write(p, 'businessType', 'מספרה'); return { handled: false, changed: true }; });
        assert.equal(await onboarding.handleText(id, 'היי'), null);
        const fresh = (await db.query('INSERT INTO clients(phone) VALUES($1) RETURNING id', [phone()])).rows[0].id;
        await withEnv({ ONBOARDING_V2_ENABLED: 'false' }, async () => assert.equal(await onboarding.handleText(fresh, 'היי'), null));
        // A first message that is already the link: the intro still comes first.
        const linkFirst = await onboarding.handleText(fresh, 'https://shop.example.co.il', { inspect: async (url) => ({ source: url, facts: { businessName: 'החנות', businessType: 'חנות בגדים' }, brand: {} }) });
        assert.match(linkFirst.leadTexts[0], /אני הסוכן של SCORPIO/);
        assert.match(linkFirst.leadTexts[1], /קראתי את העמוד של החנות/);
        // Onboarding waiting at META for a business that is already connected ends quietly; the agent answers.
        const connected = (await db.query('INSERT INTO clients(phone,meta_ad_account_id) VALUES($1,$2) RETURNING id', [phone(), 'act_77'])).rows[0].id;
        await db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,'u','x','1',NOW()+INTERVAL '1 hour')", [connected]);
        await db.query("INSERT INTO onboarding_state(client_id,step,answers) VALUES($1,'META','{}'::jsonb)", [connected]);
        assert.equal(await onboarding.handleText(connected, 'נמשיך'), null);
        assert.ok((await onboarding.state(connected)).completed_at, 'onboarding marked done');
        await onboarding.reset(fresh);
        assert.equal(await onboarding.state(fresh), null, 'reset starts onboarding over');
        // An existing customer with past work (here: a task) never gets the first-time intro again.
        const veteran = (await db.query('INSERT INTO clients(phone) VALUES($1) RETURNING id', [phone()])).rows[0].id;
        await db.query("INSERT INTO agent_tasks(id,client_id,request,status,revision,state) VALUES($1,$2,'קמפיין','CANCELLED',1,'{}'::jsonb)", [crypto.randomUUID(), veteran]);
        assert.equal(await onboarding.handleText(veteran, 'היי'), null);
        // Free-text answers: understood when possible, otherwise asked again (never handed to another agent).
        const words = (await db.query('INSERT INTO clients(phone) VALUES($1) RETURNING id', [phone()])).rows[0].id;
        await onboarding.handleText(words, 'היי');
        await onboarding.handleText(words, 'משרד תיווך בחולון');
        await onboarding.handleText(words, 'דירות 4 חדרים');
        assert.equal((await onboarding.state(words)).step, 'GOAL');
        const unclear = await onboarding.handleText(words, 'משהו אחר לגמרי');
        assert.ok(unclear, 'unclear goal answer is re-asked, not dropped');
        assert.equal((await onboarding.state(words)).step, 'GOAL');
        assert.equal(await onboarding.handleText(words, 'כמה זה עולה?'), null, 'a question still reaches the agent');
        await onboarding.handleText(words, 'שיתקשרו אליי או ישאירו פרטים');
        const after = await onboarding.state(words);
        assert.equal(after.step, 'BUDGET');assert.equal(after.answers.goal, 'LEADS');
        assert.ok(await onboarding.handleText(words, 'לא יודע'), 'unclear budget is re-asked');
        assert.equal((await onboarding.state(words)).step, 'BUDGET');
      });

      await t.test('login code: no enumeration, 10-minute single use, wrong tries burn the code', async () => {
        const lc = require('../loginCode');
        const known = phone(), id = (await db.query('INSERT INTO clients(phone) VALUES($1) RETURNING id', [known])).rows[0].id;
        let code = null;
        const send = async (_c, c) => { code = c; };
        const unknown = await lc.request(phone(), { send });
        const real = await lc.request('0' + known.slice(3), { send });
        assert.deepEqual(unknown, real, 'the same answer for customers and strangers');
        assert.match(code, /^\d{6}$/);
        const rows = await db.query('SELECT code_hash FROM portal_login_codes WHERE client_id=$1', [id]);
        assert.equal(rows.rows.length, 1); assert.ok(!rows.rows[0].code_hash.includes(code), 'only a hash is stored');
        const wrong = code === '000000' ? '111111' : '000000';
        await assert.rejects(lc.verify(known, wrong), /INVALID_LOGIN_CODE/);
        const ok = await lc.verify(known, code);
        assert.equal(String(ok.clientId), String(id)); assert.match(ok.session, /^[a-f0-9]{64}$/);
        await assert.rejects(lc.verify(known, code), /INVALID_LOGIN_CODE/, 'single use');
        await lc.request(known, { send });
        for (let i = 0; i < lc.MAX_TRIES; i++) await assert.rejects(lc.verify(known, code === '000000' ? '222222' : '000000'));
        await assert.rejects(lc.verify(known, code), /INVALID_LOGIN_CODE/, 'burned after too many wrong tries');
        await lc.request(known, { send });
        await db.query("UPDATE portal_login_codes SET expires_at=NOW()-INTERVAL '1 second' WHERE client_id=$1 AND used_at IS NULL", [id]);
        await assert.rejects(lc.verify(known, code), /INVALID_LOGIN_CODE/, 'expired');
        code = null; await lc.request(known, { send });
        assert.equal(code, null, 'rate limited: at most 3 codes per number per 15 minutes');
      });

      await t.test('undo: 24 hours, spending again always needs approval, one undo per action', async () => {
        const undo = require('../undoActions');
        const id = (await db.query('INSERT INTO clients(phone) VALUES($1) RETURNING id', [phone()])).rows[0].id;
        const plan = (pid, intent, extra = {}) => ({ id: pid, intent, summary: 'x', target: { accountId: 'act_1', campaignId: '123', campaignName: 'דירות בגבעתיים' }, parameters: {}, ...extra });
        const ins = (p, ago = '1 hour') => db.query(`INSERT INTO action_plans(id,client_id,intent,payload,status,updated_at) VALUES($1,$2,$3,$4::jsonb,'VERIFIED',NOW()-$5::interval)`, [p.id, id, p.intent, JSON.stringify(p), ago]);
        const sfx = crypto.randomBytes(3).toString('hex').toUpperCase();
        await ins(plan('PAUSE' + sfx, 'PAUSE_CAMPAIGN'));
        await ins(plan('RAISE' + sfx, 'CHANGE_BUDGET', { parameters: { dailyBudget: '100' }, review: { currentDailyBudgetMinor: 5000 } }), '2 hours');
        await ins(plan('LOWER' + sfx, 'CHANGE_BUDGET', { parameters: { dailyBudget: '50' }, review: { currentDailyBudgetMinor: 10000 } }), '3 hours');
        await ins(plan('OLD' + sfx, 'PAUSE_CAMPAIGN'), '25 hours');
        assert.deepEqual((await undo.list(id)).map((x) => x.actionId), ['PAUSE' + sfx, 'RAISE' + sfx, 'LOWER' + sfx]);
        assert.equal((await undo.undo(id, 'OLD' + sfx)).reason, 'EXPIRED');
        const items = await require('../activityLog').list(id, { days: 2 });
        assert.equal(items.find((x) => x.actionId === 'PAUSE' + sfx).undo.label, copy.undoButton);
        assert.equal(items.find((x) => x.actionId === 'OLD' + sfx).undo, null);

        // No Meta connection: the approval cannot be prepared; nothing is claimed, the owner is told why.
        const failed = await undo.undo(id, 'PAUSE' + sfx);
        assert.equal(failed.ok, false); assert.match(failed.text, /Meta/);
        assert.equal((await db.query('SELECT 1 FROM undo_actions WHERE client_id=$1', [id])).rows.length, 0);

        const engine = require('../approvalEngine'), work = require('../workAgreement');
        const origCreate = engine.createApprovalForClient, origAct = work.proposeOrAct, calls = [];
        engine.createApprovalForClient = async (_cid, input) => { calls.push(['approval', input]); return { actionId: 'U' + crypto.randomBytes(4).toString('hex'), actionPlan: input, code: '123456', expiresAt: new Date(Date.now() + 600000) }; };
        work.proposeOrAct = async (_cid, input) => { calls.push(['agreement', input]); return { autonomous: true, ok: true, actionId: 'A' + crypto.randomBytes(4).toString('hex') }; };
        try {
          const resume = await undo.undo(id, 'PAUSE' + sfx);
          assert.equal(resume.mode, 'approval'); assert.equal(resume.spending, true);
          assert.equal(calls[0][1].intent, 'RESUME_CAMPAIGN'); assert.equal(calls[0][1].undoOf, 'PAUSE' + sfx);
          assert.match(resume.text, /תמיד מחכה לאישור שלך/);
          assert.equal((await undo.undo(id, 'PAUSE' + sfx)).reason, 'ALREADY');
          const back = await undo.undo(id, 'RAISE' + sfx);
          assert.equal(calls[1][0], 'agreement', 'lowering the budget back is protective: the work agreement decides');
          assert.equal(calls[1][1].parameters.dailyBudget, '50');
          assert.equal(back.mode, 'auto'); assert.equal(back.text, copy.undoDoneAuto);
          // WhatsApp: the only one left is raising the budget back, which is spending → approval.
          const wa = await undo.handleText(id, 'החזר למצב הקודם');
          assert.equal(calls[2][0], 'approval'); assert.equal(calls[2][1].parameters.dailyBudget, '100');
          assert.equal(wa.mode, 'approval');
          assert.match((await undo.handleText(id, 'החזר למצב הקודם')).text, /אין כרגע פעולה שאפשר להחזיר/);
          assert.equal(await undo.handleText(id, 'החזר 2'), null, 'no list was shown: not ours');
        } finally { engine.createApprovalForClient = origCreate; work.proposeOrAct = origAct; }
      });

      await t.test('"בבדיקה": honest seed, badge and once-a-day agent wording', async () => {
        const caps = require('../capabilityStatus');
        const list = await caps.list();
        for (const key of ['organic_content', 'buyer_audiences', 'lead_concierge', 'catalog']) {
          const c = list.find((x) => x.key === key);
          assert.equal(c.verified, false, key); assert.equal(c.badge, 'בבדיקה');
        }
        const id = (await db.query('INSERT INTO clients(phone) VALUES($1) RETURNING id', [phone()])).rows[0].id;
        const once = await caps.decorate('organic_content', 'הנה לוח התוכן', id);
        assert.match(once, /חדש, בבדיקה/);
        assert.equal(await caps.decorate('organic_content', 'הנה לוח התוכן', id), 'הנה לוח התוכן', 'once a day per business');
        const key = 'test_cap_' + crypto.randomBytes(3).toString('hex');
        await caps.mark(key, true);
        assert.equal(await caps.decorate(key, 'עובד', id), 'עובד', 'verified capabilities are worded normally');
        assert.match(await caps.testingLine(), /^חדש, בבדיקה: /);
        const pr = await onboarding.progress(id);
        assert.equal(pr.done, 0); assert.equal(pr.tourSeen, false);
        await onboarding.tourSeen(id);
        assert.equal((await onboarding.progress(id)).tourSeen, true);
      });
    });
  } finally { await close(); }
});

test('HTTP: sign in with a WhatsApp code, then progress, badges and undo in the dashboard', async () => {
  const { db, close } = await openDatabase();
  const env = { ...process.env };
  Object.assign(process.env, { APP_PUBLIC_URL: 'https://campaign.example', ONBOARDING_V2_ENABLED: 'true' });
  const app = require('../index');
  const server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); s.once('error', reject); });
  const root = 'http://127.0.0.1:' + server.address().port;
  const call = (path, body, cookie = '', csrf = '') => fetch(root + path, { method: body ? 'POST' : 'GET', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { Origin: 'https://campaign.example', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    const known = phone(), id = (await db.query('INSERT INTO clients(phone) VALUES($1) RETURNING id', [known])).rows[0].id;
    assert.equal((await call('/app/experience.js')).status, 200);
    const a = await (await call('/app/api/login/code/request', { phone: known })).json();
    const b = await (await call('/app/api/login/code/request', { phone: phone() })).json();
    assert.deepEqual(a, b, 'no account enumeration');
    const sent = (await db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1', [id])).rows.map((r) => r.payload.text?.body || '').find((t) => /קוד הכניסה/.test(t));
    const code = sent.match(/\d{6}/)[0];
    assert.equal((await call('/app/api/login/code/verify', { phone: known, code: code === '999999' ? '000000' : '999999' })).status, 401);
    const login = await call('/app/api/login/code/verify', { phone: known, code });
    assert.equal(login.status, 200);
    const cookies = login.headers.getSetCookie(), cookie = cookies.map((s) => s.split(';')[0]).join('; '), csrf = cookies.find((s) => s.startsWith('cb_csrf=')).split(';')[0].split('=')[1];
    assert.ok(cookies[0].includes('HttpOnly'));
    const xp = await (await call('/app/api/experience', null, cookie)).json();
    assert.equal(xp.progress.total, 5); assert.equal(xp.progress.enabled, true);
    assert.ok(xp.capabilities.find((c) => c.key === 'catalog').titles.includes('מה העסק מוכר?'));
    const u = await (await call('/app/api/activity/NOPE123/undo', {}, cookie, csrf)).json();
    assert.equal(u.ok, false); assert.equal(u.reply, copy.undoNotFound);
    assert.equal((await call('/app/api/experience/tour-seen', {}, cookie, csrf)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve)); await close();
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
  }
});
