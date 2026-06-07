const { logger } = require('../utils/logger');
const { sendWhatsAppMessage, sendWhatsAppButtons } = require('./whatsapp');
const { processWithClaude } = require('./claude');
const { isAuthorized } = require('../middleware/auth');

// In-memory session store (use Redis for production scaling)
const sessions = new Map();
// Pending approvals: approvalId → { action, params, from, expiresAt }
const pendingApprovals = new Map();

/**
 * Main entry point for all incoming WhatsApp messages
 */
async function handleIncomingMessage(message, contact, metadata) {
  const from    = message.from;
  const msgType = message.type;
  const name    = contact?.profile?.name || 'User';

  logger.info('Incoming message', { from, type: msgType, name });

  // Authorization check
  if (!isAuthorized(from)) {
    await sendWhatsAppMessage(from, '⛔ You are not authorized to use this system.');
    return;
  }

  // Handle interactive button replies (approval flow)
  if (msgType === 'interactive') {
    await handleInteractiveReply(message, from, name);
    return;
  }

  // Only process text messages beyond this point
  if (msgType !== 'text') {
    await sendWhatsAppMessage(from, '📝 Please send a text message. I support commands and questions about your ad campaigns.');
    return;
  }

  const userText = message.text.body.trim();

  // Quick commands
  if (userText.toLowerCase() === '/help') {
    await sendHelp(from, name);
    return;
  }

  if (userText.toLowerCase() === '/start' || userText.toLowerCase() === 'hi' || userText.toLowerCase() === 'hello') {
    await sendWelcome(from, name);
    return;
  }

  // Send typing indicator
  await sendWhatsAppMessage(from, '⏳ Analyzing your request...');

  // Build conversation context
  const session = getSession(from);
  session.messages.push({ role: 'user', content: userText });

  // Process with Claude AI
  try {
    const response = await processWithClaude(userText, session, from, pendingApprovals);

    // If response includes a budget change request, hold for approval
    if (response.requiresApproval) {
      await handleApprovalRequest(response, from, name);
    } else {
      await sendWhatsAppMessage(from, response.text);
      session.messages.push({ role: 'assistant', content: response.text });
    }

    // Keep session trimmed to last 10 messages
    if (session.messages.length > 20) {
      session.messages = session.messages.slice(-20);
    }
  } catch (err) {
    logger.error('Claude processing error', { error: err.message });
    await sendWhatsAppMessage(from, '❌ Sorry, I encountered an error. Please try again or rephrase your request.');
  }
}

/**
 * Handle button/list interactive replies
 */
async function handleInteractiveReply(message, from, name) {
  const reply = message.interactive;
  let buttonId;

  if (reply.type === 'button_reply') {
    buttonId = reply.button_reply.id;
  } else if (reply.type === 'list_reply') {
    buttonId = reply.list_reply.id;
  }

  if (!buttonId) return;

  // Parse approval response: format is "approve_<id>" or "reject_<id>"
  if (buttonId.startsWith('approve_') || buttonId.startsWith('reject_')) {
    const [action, approvalId] = buttonId.split('_', 2).concat([buttonId.slice(buttonId.indexOf('_') + 1)]);
    const realId = buttonId.replace(/^(approve|reject)_/, '');
    const isApprove = buttonId.startsWith('approve_');

    const pending = pendingApprovals.get(realId);
    if (!pending) {
      await sendWhatsAppMessage(from, '⚠️ This approval request has expired or was already handled.');
      return;
    }

    if (pending.from !== from) {
      await sendWhatsAppMessage(from, '⛔ You are not authorized to approve this action.');
      return;
    }

    pendingApprovals.delete(realId);

    if (isApprove) {
      await sendWhatsAppMessage(from, '✅ Approved! Executing the budget change...');
      const { executeApprovedAction } = require('./metaAds');
      const result = await executeApprovedAction(pending);
      await sendWhatsAppMessage(from, result);
    } else {
      await sendWhatsAppMessage(from, '🚫 Action cancelled. No changes were made.');
    }
    return;
  }
}

/**
 * Send approval request with approve/reject buttons
 */
async function handleApprovalRequest(response, from, name) {
  const { v4: uuidv4 } = require('uuid');
  const approvalId = uuidv4().replace(/-/g, '').slice(0, 16); // shorter for button IDs

  pendingApprovals.set(approvalId, {
    ...response.approvalData,
    from,
    expiresAt: Date.now() + 10 * 60 * 1000 // 10 min expiry
  });

  // Clean up expired approvals
  for (const [id, data] of pendingApprovals.entries()) {
    if (data.expiresAt < Date.now()) pendingApprovals.delete(id);
  }

  await sendWhatsAppButtons(
    from,
    `⚠️ *Approval Required*\n\n${response.text}\n\n_This action requires your explicit approval. It will expire in 10 minutes._`,
    [
      { id: `approve_${approvalId}`, title: '✅ Approve' },
      { id: `reject_${approvalId}`,  title: '❌ Reject'  }
    ]
  );
}

function getSession(from) {
  if (!sessions.has(from)) {
    sessions.set(from, { messages: [], createdAt: Date.now() });
  }
  return sessions.get(from);
}

async function sendWelcome(from, name) {
  const msg = `👋 Hello *${name}*! I'm your AI Campaign Manager.

Here's what I can do for you:

📊 *Performance* — "Show me campaign performance this week"
💰 *Budget* — "What's my total ad spend today?"
🏆 *Accounts* — "List all my ad accounts"
📈 *Reports* — "Generate a report for Campaign X"
💡 *Optimize* — "How can I improve my ROAS?"
📅 *Schedule* — "Pause all campaigns on weekends"

Type */help* to see all commands, or just ask me anything about your campaigns! 🚀`;

  await sendWhatsAppMessage(from, msg);
}

async function sendHelp(from, name) {
  const msg = `📚 *AI Campaign Manager — Commands*

*📊 Reporting*
• "Show performance for [campaign name]"
• "Generate weekly report"
• "What's my best performing ad set?"

*💰 Budget Management*
• "What's my daily budget for [campaign]?"
• "Change budget to $500 for [campaign]" _(requires approval)_
• "Show total spend this month"

*🏆 Account Overview*
• "List all ad accounts"
• "Show all active campaigns"
• "Which account has the best ROAS?"

*💡 Optimization*
• "Suggest optimizations for [campaign]"
• "Why is my CPC high?"
• "How do I improve my CTR?"

*ℹ️ Other*
• /start — Welcome message
• /help  — This help menu

Just type naturally — I understand plain English! 🤖`;

  await sendWhatsAppMessage(from, msg);
}

module.exports = { handleIncomingMessage };
