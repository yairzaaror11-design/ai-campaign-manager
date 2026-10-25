const { GoogleGenAI } = require('@google/genai');
const meta = require('./metaAds');
const { createActionPlan } = require('./actionPlan');

const SYSTEM = `You are Campaign Bachat, a Hebrew-first professional Meta Ads campaign manager inside WhatsApp.

RULES:
1. Reply in the user's language, default Hebrew.
2. Never invent Meta facts. Use read tools.
3. Distinguish facts from recommendations.
4. For every Meta write/change request, call propose_action. Never execute directly.
5. Resolve account/campaign IDs using read tools when needed.
6. Ask only for critical missing information.
7. Preserve recent context.
8. Never expose secrets.
9. Keep WhatsApp responses concise.
10. Currency/timezone come from Meta when available.
11. Ambiguous targets require clarification.
12. All newly created Campaigns, Ad Sets and Ads must initially be PAUSED.
13. Budget values from the user are human currency units. Do not invent minor-unit conversions.
14. Never claim a write happened. Execution is controlled outside Gemini.

SUPPORTED WRITE INTENTS:
CREATE_CAMPAIGN, CREATE_ADSET, CREATE_AD, CHANGE_BUDGET,
PAUSE_CAMPAIGN, RESUME_CAMPAIGN, EDIT_CAMPAIGN.`;

const functionDeclarations = [
  {
    name: 'get_ad_accounts',
    description: 'List available Meta ad accounts.',
    parameters: { type: 'OBJECT', properties: {} }
  },
  {
    name: 'get_campaigns',
    description: 'List campaigns for an ad account.',
    parameters: {
      type: 'OBJECT',
      properties: { account_id: { type: 'STRING' } },
      required: ['account_id']
    }
  },
  {
    name: 'get_campaign_performance',
    description: 'Read campaign-level performance for an ad account.',
    parameters: {
      type: 'OBJECT',
      properties: {
        account_id: { type: 'STRING' },
        date_preset: {
          type: 'STRING',
          enum: [
            'today','yesterday','last_7d','last_14d',
            'last_30d','this_month','last_month'
          ]
        }
      },
      required: ['account_id']
    }
  },
  {
    name: 'get_campaign_insights',
    description: 'Read performance for one campaign.',
    parameters: {
      type: 'OBJECT',
      properties: {
        campaign_id: { type: 'STRING' },
        date_preset: {
          type: 'STRING',
          enum: [
            'today','yesterday','last_7d','last_14d',
            'last_30d','this_month','last_month'
          ]
        }
      },
      required: ['campaign_id']
    }
  },
  {
    name: 'propose_action',
    description: 'Create a structured proposal. This never executes.',
    parameters: {
      type: 'OBJECT',
      properties: {
        intent: {
          type: 'STRING',
          enum: [
            'CREATE_CAMPAIGN','CREATE_ADSET','CREATE_AD','CHANGE_BUDGET',
            'PAUSE_CAMPAIGN','RESUME_CAMPAIGN','EDIT_CAMPAIGN'
          ]
        },
        summary: { type: 'STRING' },
        target: {
          type: 'OBJECT',
          properties: {
            accountId: { type: 'STRING' },
            accountName: { type: 'STRING' },
            campaignId: { type: 'STRING' },
            campaignName: { type: 'STRING' }
          }
        },
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            objective: { type: 'STRING' },
            dailyBudget: { type: 'NUMBER' },
            currency: { type: 'STRING' },
            campaignId: { type: 'STRING' },
            adsetId: { type: 'STRING' },
            creativeId: { type: 'STRING' },
            status: { type: 'STRING' },
            notes: { type: 'STRING' }
          }
        },
        missing: { type: 'ARRAY', items: { type: 'STRING' } },
        confidence: { type: 'NUMBER' }
      },
      required: ['intent', 'summary']
    }
  }
];

async function runTool(name, args = {}) {
  if (name === 'get_ad_accounts') return meta.getAdAccounts();
  if (name === 'get_campaigns') return meta.getCampaigns(args.account_id);
  if (name === 'get_campaign_performance') {
    return meta.getCampaignPerformance(args.account_id, args.date_preset);
  }
  if (name === 'get_campaign_insights') {
    return meta.getCampaignInsights(args.campaign_id, args.date_preset);
  }
  if (name === 'propose_action') {
    return { actionPlan: createActionPlan(args) };
  }
  return { error: 'Unknown tool' };
}

function toGeminiHistory(history = []) {
  return history.slice(-12).map((item) => ({
    role: item.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(item.content || '') }]
  }));
}

async function processWithGemini(text, history = [], options = {}) {
  if (!options.ai && !process.env.GEMINI_API_KEY) throw Error('GEMINI_API_KEY is not configured');

  const ai = options.ai || new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const chat = ai.chats.create({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    history: toGeminiHistory(history),
    config: {
      systemInstruction: SYSTEM,
      tools: [{ functionDeclarations }],
      maxOutputTokens: Math.max(128, Math.min(2048, Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 1024)),
      httpOptions: { timeout: Math.max(3000, Math.min(30000, Number(process.env.GEMINI_TIMEOUT_MS) || 12000)) }
    }
  });

  let response = await chat.sendMessage({ message: String(text || '') });
  const collectedPlans = [];

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const calls = response.functionCalls || [];
    if (calls.length > 5) throw Error('AI tool call limit exceeded');

    if (!calls.length) {
      return {
        text: String(response.text || '').trim() || 'לא הצלחתי להפיק תשובה כרגע.',
        actionPlans: collectedPlans
      };
    }

    const functionResponses = [];

    for (const call of calls) {
      try {
        const result = await runTool(call.name, call.args || {});
        if (result?.actionPlan) collectedPlans.push(result.actionPlan);

        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: { result }
          }
        });
      } catch (error) {
        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: { error: error.message }
          }
        });
      }
    }

    response = await chat.sendMessage({ message: functionResponses });
  }

  return {
    text: 'לא הצלחתי להשלים את הבקשה כרגע.',
    actionPlans: collectedPlans
  };
}

module.exports = { processWithGemini, toGeminiHistory, SYSTEM };
