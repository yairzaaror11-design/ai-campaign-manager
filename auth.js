const normalizePhone = (value) =>
  String(value || '').replace(/\D/g, '');

function isAuthorized(phone) {
  const authorizedNumbers = String(
    process.env.AUTHORIZED_PHONE_NUMBERS || ''
  )
    .split(',')
    .map(normalizePhone)
    .filter(Boolean);

  return (
    authorizedNumbers.length > 0 &&
    authorizedNumbers.includes(normalizePhone(phone))
  );
}

module.exports = { isAuthorized, normalizePhone };
