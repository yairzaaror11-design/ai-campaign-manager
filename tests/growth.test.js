'use strict';
// Growth: funnels per business type, deal value in the business's terms, team routing,
// and the after-sale loop. Shared CI database: every assertion is scoped to this test's client.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { openDatabase } = require('./helpers/isolatedDatabase');
const growth = require('../growth');
const vp = require('../verticalProfiles');

const uniq = () => String(crypto.randomInt(1000000, 9999999));
const phone = () => '97250' + uniq();
async function business(db, vertical, { open = true } = {}) {
  const owner = phone();
  const clientId = (await db.query("INSERT INTO clients(phone,display_name) VALUES($1,'דני') RETURNING id", [owner])).rows[0].id;
  if (open) await db.query('INSERT INTO whatsapp_contacts(phone,last_inbound_at) VALUES($1,NOW()) ON CONFLICT(phone) DO UPDATE SET last_inbound_at=NOW()', [owner]);
  await vp.choose(clientId, vertical);
  return { clientId, owner };
}
const crm = () => require('../crmService');
const newLead = (clientId, extra = {}) => crm().create(clientId, { name: 'רונית לוי', phone: '05' + uniq().slice(0, 8), source: 'meta_lead_ads', sourceEventId: 'g-' + uniq() + Date.now(), ...extra });
const outboxTo = async (db, clientId, recipient) => (await db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1 AND recipient=$2 ORDER BY delivery_order', [clientId, recipient])).rows.map((r) => r.payload);
const bodyOf = (p) => p.text?.body || p.interactive?.body?.text || '';
const inbound = (from, body) => ({ id: 'wamid.g' + uniq() + Date.now(), from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } });

test('every business type has funnels; real estate has buyers, renters, sellers and landlords', () => {
  for (const key of vp.KEYS) assert.ok(vp.get(key).funnels.length >= 1, key);
  assert.deepEqual(vp.get('real_estate').funnels.map((f) => f.key), ['buyers', 'renters', 'sellers', 'landlords']);
  assert.match(growth.funnel('real_estate', 'sellers').hook, /כמה שווה הדירה שלך/);
  assert.deepEqual(vp.get('services').funnels.map((f) => f.key), ['quote', 'urgent']);
  assert.deepEqual(vp.get('retail').funnels.map((f) => f.key), ['purchase', 'back_in_stock']);
  assert.deepEqual(vp.get('fitness').funnels.map((f) => f.key), ['trial']);
  assert.deepEqual(vp.get('generic').funnels.map((f) => f.key), ['inquiry']);
  const rent = { vertical: 'real_estate', kind: 'APARTMENT', title: '', price: 6500, attributes: { dealType: 'RENT', city: 'גבעתיים', rooms: 3, licenseNumber: '314159' } };
  assert.equal(growth.itemFunnel(rent), 'renters');
  assert.equal(growth.itemFunnel({ ...rent, attributes: { ...rent.attributes, dealType: 'SALE' } }), 'buyers');
  assert.equal(growth.itemFunnel({ vertical: 'retail', status: 'SOLD_OUT', attributes: {} }), 'back_in_stock');
  // Lead forms ask the funnel's questions, in the shape Meta accepts.
  for (const [v, f] of [['real_estate', 'sellers'], ['real_estate', 'renters'], ['services', 'urgent'], ['fitness', 'trial'], ['generic', 'inquiry']]) {
    const questions = growth.formQuestions(v, f);
    assert.doesNotThrow(() => require('../metaLeadForms').validate({ pageId: '123', name: 'טופס', locale: 'HE_IL', privacyPolicyUrl: 'https://example.com/privacy', questions }), `${v}/${f}`);
  }
  assert.ok(growth.formQuestions('real_estate', 'sellers').some((q) => q.label === 'מתי אתם חושבים למכור?'));
  const brief = require('../catalog').campaignBrief(rent);
  assert.match(brief, /משפך: שוכרים לנכס/); assert.match(brief, /התקציב החודשי לשכירות/); assert.match(brief, /HOUSING/);
});

test('deal value is asked and computed in the business terms', () => {
  const s = { commission_pct: 2, rent_commission_pct: 100 };
  const sale = growth.dealTerms('real_estate', { funnel: 'buyers' }, s);
  assert.equal(sale.commission, true); assert.equal(sale.defaultPct, 2); assert.match(sale.question, /מחיר העסקה/); assert.match(sale.question, /2%/);
  assert.deepEqual(growth.parseDeal('2.9 מיליון', sale), { priceMinor: 290000000, commissionPct: 2, revenueMinor: 5800000 });
  assert.deepEqual(growth.parseDeal('2,900,000 1.5%', sale), { priceMinor: 290000000, commissionPct: 1.5, revenueMinor: 4350000 });
  const rent = growth.dealTerms('real_estate', { funnel: 'renters' }, s);
  assert.equal(rent.kind, 'RENT'); assert.match(rent.question, /שכר הדירה החודשי/);
  assert.equal(growth.parseDeal('6500', rent).revenueMinor, 650000, 'default rent commission = one month');
  const svc = growth.dealTerms('services', {}, s);
  assert.equal(svc.commission, false); assert.match(svc.question, /כמה עלתה העבודה/);
  assert.equal(growth.parseDeal('1,200', svc).revenueMinor, 120000);
  assert.match(growth.dealTerms('retail', {}, s).question, /סכום ההזמנה/);
  assert.equal(growth.parseDeal('כמה זה?', svc), null);
  assert.equal(growth.parseDeal('שלום', svc), null);
});

test('growth end to end on one database', async (t) => {
  const { db, close } = await openDatabase();
  try {
    await t.test('a real-estate deal counts the commission as revenue, so the report bottom line is right', async () => {
      const { clientId } = await business(db, 'real_estate');
      const lead = await newLead(clientId);
      assert.equal(lead.funnel, 'buyers', 'every lead carries a funnel');
      const won = await growth.recordDeal(clientId, lead.id, { price: 2900000 });
      assert.equal(won.deal.revenueMinor, 5800000);
      assert.match(won.text, /עמלה 2% = 58,000 ₪/);
      const row = (await db.query('SELECT status,revenue_minor,deal_value_minor,commission_pct,closed_at FROM crm_leads WHERE client_id=$1 AND id=$2', [clientId, lead.id])).rows[0];
      assert.equal(row.status, 'WON'); assert.equal(Number(row.revenue_minor), 5800000); assert.equal(Number(row.deal_value_minor), 290000000); assert.equal(Number(row.commission_pct), 2); assert.ok(row.closed_at);
      const report = require('../businessReport');
      const text = report.format(await report.build(clientId, 'last_7d', { spendFor: async () => 10000 }));
      assert.match(text, /נשאר לך ₪48,000 אחרי הפרסום/);
      // Editable default.
      await growth.saveSettings(clientId, { commissionPct: 1.5 });
      const second = await newLead(clientId);
      assert.equal((await growth.recordDeal(clientId, second.id, { text: '2 מיליון' })).deal.revenueMinor, 3000000);
      await assert.rejects(growth.saveSettings(clientId, { commissionPct: 150 }), /INVALID_GROWTH_SETTINGS/);
    });

    await t.test('closing a lead on WhatsApp asks the value in the profile terms', async () => {
      const { clientId } = await business(db, 'real_estate');
      await newLead(clientId);
      const chat = require('../crmConversation');
      await chat.handle(clientId, 'הפניות שלי'); await chat.handle(clientId, 'פתח פנייה 1');
      const won = await chat.handle(clientId, 'סמן שנסגרה עסקה');
      assert.match(won.reply, /מה מחיר העסקה\? ובכמה עמלה\?/);
      const saved = await chat.handle(clientId, '2.9 מיליון 1.5%');
      assert.match(saved.reply, /עמלה 1.5% = 43,500 ₪/);
      const lead = (await db.query('SELECT revenue_minor FROM crm_leads WHERE client_id=$1', [clientId])).rows[0];
      assert.equal(Number(lead.revenue_minor), 4350000);
    });

    await t.test('a seller funnel campaign is prepared through the task flow and its leads carry the funnel', async () => {
      const { clientId } = await business(db, 'real_estate');
      const blocked = await growth.prepareFunnelCampaign(clientId, 'sellers', { send: async () => ({ reply: 'x' }) });
      assert.equal(blocked.blocked, 'LICENSE_MISSING', 'real-estate ads need the broker license');
      await require('../marketingStore').update(clientId, null, (p) => { p.brokerLicense = '3141592'; return { handled: false, changed: true }; });
      let sent = null;
      const r = await growth.prepareFunnelCampaign(clientId, 'sellers', { send: async (message) => { sent = message; return { reply: 'התחלתי להכין טיוטה.' }; } });
      assert.equal(r.funnel, 'sellers');
      assert.match(sent, /כמה שווה הדירה שלך/); assert.match(sent, /רישיון תיווך מס' 3141592/); assert.match(sent, /מתי אתם חושבים למכור/);
      const s = await growth.suggest(clientId);
      assert.equal(s.funnels.find((f) => f.key === 'sellers').used, true);
      assert.notEqual(s.recommended, 'sellers', 'the next suggestion is a funnel not run yet');
      await growth.rememberCampaign(clientId, { campaignId: '120000000000777', funnel: 'sellers' });
      const lead = await newLead(clientId, { campaignId: '120000000000777' });
      assert.equal(lead.funnel, 'sellers');
      assert.equal((await growth.termsFor(clientId, lead.id)).kind, 'SALE');
      assert.equal((await growth.dealTerms('real_estate', { funnel: 'landlords' }, await growth.settings(clientId))).kind, 'RENT');
    });

    await t.test('new leads are routed round-robin; members get them on WhatsApp only after joining', async () => {
      const { clientId } = await business(db, 'real_estate');
      const a = await growth.addMember(clientId, { name: 'אבי', phone: '05' + uniq().slice(0, 8), areas: 'גבעתיים, רמת גן' });
      const b = await growth.addMember(clientId, { name: 'בתיה', phone: '05' + uniq().slice(0, 8), areas: ['תל אביב'] });
      assert.deepEqual(a.areas, ['גבעתיים', 'רמת גן']); assert.equal(a.notifications, 'WAITING'); assert.match(a.joinCode, /^\d{6}$/);
      const before = await newLead(clientId);
      assert.equal(before.assigned_member_id, null, 'routing is off until the owner turns it on');
      await growth.saveSettings(clientId, { routing: 'ROUND_ROBIN' });
      const l1 = await newLead(clientId), l2 = await newLead(clientId), l3 = await newLead(clientId);
      assert.deepEqual([l1, l2, l3].map((l) => l.assigned_member_id), [a.id, b.id, a.id]);
      assert.equal((await outboxTo(db, clientId, a.phone)).length, 0, 'not opted in: nothing is sent to the member');
      // The member opts in himself by writing the join code.
      assert.equal(await growth.routeInbound(inbound(a.phone, 'הצטרפות ' + b.joinCode)), false, 'another member code does not work');
      assert.equal(await growth.routeInbound(inbound(a.phone, 'הצטרפות ' + a.joinCode)), true);
      assert.match(bodyOf((await outboxTo(db, clientId, a.phone)).at(-1)), /מעכשיו תקבל כאן לידים/);
      await newLead(clientId); // → b
      const l5 = await newLead(clientId); // → a
      assert.equal(l5.assigned_member_id, a.id);
      const toA = (await outboxTo(db, clientId, a.phone)).map(bodyOf);
      assert.ok(toA.some((x) => /ליד חדש בשבילך/.test(x) && /wa\.me/.test(x)), 'opted-in member gets the lead');
      assert.equal((await outboxTo(db, clientId, b.phone)).length, 0);
      // Per-member mini report; the owner sees everything.
      await crm().update(clientId, l1.id, { status: 'CONTACTED', version: l1.version });
      const r = await growth.teamReport(clientId);
      assert.deepEqual(r.members.map((m) => [m.name, m.leads, m.handled]), [['אבי', 3, 1], ['בתיה', 2, 0]]);
      assert.equal(r.unassigned, 1);
      assert.match(await growth.teamReportText(clientId), /אבי: 3 לידים, 1 טופלו/);
      assert.equal(await growth.routeInbound(inbound(a.phone, 'הדוח שלי')), true);
      assert.match(bodyOf((await outboxTo(db, clientId, a.phone)).at(-1)), /הדוח שלך/);
      assert.equal(await growth.routeInbound(inbound(a.phone, 'הפסק לידים')), true);
      assert.equal((await growth.members(clientId)).find((m) => m.id === a.id).notifications, 'STOPPED');
    });

    await t.test('area routing sends a lead on a Givatayim property to the Givatayim member', async () => {
      const { clientId } = await business(db, 'real_estate');
      const tlv = await growth.addMember(clientId, { name: 'תמר', areas: 'תל אביב' });
      const giv = await growth.addMember(clientId, { name: 'גיל', areas: 'גבעתיים' });
      await growth.saveSettings(clientId, { routing: 'AREA' });
      const item = crypto.randomUUID();
      await db.query(`INSERT INTO catalog_items(id,client_id,vertical,kind,title,attributes) VALUES($1,$2,'real_estate','APARTMENT','דירה',$3::jsonb)`, [item, clientId, JSON.stringify({ city: 'גבעתיים', dealType: 'RENT' })]);
      const lead = await crm().create(clientId, { name: 'יעל', phone: '05' + uniq().slice(0, 8), source: 'manual' });
      await db.query('UPDATE crm_leads SET catalog_item_id=$3,funnel=NULL,assigned_member_id=NULL WHERE client_id=$1 AND id=$2', [clientId, lead.id, item]);
      const row = (await db.query('SELECT * FROM crm_leads WHERE id=$1', [lead.id])).rows[0];
      const out = await growth.onLeadCreated(clientId, row);
      assert.equal(out.assigned_member_id, giv.id); assert.equal(out.funnel, 'renters');
      assert.notEqual(out.assigned_member_id, tlv.id);
      await assert.rejects(growth.addMember(clientId, { name: 'x', phone: '12' }), /INVALID_TEAM_PHONE/);
    });

    await t.test('after a closed deal: thank-you + review offer, referral and win-back, with opt-out', async () => {
      const { clientId, owner } = await business(db, 'services');
      const lead = await newLead(clientId, { name: 'משה כהן' });
      await crm().update(clientId, lead.id, { status: 'WON', version: lead.version });
      const plan = (await db.query('SELECT kind,status,due_at>NOW()+INTERVAL \'10 days\' AS later FROM growth_outreach WHERE client_id=$1 ORDER BY due_at', [clientId])).rows;
      assert.deepEqual(plan.map((p) => [p.kind, p.status, p.later]), [['THANKS_REVIEW', 'PLANNED', false], ['REFERRAL', 'PLANNED', true], ['WINBACK', 'PLANNED', true]]);
      // Without approval: the owner gets a ready message (opt-out included) to send himself.
      await growth.runDue({ clientId });
      const offer = (await outboxTo(db, clientId, owner)).map(bodyOf).join('\n');
      assert.match(offer, /תודה \+ בקשת ביקורת למשה כהן/);
      assert.match(offer, /עוד אין לי קישור לביקורות/);
      assert.match(offer, /wa\.me\/972/); assert.match(offer, /כתבו ״הסר״/);
      const thanks = (await db.query("SELECT id,status FROM growth_outreach WHERE client_id=$1 AND kind='THANKS_REVIEW'", [clientId])).rows[0];
      assert.equal(thanks.status, 'OFFERED');
      assert.ok(await growth.markOutreach(clientId, thanks.id, 'LINK_GIVEN'));
      // The owner sets the review link once and approves the cadence once; the customer agreed; a template exists.
      await growth.saveSettings(clientId, { reviewUrl: 'https://g.page/r/test-review' });
      await assert.rejects(growth.saveSettings(clientId, { reviewUrl: 'http://x.com' }), /INVALID_REVIEW_URL/);
      await growth.approveCadence(clientId, true);
      await growth.setConsent(clientId, lead.id, true);
      process.env.WHATSAPP_SEND_ENABLED = 'true'; process.env.WA_TEMPLATE_CUSTOMER_FOLLOWUP = 'customer_followup'; process.env.WHATSAPP_APPROVED_TEMPLATES = 'customer_followup';
      try {
        await db.query("UPDATE growth_outreach SET due_at=NOW()-INTERVAL '1 minute' WHERE client_id=$1 AND kind='REFERRAL'", [clientId]);
        await growth.runDue({ clientId });
        const wa = (await db.query("SELECT wa_phone,status FROM growth_outreach WHERE client_id=$1 AND kind='REFERRAL'", [clientId])).rows[0];
        assert.equal(wa.status, 'SENT', 'approved + consent + template: the agent sends by itself');
        const toCustomer = await outboxTo(db, clientId, wa.wa_phone);
        assert.equal(toCustomer.at(-1).type, 'template');
        assert.match(bodyOf((await outboxTo(db, clientId, owner)).at(-1)), /שלחתי למשה כהן בקשת המלצה לחבר/);
        // The customer writes "הסר": never contacted again.
        assert.equal(await growth.routeInbound(inbound(wa.wa_phone, 'הסר')), true);
        assert.equal((await db.query('SELECT 1 FROM lead_optouts WHERE client_id=$1 AND wa_phone=$2', [clientId, wa.wa_phone])).rows.length, 1);
        assert.equal((await db.query("SELECT status FROM growth_outreach WHERE client_id=$1 AND kind='WINBACK'", [clientId])).rows[0].status, 'OPTED_OUT');
        assert.equal((await db.query('SELECT customer_consent FROM crm_leads WHERE id=$1', [lead.id])).rows[0].customer_consent, false);
      } finally { delete process.env.WA_TEMPLATE_CUSTOMER_FOLLOWUP; delete process.env.WHATSAPP_APPROVED_TEMPLATES; delete process.env.WHATSAPP_SEND_ENABLED; }
    });

    await t.test('the agent sends nothing by itself without customer consent or while automatic actions are paused', async () => {
      const { clientId } = await business(db, 'fitness');
      const lead = await newLead(clientId);
      await crm().update(clientId, lead.id, { status: 'WON', version: lead.version });
      await growth.approveCadence(clientId, true);
      process.env.WHATSAPP_SEND_ENABLED = 'true'; process.env.WA_TEMPLATE_CUSTOMER_FOLLOWUP = 'customer_followup'; process.env.WHATSAPP_APPROVED_TEMPLATES = 'customer_followup';
      try {
        await growth.runDue({ clientId });
        const row = (await db.query("SELECT status,wa_phone FROM growth_outreach WHERE client_id=$1 AND kind='THANKS_REVIEW'", [clientId])).rows[0];
        assert.equal(row.status, 'OFFERED', 'no consent: offered to the owner, not sent');
        assert.equal((await outboxTo(db, clientId, row.wa_phone)).length, 0);
        // Consent given, but the owner paused all automatic actions: still only offered to him.
        await growth.setConsent(clientId, lead.id, true);
        const authority = require('../scopedAuthority');
        await authority.withWhatsAppOwner(clientId, () => authority.setAgreement(clientId, { monthlyCeiling: 1000, maxDailyPerCampaign: 50, allow: {}, styleNotes: '', forbiddenTopics: [] }));
        await authority.withWhatsAppOwner(clientId, () => authority.pauseAll(clientId));
        await db.query("UPDATE growth_outreach SET due_at=NOW()-INTERVAL '1 minute' WHERE client_id=$1 AND kind='REFERRAL'", [clientId]);
        await growth.runDue({ clientId });
        assert.equal((await db.query("SELECT status FROM growth_outreach WHERE client_id=$1 AND kind='REFERRAL'", [clientId])).rows[0].status, 'OFFERED', 'paused: not sent');
        assert.equal((await outboxTo(db, clientId, row.wa_phone)).length, 0);
      } finally { delete process.env.WA_TEMPLATE_CUSTOMER_FOLLOWUP; delete process.env.WHATSAPP_APPROVED_TEMPLATES; delete process.env.WHATSAPP_SEND_ENABLED; }
      const o = await growth.overview(clientId);
      assert.equal(o.settings.cadenceApproved, true); assert.match(o.cadence, /אחרי 45 ימים/);
      assert.ok(o.outreach.some((x) => x.status === 'OFFERED' && /^https:\/\/wa\.me\//.test(x.link)));
    });

    await t.test('owner WhatsApp words: funnels menu, review link, commission and cadence', async () => {
      const { clientId, owner } = await business(db, 'real_estate');
      const g = require('../growthConversation');
      const menu = await g.handleText(owner, 'משפכים');
      assert.match(menu.text, /מוכרי דירות — כמה שווה הדירה שלך/); assert.ok(menu.interactivePayload);
      assert.match((await g.handleText(owner, 'קמפיין למוכרים')).text, /רישיון תיווך/);
      assert.match((await g.handleText(owner, 'רישיון תיווך 3141592')).text, /שמרתי/);
      assert.match((await g.handleText(owner, 'קישור לביקורות https://g.page/r/abc')).text, /שמרתי/);
      assert.equal((await growth.settings(clientId)).review_url, 'https://g.page/r/abc');
      assert.match((await g.handleText(owner, 'עמלה 1.5%')).text, /1.5%/);
      assert.equal((await growth.settings(clientId)).commission_pct, 1.5);
      assert.match((await g.handleText(owner, 'ביקורות והמלצות')).text, /אחרי כל עסקה שנסגרת/);
      assert.match((await g.handleText(owner, '/growth-cadence yes')).text, /סגרנו/);
      assert.ok((await growth.settings(clientId)).outreach_approved_at);
      assert.equal(await g.handleText(owner, 'אני רוצה קמפיין'), null, 'other words are not ours');
      assert.equal(await g.handleText(phone(), 'משפכים'), null, 'unknown number');
    });
  } finally { await close(); }
});
