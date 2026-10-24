const normalizePhone = (value) =>
  String(value || '').replace(/\D/g, '');

function isAuthorized(phone) {
  const authorizedNumbers = String(
    process.env.AUTHORIZED_PHONE_NUMBERS || ''
  )
    .split(',')
    .map(normalizePhone)
    .filter(Boolean);

  if (authorizedNumbers.length === 0) {
    return false;
  }

  return authorizedNumbers.includes(normalizePhone(phone));
}

module.exports = { isAuthorized, normalizePhone };
