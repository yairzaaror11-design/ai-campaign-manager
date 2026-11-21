'use strict';
// Onboarding V2 and undo through the real WhatsApp router (separate file: the HTTP test starts the app).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { openDatabase } = require('./helpers/isolatedDatabase');
const copy = require('../onboardingCopy');
const phone = () => '97258' + String(crypto.randomInt(0, 10_000_000)).padStart(7, '0');

test('WhatsApp router: a new owner says hi, taps a button, and onboarding continues; undo by words', async () => {
  const { db, close } = await openDatabase();
  const env = { ...process.env }, whatsapp = require('../whatsapp'), original = whatsapp.safeSend, out = [];
  whatsapp.safeSend = async (_to, text, options) => out.push({ text, options });
  delete require.cache[require.resolve('../messageHandler')];
  const me = phone();
  Object.assign(process.env, { AUTHORIZED_PHONE_NUMBERS: me, ONBOARDING_V2_ENABLED: 'true', WHATSAPP_SEND_ENABLED: 'false', APP_PUBLIC_URL: 'https://example.test/' });
  try {
    const handle = require('../messageHandler').handleIncomingMessage;
    const ts = () => String(Math.floor(Date.now() / 1000));
    const text = (body) => handle({ from: me, id: 'wamid.' + crypto.randomUUID(), type: 'text', timestamp: ts(), text: { body } });
    await text('היי');
    assert.match(out[0].text, /אני הסוכן של SCORPIO/);
    assert.equal(out[1].options.interactivePayload.interactive.action.buttons[0].reply.title, copy.noLinkButton);
    const id = (await db.query('SELECT id FROM clients WHERE phone=$1', [me])).rows[0].id;
    const nonce = (await require('../marketingStore').load(id)).ui.nonce;
    await handle({ from: me, id: 'wamid.' + crypto.randomUUID(), type: 'interactive', timestamp: ts(), interactive: { type: 'button_reply', button_reply: { id: `cb:${nonce}:0`, title: copy.noLinkButton } } });
    assert.equal(out.at(-1).text, copy.describeInstead);
    await text('משרד תיווך בגבעתיים');
    assert.match(out.at(-1).text, /שאלה 1 מתוך 3/);
    assert.equal((await db.query('SELECT step FROM onboarding_state WHERE client_id=$1', [id])).rows[0].step, 'SELL');
    // A template quick-reply tap (type 'button') is handled like the words on the button.
    await handle({ from: me, id: 'wamid.' + crypto.randomUUID(), type: 'button', timestamp: ts(), button: { text: 'דירה למכירה', payload: 'tpl' } });
    assert.equal((await db.query('SELECT step FROM onboarding_state WHERE client_id=$1', [id])).rows[0].step, 'GOAL');
    await text('החזר למצב הקודם');
    assert.equal(out.at(-1).text, copy.undoListEmpty);
  } finally {
    whatsapp.safeSend = original; delete require.cache[require.resolve('../messageHandler')];
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env); await close();
  }
});
