# AI provider integration — Task 2 (2026-10-27)

## Observed architecture
- aiService.js already implements a provider registry via registerProvider, selects process.env.AI_PROVIDER (default gemini), and dispatches processMessage and analyzeConversation.
- gemini.js uses @google/genai and declares read/propose-action tools; system prompt explicitly forbids direct campaign writes.
- claude.js uses Anthropic Messages HTTP endpoint, timeout 30 seconds for messages and 12 seconds for analysis, injected test client, max_tokens 2048/1800 and tool round cap 6. No paid request made.
- aiService.js rejects empty/oversized input, invalid outputs, too many action plans and planningOnly action plans.

## Gaps
No confirmed per-tenant usage accounting, cost ceiling, structured timeout taxonomy or safe provider fallback policy. Claude implementation shares Gemini tool execution interface; this is useful reuse but requires provider-neutral tool adapter tests. Automatic fallback during write proposal risks duplicate actions unless the operation is idempotent and no provider tools were executed.

## Recommended provider contract
Provider.process({tenantId, task, messages, context, deadline, tokenBudget, requestId}) -> {text, actionPlans, usage:{inputTokens,outputTokens}, provider, model}; explicit retryable vs permanent error classes; no secret logging. Route by task and budget, not only global env var. Never fall back after an uncertain side effect. Validate tenant context before dispatch and reject unapproved writes outside model layer.

## Test plan (not run here)
Inject deterministic fake Gemini/Claude clients, test timeout, malformed output, tenant context isolation, budget limit, planningOnly prohibition, duplicate tool-call idempotency and fallback safety. Live AI calls require separate authorization and spending cap.
