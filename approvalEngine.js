const crypto = require('crypto');
const { normalizePhone } = require('./auth');
const { audit } = require('./auditLog');

const approvals = new Map();

function ttlMs() {
  const minutes = Math.max(
    1,
    Math.min(60, Number(process.env.APPROVAL_TTL_MINUTES || 10))
  );
  return minutes * 60 * 1000;
}

function createApproval(phone, actionPlan) {
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) throw Error('Invalid phone for approval');
  if (!actionPlan?.id || !actionPlan?.requiresApproval) {
    throw Error('Action does not require approval');
  }
  if (Array.isArray(actionPlan.missing) && actionPlan.missing.length) {
    throw Error('Action is missing required information');
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const now = Date.now();

  const approval = {
    code,
    phone: normalizedPhone,
    actionId: actionPlan.id,
    actionPlan,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs()).toISOString(),
    usedAt: null,
    status: 'PENDING'
  };

  approvals.set(`${normalizedPhone}:${code}`, approval);

  audit('approval_created', {
    phone: normalizedPhone,
    actionId: actionPlan.id,
    intent: actionPlan.intent,
    result: 'PENDING'
  });

  return approval;
}

function consumeApproval(phone, code) {
  const key = `${normalizePhone(phone)}:${String(code || '').trim()}`;
  const approval = approvals.get(key);

  if (!approval) return { ok: false, reason: 'NOT_FOUND' };
  if (approval.status !== 'PENDING' || approval.usedAt) {
    return { ok: false, reason: 'ALREADY_USED', approval };
  }

  if (Date.now() > new Date(approval.expiresAt).getTime()) {
    approval.status = 'EXPIRED';
    return { ok: false, reason: 'EXPIRED', approval };
  }

  approval.status = 'APPROVED';
  approval.usedAt = new Date().toISOString();

  audit('approval_consumed', {
    phone: approval.phone,
    actionId: approval.actionId,
    intent: approval.actionPlan.intent,
    result: 'APPROVED'
  });

  return { ok: true, approval };
}

function cancelPendingApprovals(phone) {
  const normalizedPhone = normalizePhone(phone);
  for (const approval of approvals.values()) {
    if (approval.phone === normalizedPhone && approval.status === 'PENDING') {
      approval.status = 'CANCELLED';
    }
  }
}

module.exports = {
  createApproval,
  consumeApproval,
  cancelPendingApprovals
};
