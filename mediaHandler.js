const axios = require('axios');
const { logger } = require('./logger');

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/quicktime'
]);

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const graphBase = () =>
  `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v26.0'}`;

function accessToken() {
  if (!process.env.WHATSAPP_ACCESS_TOKEN) {
    throw Error('WHATSAPP_ACCESS_TOKEN is not configured');
  }
  return process.env.WHATSAPP_ACCESS_TOKEN;
}

function validateMediaType(messageType, mimeType) {
  if (messageType === 'image') return ALLOWED_IMAGE_TYPES.has(mimeType);
  if (messageType === 'video') return ALLOWED_VIDEO_TYPES.has(mimeType);
  return false;
}

function maxBytes(messageType) {
  return messageType === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
}

async function getMediaMetadata(mediaId) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(mediaId || ''))) {
    throw Error('Invalid media ID');
  }

  return (
    await axios.get(`${graphBase()}/${mediaId}`, {
      headers: { Authorization: 'Bearer '+accessToken() },
      maxRedirects:0,
      timeout: 15000
    })
  ).data;
}

function assertTrustedMediaUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port!=='443') ||
      !(/^(?:[a-z0-9-]+\.)*fbcdn\.net$/i.test(url.hostname) || url.hostname === 'lookaside.fbsbx.com')) {
    throw Error('Untrusted WhatsApp media URL');
  }
  return url.toString();
}

async function downloadMedia(url, messageType) {
  const response = await axios.get(assertTrustedMediaUrl(url), {
    responseType: 'arraybuffer',
    maxRedirects: 0,
    headers: { Authorization: `Bearer ${accessToken()}` },
    maxContentLength: maxBytes(messageType),
    maxBodyLength: maxBytes(messageType),
    timeout: 30000
  });

  const buffer = Buffer.from(response.data);

  if (!buffer.length || buffer.length > maxBytes(messageType)) {
    throw Error('Media file is too large');
  }

  return buffer;
}

async function receiveWhatsAppMedia(message) {
  const type = message?.type;
  const media = message?.[type];

  if (!['image', 'video'].includes(type) || !media?.id) {
    throw Error('Unsupported media message');
  }

  const metadata = await getMediaMetadata(media.id);
  const mimeType = String(metadata.mime_type || '');

  if (!validateMediaType(type, mimeType)) {
    throw Error(`Unsupported ${type} format`);
  }

  const buffer = await downloadMedia(metadata.url, type);

  logger.info('media_received', {
    type,
    mimeType,
    bytes: buffer.length,
    mediaIdSuffix: String(media.id).slice(-6)
  });

  return {
    type,
    mediaId: media.id,
    mimeType,
    sha256: metadata.sha256 || null,
    fileSize: buffer.length,
    caption: String(media.caption || '').trim(),
    buffer
  };
}

module.exports = {
  receiveWhatsAppMedia,
  validateMediaType,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES
};
