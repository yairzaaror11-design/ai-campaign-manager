const { logger } = require('../utils/logger');

function errorHandler(err, req, res, next) {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error', message: err.message });
}

module.exports = { errorHandler };
