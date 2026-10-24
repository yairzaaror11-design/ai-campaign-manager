const { query, configured } = require('./db');
const { getOrCreateClient } = require('./clientStore');

const fallbackActions = new Map();

async function saveActionPlan(phone, plan) {
  const client = await getOrCreateClient(phone);

  if (!configured()) {
    fallbackActions.set(plan.id, { phone: client.phone, plan, status: 'PROPOSED' });
    return plan;
  }

  await query(
    `INSERT INTO action_plans (id, client_id, intent, payload, status)
     VALUES ($1, $2, $3, $4::jsonb, 'PROPOSED')
     ON CONFLICT (id) DO NOTHING`,
    [plan.id, client.id, plan.intent, JSON.stringify(plan)]
  );

  return plan;
}

async function updateActionStatus(actionId, status) {
  if (!configured()) {
    const row = fallbackActions.get(actionId);
    if (row) row.status = status;
    return;
  }

  await query(
    `UPDATE action_plans
     SET status = $2, updated_at = NOW()
     WHERE id = $1`,
    [actionId, status]
  );
}

module.exports = { saveActionPlan, updateActionStatus };
