const { query } = require('./db');

const RETENTION_MINUTES = 15;
const MAX_MESSAGES = 20;

async function saveIncomingMessage(message) {
  const result = await query(
    `WITH purge AS (
       DELETE FROM telnyx_inbound_messages WHERE expires_at <= NOW()
     )
     INSERT INTO telnyx_inbound_messages
       (event_id, message_id, from_number, to_number, message_text, received_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), NOW() + INTERVAL '${RETENTION_MINUTES} minutes')
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [message.eventId, message.messageId, message.from, message.to, message.text, message.receivedAt]
  );
  return result.rowCount === 1;
}

async function listRecentMessages(limit = MAX_MESSAGES) {
  const safeLimit = Math.min(Math.max(Number(limit) || MAX_MESSAGES, 1), MAX_MESSAGES);
  const result = await query(
    `WITH purge AS (
       DELETE FROM telnyx_inbound_messages WHERE expires_at <= NOW()
     )
     SELECT message_id, from_number, to_number, message_text, received_at, expires_at
     FROM telnyx_inbound_messages
     WHERE expires_at > NOW()
     ORDER BY received_at DESC
     LIMIT $1`,
    [safeLimit]
  );
  return result.rows;
}

module.exports = { saveIncomingMessage, listRecentMessages };
