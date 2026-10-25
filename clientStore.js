const { query, configured, transaction } = require('./db');
const { normalizePhone } = require('./auth');

const fallback = new Map();

async function getOrCreateClient(phone, displayName = null) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw Error('Invalid client phone');

  if (!configured()) {
    if (!fallback.has(normalized)) {
      fallback.set(normalized, {
        id: `memory:${normalized}`,
        phone: normalized,
        display_name: displayName || null,
        meta_ad_account_id: null
      });
    }
    return fallback.get(normalized);
  }

  return transaction(async tx=>{
    await tx('SELECT pg_advisory_xact_lock(hashtextextended($1,874223002))',[normalized]);
  const guard=await tx('SELECT phone_digest FROM deleted_client_guards WHERE phone_digest=$1',[require('./metaDeletion').phoneDigest(normalized)]);
  if(guard.rows.length) throw Error('CLIENT_DELETED_REENROLL_REQUIRED');
  const result = await tx(
    `INSERT INTO clients (phone, display_name)
     VALUES ($1, $2)
     ON CONFLICT (phone)
     DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, clients.display_name),
       updated_at = NOW()
     RETURNING *`,
    [normalized, displayName]
  );

  return result.rows[0];
  });
}

async function setMetaAdAccount(phone, accountId) {
  if (!/^act_\d+$/.test(String(accountId))) throw Error('Invalid ad account ID');
  const client = await getOrCreateClient(phone);

  if (!configured()) {
    client.meta_ad_account_id = accountId;
    return client;
  }

  const result = await query(
    `UPDATE clients
     SET meta_ad_account_id = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [client.id, accountId]
  );

  return result.rows[0];
}

module.exports = { getOrCreateClient, setMetaAdAccount };
