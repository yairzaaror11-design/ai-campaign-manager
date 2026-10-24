const crypto = require('crypto');
const { normalizePhone } = require('./auth');
const { audit } = require('./auditLog');
const { query, configured } = require('./db');
const { getOrCreateClient } = require('./clientStore');
const { saveActionPlan, updateActionStatus } = require('./actionStore');

const fallbackApprovals = new Map();

function ttlMs() {
  const minutes = Math.max(
    1,
    Math.min(60, Number(process.env.APPROVAL_TTL_MINUTES || 10))
  );
  return minutes * 60 * 1000;
}

async function createApproval(phone, actionPlan) {
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) throw Error('Invalid phone for approval');
  if (!actionPlan?.id || !actionPlan?.requiresApproval) {
    throw Error('Action does not require approval');
  }
  if (actionPlan.missing?.length) {
    throw Error('Action is missing required information');
  }

  await saveActionPlan(normalizedPhone, actionPlan);

  const code = String(crypto.randomInt(100000, 1000000));
  const now = Date.now();
  const expiresAt = new Date(now + ttlMs()).toISOString();

  if (!configured()) {
    const approval = {
      code,
      phone: normalizedPhone,
      actionId: actionPlan.id,
      actionPlan,
      createdAt: new Date(now).toISOString(),
      expiresAt,
      usedAt: null,
      status: 'PENDING'
    };
    fallbackApprovals.set(`${normalizedPhone}:${code}`, approval);
    return approval;
  }

  const client = await getOrCreateClient(normalizedPhone);
  const result = await query(
    `INSERT INTO approvals (client_id, action_id, code, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING code, action_id, status, expires_at, used_at, created_at`,
    [client.id, actionPlan.id, code, expiresAt]
  );

  audit('approval_created', {
    phone: normalizedPhone,
    actionId: actionPlan.id,
    intent: actionPlan.intent,
    result: 'PENDING'
  });

  const row = result.rows[0];
  return {
    code: row.code,
    phone: normalizedPhone,
    actionId: row.action_id,
    actionPlan,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    status: row.status
  };
}

async function consumeApproval(phone, code) {
  const normalizedPhone = normalizePhone(phone);

  if (!configured()) {
    const approval = fallbackApprovals.get(`${normalizedPhone}:${String(code).trim()}`);
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
    return { ok: true, approval };
  }

  const client = await getOrCreateClient(normalizedPhone);
  const result = await query(
    `SELECT a.id, a.code, a.action_id, a.status, a.expires_at, a.used_at,
            ap.payload, ap.intent
     FROM approvals a
     JOIN action_plans ap ON ap.id = a.action_id
     WHERE a.client_id = $1 AND a.code = $2
     LIMIT 1`,
    [client.id, String(code).trim()]
  );

  if (!result.rows.length) return { ok: false, reason: 'NOT_FOUND' };
  const row = result.rows[0];

  if (row.status !== 'PENDING' || row.used_at) {
    return { ok: false, reason: 'ALREADY_USED' };
  }

  if (Date.now() > new Date(row.expires_at).getTime()) {
    await query(`UPDATE approvals SET status = 'EXPIRED' WHERE id = $1`, [row.id]);
    await updateActionStatus(row.action_id, 'EXPIRED');
    return { ok: false, reason: 'EXPIRED' };
  }

  const updated = await query(
    `UPDATE approvals
     SET status = 'APPROVED', used_at = NOW()
     WHERE id = $1 AND status = 'PENDING' AND used_at IS NULL
     RETURNING *`,
    [row.id]
  );

  if (!updated.rows.length) {
    return { ok: false, reason: 'ALREADY_USED' };
  }

  await updateActionStatus(row.action_id, 'APPROVED');

  audit('approval_consumed', {
    phone: normalizedPhone,
    actionId: row.action_id,
    intent: row.intent,
    result: 'APPROVED'
  });

  return {
    ok: true,
    approval: {
      code: row.code,
      phone: normalizedPhone,
      actionId: row.action_id,
      actionPlan: row.payload,
      expiresAt: row.expires_at,
      usedAt: updated.rows[0].used_at,
      status: 'APPROVED'
    }
  };
}

async function cancelPendingApprovals(phone) {
  const normalizedPhone = normalizePhone(phone);

  if (!configured()) {
    for (const approval of fallbackApprovals.values()) {
      if (approval.phone === normalizedPhone && approval.status === 'PENDING') {
        approval.status = 'CANCELLED';
      }
    }
    return;
  }

  const client = await getOrCreateClient(normalizedPhone);
  await query(
    `UPDATE approvals
     SET status = 'CANCELLED'
     WHERE client_id = $1 AND status = 'PENDING'`,
    [client.id]
  );
}

module.exports = {
  createApproval,
  consumeApproval,
  cancelPendingApprovals
};
