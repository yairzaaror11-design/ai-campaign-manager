'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const link = require('../dashboardLink');

test('dashboard requests map to a screen; anything else is ignored', () => {
  assert.deepEqual(link.request('דשבורד'), { screen: null });
  assert.deepEqual(link.request('דשבורד לידים'), { screen: 'leads' });
  assert.deepEqual(link.request('פתח לי את הדשבורד של הביצועים'), { screen: 'performance' });
  assert.deepEqual(link.request('ניהול לידים'), { screen: 'leads' });
  assert.equal(link.request('תכין לי קמפיין לדשבורד'), null);
  assert.equal(link.request('דשבורד מחיקה'), null);
  assert.match(link.hint('leads'), /דשבורד לידים/);
});

test('the sign-in link opens the requested screen and refuses unknown screens', async () => {
  const { openDatabase } = require('./helpers/isolatedDatabase');
  const { db, close } = await openDatabase();
  const before = process.env.APP_PUBLIC_URL; process.env.APP_PUBLIC_URL = 'https://example.test/';
  try {
    const id = (await db.query("INSERT INTO clients(phone) VALUES('972500000433') RETURNING id")).rows[0].id;
    const r = await link.handle(id, 'דשבורד לידים');
    assert.match(r.reply, /https:\/\/example\.test\/app\/leads#login=[a-f0-9]{64}/);
    assert.doesNotMatch(r.historyReply, /login=/);
    await assert.rejects(require('../portalStore').createTicket(id, '../admin'), /INVALID_SCREEN/);
  } finally { if (before === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = before; await close(); }
});
