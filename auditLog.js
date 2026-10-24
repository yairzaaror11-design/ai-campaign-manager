const { logger } = require('./logger');

function audit(event, data = {}) {
  logger.info('audit', {
    event,
    actionId: data.actionId || null,
    intent: data.intent || null,
    phoneSuffix: data.phone ? String(data.phone).slice(-4) : null,
    targetId: data.targetId || null,
    result: data.result || null,
    reason: data.reason || null
  });
}

module.exports = { audit };
