const { logger } = require('./logger');

function audit(event, data = {}) {
  const safe = {
    event,
    actionId: data.actionId || null,
    intent: data.intent || null,
    phoneSuffix: data.phone ? String(data.phone).slice(-4) : null,
    result: data.result || null,
    reason: data.reason || null
  };

  logger.info('audit', safe);
}

module.exports = { audit };
