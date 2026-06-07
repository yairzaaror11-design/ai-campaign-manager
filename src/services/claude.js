const Anthropic = require('@anthropic-ai/sdk');
const { logger } = require('../utils/logger');
const metaAds = require('./metaAds');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an expert Meta Ads AI Campaign Manager, integrated into WhatsApp. You help marketing teams manage Facebook and Instagram ad campaigns.

Your capabilities:
1. Fetch and analyze campaign performance data (ROAS, CTR, CPC, CPM, spend, impressions, clicks, conversions)
2. List all ad accounts the user manages
3. Generate detailed performance reports
4. Suggest concrete, data-driven optimizations
5. Propose budget changes (which require user approval before execution)

Response guidelines:
- Use WhatsApp-friendly formatting: *bold* for emphasis, bullet points with •
- Be concise but comprehensive — users are busy marketers
- Always include specific numbers and percentages when discussing performance
- When suggesting budget changes, ALWAYS explain your reasoning
- For budget/bid changes: flag them with "REQUIRES_APPROVAL:" prefix so the system can intercept
- Never execute budget changes without explicit user approval

Available tools you can call:
- get_ad_accounts: List all managed ad accounts
- get_campaigns: Get campaigns for an account
- get_campaign_performance: Get metrics for a campaign or account
- get_ad_sets: Get ad sets for a campaign
- suggest_optimization: Analyze and suggest improvements

When a user asks to change a budget, respond with:
REQUIRES_APPROVAL: [detailed description of the change]
APPROVAL_DATA: {"action": "update_budget", "campaignId": "...", "newBudget": ..., "currentBudget": ..., "currency": "...", "reason": "..."}

Always be helpful, proactive, and data-driven.`;

// Tool definitions for Claude
const tools = [
  {
    name: 'get_ad_accounts',
    description: 'Retrieve all Meta ad accounts the user manages, including account names, IDs, currency, and status.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'get_campaigns',
    description: 'Get all campaigns for a specific ad account.',
    input_schema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'The ad account ID (with act_ prefix)' },
        status_filter: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'ALL'], description: 'Filter by campaign status' }
      },
      required: ['account_id']
    }
  },
  {
    name: 'get_campaign_performance',
    description: 'Get detailed performance metrics for a campaign or account including ROAS, CTR, CPC, spend, impressions, clicks, and conversions.',
    input_schema: {
      type: 'object',
      properties: {
        account_id:   { type: 'string', description: 'The ad account ID' },
        campaign_id:  { type: 'string', description: 'Optional specific campaign ID' },
        date_preset:  { type: 'string', enum: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month'], description: 'Date range preset' }
      },
      required: ['account_id']
    }
  },
  {
    name: 'get_ad_sets',
    description: 'Get all ad sets within a campaign with their budgets, targeting, and performance.',
    input_schema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string', description: 'The campaign ID' }
      },
      required: ['campaign_id']
    }
  },
  {
    name: 'generate_report',
    description: 'Generate a comprehensive performance report for an account or campaign.',
    input_schema: {
      type: 'object',
      properties: {
        account_id:  { type: 'string', description: 'The ad account ID' },
        campaign_id: { type: 'string', description: 'Optional: specific campaign' },
        date_preset: { type: 'string', description: 'Date range for the report' }
      },
      required: ['account_id']
    }
  }
];

/**
 * Process a user message through Claude with tool use
 */
async function processWithClaude(userMessage, session, from, pendingApprovals) {
  const messages = [
    ...session.messages.slice(-10), // Last 10 messages for context
    { role: 'user', content: userMessage }
  ];

  let response;
  let finalText = '';
  let requiresApproval = false;
  let approvalData = null;

  try {
    // Agentic loop: Claude may call multiple tools
    let currentMessages = messages;
    let iterations = 0;
    const MAX_ITERATIONS = 5;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools,
        messages: currentMessages
      });

      logger.info('Claude response', { stop_reason: response.stop_reason, iterations });

      // Collect text blocks
      const textBlocks = response.content.filter(b => b.type === 'text');
      if (textBlocks.length) {
        finalText = textBlocks.map(b => b.text).join('\n');
      }

      // If no tool calls, we're done
      if (response.stop_reason === 'end_turn') break;

      // Process tool calls
      if (response.stop_reason === 'tool_use') {
        const toolUses = response.content.filter(b => b.type === 'tool_use');
        const toolResults = [];

        for (const toolUse of toolUses) {
          logger.info('Tool call', { tool: toolUse.name, input: toolUse.input });
          const result = await executeTool(toolUse.name, toolUse.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result)
          });
        }

        // Add assistant message + tool results and continue loop
        currentMessages = [
          ...currentMessages,
          { role: 'assistant', content: response.content },
          { role: 'user', content: toolResults }
        ];
        continue;
      }

      break;
    }

    // Check if final text contains an approval request
    if (finalText.includes('REQUIRES_APPROVAL:')) {
      requiresApproval = true;
      const approvalMatch = finalText.match(/APPROVAL_DATA:\s*(\{[\s\S]+?\})/);
      if (approvalMatch) {
        try {
          approvalData = JSON.parse(approvalMatch[1]);
        } catch (e) {
          logger.warn('Could not parse approval data JSON');
        }
      }
      // Clean the approval markers from user-visible text
      finalText = finalText
        .replace(/REQUIRES_APPROVAL:\s*/g, '')
        .replace(/APPROVAL_DATA:\s*\{[\s\S]+?\}/g, '')
        .trim();
    }

    return { text: finalText, requiresApproval, approvalData };

  } catch (err) {
    logger.error('Claude API error', { error: err.message });
    throw err;
  }
}

/**
 * Route tool calls to the appropriate Meta Ads functions
 */
async function executeTool(toolName, input) {
  try {
    switch (toolName) {
      case 'get_ad_accounts':
        return await metaAds.getAdAccounts();

      case 'get_campaigns':
        return await metaAds.getCampaigns(input.account_id, input.status_filter || 'ALL');

      case 'get_campaign_performance':
        return await metaAds.getCampaignPerformance(
          input.account_id,
          input.campaign_id,
          input.date_preset || 'last_7d'
        );

      case 'get_ad_sets':
        return await metaAds.getAdSets(input.campaign_id);

      case 'generate_report':
        return await metaAds.generateReport(
          input.account_id,
          input.campaign_id,
          input.date_preset || 'last_30d'
        );

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    logger.error('Tool execution error', { toolName, error: err.message });
    return { error: err.message };
  }
}

module.exports = { processWithClaude };
