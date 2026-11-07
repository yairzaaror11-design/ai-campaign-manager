const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyTelnyxSignature, extractIncomingMessage, hasValidAdminToken } = require('../telnyxSecurity');

function signedRequest(body, pair, timestamp) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = crypto.sign(null, Buffer.concat([Buffer.from(`${timestamp}|`), rawBody]), pair.privateKey).toString('base64');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { publicKey, signature, timestamp: String(timestamp), rawBody };
}

test('verifies Telnyx Ed25519 signatures against the original body bytes', () => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const signed = signedRequest({ data: { event_type: 'message.received' } }, pair, 1_800_000_000);
  assert.equal(verifyTelnyxSignature({ ...signed, now: 1_800_000_000_000 }), true);
  assert.equal(verifyTelnyxSignature({ ...signed, rawBody: Buffer.from('{}'), now: 1_800_000_000_000 }), false);
});

test('rejects stale, malformed, or missing signatures', () => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const signed = signedRequest({ data: {} }, pair, 1_700_000_000);
  assert.equal(verifyTelnyxSignature({ ...signed, now: 1_800_000_000_000 }), false);
  assert.equal(verifyTelnyxSignature({ ...signed, signature: 'invalid', now: 1_700_000_000_000 }), false);
  assert.equal(verifyTelnyxSignature({ ...signed, publicKey: '', now: 1_700_000_000_000 }), false);
});

test('extracts only inbound messages and keeps event data out of logging helpers', () => {
  const event = {
    data: {
      id: 'event-1', event_type: 'message.received', occurred_at: '2026-10-25T08:00:00Z',
      payload: { id: 'msg-1', from: { phone_number: '+12125550100' }, to: [{ phone_number: '+12186580186' }], text: 'verification code 123456' }
    }
  };
  assert.deepEqual(extractIncomingMessage(event), {
    eventId: 'event-1', messageId: 'msg-1', from: '+12125550100', to: '+12186580186',
    text: 'verification code 123456', receivedAt: '2026-10-25T08:00:00Z'
  });
  assert.equal(extractIncomingMessage({ data: { event_type: 'message.sent' } }), null);
  assert.equal(extractIncomingMessage({ data: { id: 'x', event_type: 'message.received', payload: { from: '+1', to: '+2', text: 'x'.repeat(2001) } } }), null);
});

test('admin inbox authorization requires a bearer token and compares token digests', () => {
  const token = 'a'.repeat(48);
  assert.equal(hasValidAdminToken(`Bearer ${token}`, token), true);
  assert.equal(hasValidAdminToken(`Bearer ${'b'.repeat(48)}`, token), false);
  assert.equal(hasValidAdminToken(token, token), false);
  assert.equal(hasValidAdminToken(`Bearer ${token}`, 'short'), false);
});
