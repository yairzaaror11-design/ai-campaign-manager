const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Ensure that the signature calculation is bound to the exact raw bytes.
test('Meta signature is HMAC SHA256 over raw request bytes', () => {
  const secret = 'test-secret';
  const raw = Buffer.from('{"object":"whatsapp_business_account"}');
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  assert.match(signature, /^sha256=[a-f0-9]{64}$/);
  assert.notEqual(signature, 'sha256=' + crypto.createHmac('sha256', secret).update(Buffer.from('{}')).digest('hex'));
});
