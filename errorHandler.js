const { logger } = require('./logger');
function errorHandler(err, req, res, next) {
  logger.error('Unhandled error', { error: err.message });
  if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
}
module.exports = { errorHandler };
