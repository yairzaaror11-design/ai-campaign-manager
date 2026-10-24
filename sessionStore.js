const { query, configured } = require('./db');
const { getOrCreateClient } = require('./clientStore');

const fallback = new Map();

async function getHistory(phone, limit = 24) {
  const client = await getOrCreateClient(phone);

  if (!configured()) {
    return (fallback.get(client.phone) || []).slice(-limit);
  }

  const result = await query(
    `SELECT role, content
     FROM (
       SELECT id, role, content, created_at
       FROM conversation_messages
       WHERE client_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2
     ) recent
     ORDER BY created_at ASC, id ASC`,
    [client.id, limit]
  );

  return result.rows.map(row => ({
    role: row.role,
    content: row.content
  }));
}

async function appendMessages(phone, messages) {
  const client = await getOrCreateClient(phone);

  if (!configured()) {
    const history = fallback.get(client.phone) || [];
    history.push(...messages);
    fallback.set(client.phone, history.slice(-24));
    return;
  }

  for (const message of messages) {
    await query(
      `INSERT INTO conversation_messages (client_id, role, content)
       VALUES ($1, $2, $3)`,
      [client.id, message.role, message.content]
    );
  }
}

async function resetSession(phone) {
  const client = await getOrCreateClient(phone);

  if (!configured()) {
    fallback.delete(client.phone);
    return;
  }

  await query(
    'DELETE FROM conversation_messages WHERE client_id = $1',
    [client.id]
  );
}

module.exports = { getHistory, appendMessages, resetSession };
