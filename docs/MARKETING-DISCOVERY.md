# Hebrew marketing discovery

The app now bundles the original 500-question Campaign Bachat catalogue in `data/marketing-questions.he.json`. It includes the requested category counts, question metadata, source table, descriptive conversation rules and synthetic examples. Sources support topics and principles only; no individual question is attributed to a source. The XLSX is an editorial deliverable, not a runtime dependency.

## What the chat uses

- `שלום`, `/start`, `נתחיל` or `אני רוצה קמפיין` starts or resumes discovery without requiring a Meta connection.
- Seven deterministic routes: onboarding, audience, lead quality/sales, profitability, measurement, creative and experiment planning. Examples: `בדיקת רווחיות`, `בדיקת מדידה`, `איכות לידים`, `תכנון ניסוי`.
- Each reply asks one catalogue question. After three new answers the app summarizes and waits for `נמשיך` or `כן`. `עצור` pauses; `סיכום אפיון` shows the current summary.
- `לא ידוע` stores null/unknown and continues without inventing a number. `לא רלוונטי` is explicit. `בערך ...` is estimated. A question or new action request during discovery goes to the existing AI path, without overwriting the pending answer.
- `עדכן BUS-001 ...` corrects an existing answer with a bounded history. `אפיון חדש` starts a new plan while reusing business facts. `/reset` clears the current interview session but preserves saved business facts, matching the existing conversational-reset semantics.
- Amounts require an explicit supported currency; simple counts, dates and percentages are validated. Compound qualitative/period answers remain reported text, not verified measurements. The module does not calculate profitability or infer a viable budget from incomplete answers.

All 500 questions are available through the bounded, read-only `get_marketing_questions` AI tool. Current-tenant answers are available through `get_marketing_answers`, using server-side tenant context. Gemini and Claude share both tools and the same bounded untrusted profile context. Neither tool changes ads or saves inferred answers. Only explicit responses to pending interview questions are saved. Spontaneously supplied facts in a general AI conversation are not automatically extracted into the profile.

The seven routes have explicit question lists and a small number of implemented applicability checks. Descriptive activation conditions, the original 22 conversation rules and ten example routes in the JSON are reference content, not a general executable rules engine. Do not imply every decision condition has been automated. In the measurement route, a website and an online checkout are distinct: no website skips website event questions, while a website without checkout can still receive form-measurement questions.

## Storage and compatibility

Migration `005_marketing_profiles.sql` adds one table, keyed by client with ON DELETE CASCADE. Existing migration files are unchanged. Each answer has question ID, semantic field, scope, status, value, user source, verification timestamp and bounded history. Business answers are reusable across plans; goals, financial assumptions, creative and measurement data are scoped to the current plan. Current API collects one plan at a time; simultaneous offer/campaign-specific work requires separate explicit scope support rather than reusing this profile as verified campaign data.

Transactions use the existing deletion lock order, lock the tenant row and profile, and cache the last 24 event responses. An inbound retry within that cache returns the same reply rather than consuming another answer. Existing inbound/outbox event deduplication remains in place. Profiles are capped at 128 KB. Retention deletes inactive profiles under the existing DATA_RETENTION_DAYS setting. Tenant deletion cascades to the new table and cannot recreate a deleted client.

Starting a legacy `/brief TYPE` can prefill known business name, selected product, audience and explicitly selected audience geography from the profile. Service availability alone is not treated as targeting. Unknown/estimated values and monthly budgets never seed daily campaign settings. Existing account ownership, versioned approval, campaign execution, report and graphics paths remain in control.

Set `MARKETING_DISCOVERY_ENABLED=false` to bypass the interview and profile prompt/brief integration. The new catalogue read tool remains available. No new provider dependency is required.

## Validation and release

Unit tests cover all category totals, route references, unknowns, scopes, corrections, typed boundaries, website/checkout gating, interruption and both providers. Embedded PostgreSQL tests cover migrations, tenant isolation, replay, deletion, brief seeds, and the actual inbound WhatsApp router with an intercepted sender. Existing regression tests must pass before release.

CI now also runs on PRs targeting the current development branch and checks out the event's actual commit rather than a fixed branch. This is necessary for the feature PR to test the proposed code.

No production database, deployed service, ad budget or WhatsApp recipient was changed during implementation. Deployment applies the new migration at startup under the existing migration runner. Before deployment, verify backup/recovery using the established release process, then deploy the reviewed commit. Rollback can disable discovery or restore the preceding compatible app; the additional table need not be dropped. A live conversation test remains an operator step after deployment.
