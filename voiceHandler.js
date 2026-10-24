const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const { logger } = require('./logger');

const ALLOWED_AUDIO_TYPES = new Set([
  'audio/ogg',
  'audio/opus',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/aac',
  'audio/wav',
  'audio/webm'
]);

const MAX_AUDIO_BYTES = 18 * 1024 * 1024;

const graphBase = () =>
  `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v26.0'}`;

function whatsappToken() {
  if (!process.env.WHATSAPP_ACCESS_TOKEN) {
    throw Error('WHATSAPP_ACCESS_TOKEN is not configured');
  }
  return process.env.WHATSAPP_ACCESS_TOKEN;
}

async function getAudio(message) {
  const mediaId = message?.audio?.id;
  if (!mediaId || !/^[A-Za-z0-9_-]+$/.test(String(mediaId))) {
    throw Error('Invalid audio media ID');
  }

  const metadata = (
    await axios.get(`${graphBase()}/${mediaId}`, {
      params: { access_token: whatsappToken() },
      timeout: 15000
    })
  ).data;

  const mimeType = String(metadata.mime_type || '').split(';')[0].trim();

  if (!ALLOWED_AUDIO_TYPES.has(mimeType)) {
    throw Error(`Unsupported audio format: ${mimeType}`);
  }

  const response = await axios.get(metadata.url, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${whatsappToken()}` },
    maxContentLength: MAX_AUDIO_BYTES,
    maxBodyLength: MAX_AUDIO_BYTES,
    timeout: 30000
  });

  const buffer = Buffer.from(response.data);
  if (!buffer.length || buffer.length > MAX_AUDIO_BYTES) {
    throw Error('Audio file is empty or too large');
  }

  return { buffer, mimeType, mediaId };
}

async function transcribeVoiceMessage(message) {
  if (!process.env.GEMINI_API_KEY) {
    throw Error('GEMINI_API_KEY is not configured');
  }

  const audio = await getAudio(message);
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe',
    contents: [{
      role: 'user',
      parts: [{
        inlineData: {
          mimeType: audio.mimeType,
          data: audio.buffer.toString('base64')
        }
      }]
    }],
    config: {
      audioTranscriptionConfig: {
        mode: 'SMART'
      }
    }
  });

  const transcript = String(response.text || '').trim();
  if (!transcript) throw Error('Empty transcription');

  logger.info('voice_transcribed', {
    bytes: audio.buffer.length,
    mimeType: audio.mimeType,
    mediaIdSuffix: String(audio.mediaId).slice(-6),
    transcriptChars: transcript.length
  });

  return transcript;
}

module.exports = { transcribeVoiceMessage };
