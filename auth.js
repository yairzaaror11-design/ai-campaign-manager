const normalizePhone = (value) =>
  String(value || '').replace(/\D/g, '');

function isAuthorized(phone) {
  const authorizedNumbers = String(process.env.AUTHORIZED_PHONE_NUMBERS || '')
    .split(',')
    .map(normalizePhone)
    .filter(Boolean);

  if(process.env.PUBLIC_ONBOARDING_ENABLED==='true'&&/^\d{8,15}$/.test(normalizePhone(phone)))return true;
  return authorizedNumbers.length > 0 &&
    authorizedNumbers.includes(normalizePhone(phone));
}

module.exports = { isAuthorized, normalizePhone };
