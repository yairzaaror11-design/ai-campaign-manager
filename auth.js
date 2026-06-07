const { logger } = require('../utils/logger');

/**
 * Check if a WhatsApp number is authorized to use the system.
 * Numbers are stored in ADMIN_PHONE_NUMBERS env var (comma-separated).
 * Format: +1234567890 or just 1234567890
 */
function isAuthorized(phoneNumber) {
  const adminNumbers = process.env.ADMIN_PHONE_NUMBERS || '';

  // If no admin numbers configured, allow all (development mode)
  if (!adminNumbers.trim()) {
    logger.warn('⚠️  No ADMIN_PHONE_NUMBERS configured — allowing all users');
    return true;
  }

  const allowed = adminNumbers
    .split(',')
    .map(n => n.trim().replace(/\D/g, '')); // strip non-digits

  const incoming = String(phoneNumber).replace(/\D/g, '');

  const authorized = allowed.some(n => n === incoming || incoming.endsWith(n) || n.endsWith(incoming));

  if (!authorized) {
    logger.warn('Unauthorized access attempt', { phoneNumber });
  }

  return authorized;
}

module.exports = { isAuthorized };
