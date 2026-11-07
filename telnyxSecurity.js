const crypto = require('crypto');

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const DEFAULT_TOLERANCE_SECONDS = 300;

function loadPublicKey(value) {
  if (!value) return null;
  try {
    if (value.includes('BEGIN PUBLIC KEY')) return crypto.createPublicKey(value);
    const der = Buffer.from(value.trim(), 'base64');
    if (der.length === 32) {
      return crypto.createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, der]),
        format: 'der',
        type: 'spki'
      });
    }
    return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

function decodeSignature(header) {
  if (!header || typeof header !== 'string') return null;
  const trimmed = header.trim();
  const encoded = trimmed.startsWith('v1,') ? trimmed.slice(3) : trimmed;
  try {
    const signature = Buffer.from(encoded, 'base64');
    return signature.length === 64 ? signature : null;
  } catch {
    return null;
  }
}

function verifyTelnyxSignature({ publicKey, signature, timestamp, rawBody, now = Date.now(), toleranceSeconds = DEFAULT_TOLERANCE_SECONDS }) {
  if (!publicKey || !signature || !timestamp || !Buffer.isBuffer(rawBody)) return false;
  if (!/^\d{10,13}$/.test(String(timestamp))) return false;

  const timestampMs = String(timestamp).length === 10 ? Number(timestamp) * 1000 : Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > toleranceSeconds * 1000) return false;

  const key = loadPublicKey(publicKey);
  const sig = decodeSignature(signature);
  if (!key || !sig) return false;

  const signedPayload = Buffer.concat([Buffer.from(`${timestamp}|`, 'utf8'), rawBody]);
  try {
    return crypto.verify(null, signedPayload, key, sig);
  } catch {
    return false;
  }
}

function extractIncomingMessage(event) {
  const data = event?.data;
  if (data?.event_type !== 'message.received') return null;
  const payload = data.payload || {};
  const eventId = data.id || payload.id;
  const from = payload.from?.phone_number || payload.from;
  const toValue = Array.isArray(payload.to) ? payload.to[0] : payload.to;
  const to = toValue?.phone_number || toValue;
  const text = payload.text;

  if (!eventId || typeof from !== 'string' || typeof to !== 'string' || typeof text !== 'string') return null;
  if (text.length > 2000) return null;

  return {
    eventId: String(eventId),
    messageId: payload.id ? String(payload.id) : null,
    from,
    to,
    text,
    receivedAt: data.occurred_at || new Date().toISOString()
  };
}

function hasValidAdminToken(header, expectedToken) {
  if (!expectedToken || expectedToken.length < 32 || typeof header !== 'string') return false;
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;
  const suppliedDigest = crypto.createHash('sha256').update(match[1]).digest();
  const expectedDigest = crypto.createHash('sha256').update(expectedToken).digest();
  return crypto.timingSafeEqual(suppliedDigest, expectedDigest);
}

module.exports = { verifyTelnyxSignature, extractIncomingMessage, hasValidAdminToken };
