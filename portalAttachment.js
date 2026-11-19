'use strict';
// An image attached in the dashboard chat follows the WhatsApp path: stored as a
// tenant media item, then handed to the same conversation controller.
const crypto = require('node:crypto');

function decode({ imageBase64, mimeType } = {}) {
  if (!['image/jpeg', 'image/png'].includes(mimeType) || typeof imageBase64 !== 'string' || imageBase64.length > 2_000_000) throw Error('INVALID_ATTACHMENT');
  const buffer = Buffer.from(imageBase64, 'base64');
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (buffer.length < 100 || !(mimeType === 'image/png' ? png : jpeg)) throw Error('INVALID_ATTACHMENT');
  return { buffer, mimeType };
}

async function send(clientId, body = {}) {
  const image = decode(body);
  const caption = typeof body.caption === 'string' ? body.caption.trim().slice(0, 500) : '';
  if (!/^[a-f0-9-]{36}$/i.test(body.requestId || '')) throw Error('INVALID_ATTACHMENT');
  if (!await require('./rateLimit').take('portal-attachment:' + clientId, 10, 3600)) return { reply: 'צירפת הרבה תמונות בשעה האחרונה. אפשר לנסות שוב מאוחר יותר.' };
  const mediaId = await require('./graphicService').upload(image);
  await require('./mediaStore').saveMedia(clientId, { mediaId, type: 'image', mimeType: image.mimeType, caption: caption || 'תמונה מהדשבורד' });
  const result = await require('./conversationController').media(clientId, { message: 'קובץ מצורף: image ' + caption, requestId: 'portal-media:' + body.requestId, channel: 'PORTAL' });
  return { reply: result?.reply || 'התמונה נשמרה לשיחה. מה תרצה להכין איתה?', mediaIds: result?.mediaIds || [] };
}

module.exports = { send, decode, id: () => crypto.randomUUID() };
