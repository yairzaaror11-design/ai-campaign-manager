'use strict';
const { logger } = require('./logger');
const { handleIncomingMessage } = require('./messageHandler');
const {
  claimNextInboundEvent,
  markInboundDone,
  markInboundForReview,
  markExpiredInboundForReview
} = require('./whatsappInboundStore');

let running = false;

async function runOne({ handler = handleIncomingMessage } = {}) {
  if (running) return { status: 'IDLE' };
  running = true;
  try {
    const event = await claimNextInboundEvent();
    if (!event) return { status: 'IDLE' };

    try {
      const payload = event.payload || {};
      await handler(payload.message, payload.contact || {});
      await markInboundDone(event.event_id);
      return { status: 'DONE' };
    } catch (error) {
      try {
        await markInboundForReview(event.event_id);
      } catch (_) {
        // The processing lease is reconciled after its expiry; never replay an uncertain event.
      }
      logger.error('WhatsApp inbound event requires manual review', {
        errorType: error?.name || 'Error'
      });
      return { status: 'MANUAL_REVIEW' };
    }
  } finally {
    running = false;
  }
}

function startWhatsAppWebhookWorker({ intervalMs = 1000 } = {}) {
  let stopped = false;
  let timer;

  async function tick() {
    if (stopped) return;
    try {
      const recovered = await markExpiredInboundForReview();
      if (recovered) {
        logger.warn('Interrupted WhatsApp events moved to manual review', { count: recovered });
      }
      const result = await runOne();
      timer = setTimeout(tick, result.status === 'IDLE' ? intervalMs : 0);
    } catch (_) {
      logger.error('WhatsApp webhook worker iteration failed');
      timer = setTimeout(tick, intervalMs);
    }
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

module.exports = { runOne, startWhatsAppWebhookWorker };
