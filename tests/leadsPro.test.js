'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { openDatabase } = require('./helpers/isolatedDatabase');

test('each lead keeps a timeline, reminders become tasks, and the export is Excel-safe', async () => {
  const { db, close } = await openDatabase();
  try {
    const crm = require('../crmService');
    const id = (await db.query("INSERT INTO clients(phone) VALUES('972500000463') RETURNING id")).rows[0].id;
    const lead = await crm.create(id, { name: '=HYPERLINK("x")', phone: '0501234567', source: 'meta_lead_ads', sourceEventId: '77' });
    let v = (await crm.update(id, lead.id, { status: 'CONTACTED', version: lead.version, note: 'דיברנו' })).version;
    await crm.update(id, lead.id, { status: 'WON', version: v, revenueMinor: 150000, currency: 'ILS' });
    const events = await crm.timeline(id, lead.id);
    assert.deepEqual(events.map((e) => e.kind), ['CREATED', 'STATUS', 'NOTE', 'STATUS', 'REVENUE']);
    assert.equal(events[0].detail, 'meta_lead_ads');
    const task = await crm.addReminder(id, lead.id, { date: '2026-12-01', requestId: crypto.randomUUID() });
    assert.equal(task.payload.date, '2026-12-01'); assert.match(task.payload.title, /^לחזור ל/);
    assert.equal((await crm.timeline(id, lead.id)).at(-1).kind, 'REMINDER');
    const csv = crm.csv(await crm.list(id, { limit: 5000 }));
    assert.ok(csv.startsWith('﻿')); assert.match(csv, /"'=HYPERLINK\(""x""\)"/, 'formulas are neutralised');
    assert.match(csv, /נסגרה עסקה/); assert.match(csv, /"1500"/);
    await assert.rejects(crm.timeline(id, 'nope'), /INVALID_LEAD/);
  } finally { await close(); }
});

test('dashboard attachments accept only real JPEG/PNG images', () => {
  const { decode } = require('../portalAttachment');
  const jpeg = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(200)]).toString('base64');
  assert.equal(decode({ imageBase64: jpeg, mimeType: 'image/jpeg' }).mimeType, 'image/jpeg');
  assert.throws(() => decode({ imageBase64: jpeg, mimeType: 'image/png' }), /INVALID_ATTACHMENT/);
  assert.throws(() => decode({ imageBase64: Buffer.from('<svg/>'.repeat(30)).toString('base64'), mimeType: 'image/jpeg' }), /INVALID_ATTACHMENT/);
});
