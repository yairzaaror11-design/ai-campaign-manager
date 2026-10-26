# 18. Billing, Plans and Credits | Campaign Bachat

## Goal
Implement a subscription and credits management area in the existing dashboard, visually inspired by the supplied screenshot. All prices below are DEMO reference values, not approved commercial pricing. Do not initiate real payments or enable production billing without explicit approval.

## Navigation and screens
- Sidebar: "מנוי ומטבעות".
- Dashboard balance widget: "נותרו לך {credits} מטבעות".
- Billing page: active plan, next renewal, credits remaining, usage by feature, invoices and transactions.
- Upgrade modal: overlay, close button, title "שדרג את התוכנית שלך", remaining credits, two tabs "שדרוג חבילה" and "רכישת מטבעות".
- Plans tab: two responsive cards, name, price per month, credits, limits for chat/video/landing pages/banners, social connections, brands, support, CTA "שדרג"; recommended badge "מומלץ".
- Credit packs tab: three cards, quantity, price, price per credit, CTA "רכוש"; badge "פופולרי".
- Purchase confirmation, checkout pending/success/failure, billing history, usage and balance details.

## Screenshot-derived example catalog, demo only
Growth: $149/month, 15,000 credits, 170 chat messages, 15 videos, 30 landing pages, 75 banners, social channels, multi-brand.
Ultra: $299/month, 33,200 credits, 300 chat messages, 33 videos, 66 landing pages, 166 banners, social channels, priority support.
Credit packs: 1,000/$25, 2,500/$49, 10,000/$129.
Show demo prices only in development or behind a feature flag until owner approves real pricing, taxes, renewal terms and credit policy.

## UI copy
"נותרו לך {credits} מטבעות"; "שדרג את התוכנית שלך"; "שדרוג חבילה"; "רכישת מטבעות"; "חבילת צמיחה"; "חבילת אולטרה"; "מומלץ"; "פופולרי"; "שדרג"; "רכוש"; "תמיכה בעדיפות"; "ריבוי מותגים"; "אישור רכישה"; "אין מספיק מטבעות לביצוע הפעולה"; "פעולה זו תעלה {credits} מטבעות. להמשיך?"; "התשלום בבדיקה"; "התשלום התקבל והיתרה עודכנה"; "לא ניתן להשלים את התשלום. נסו שוב."

## Billing rules
- Backend is the sole authority for credit balances, quotas and prices.
- Store append-only credit ledger with atomic debits, reservations and refunds for failed async jobs.
- Idempotency keys for usage and payment events, with concurrency protection against negative balances.
- Feature cost table must be configurable and versioned; show estimated cost before expensive operations.
- Track subscription quotas separately from credit balances; clearly define exhaustion behavior.
- Never accept price or credit amounts supplied by browser clients.
- Hosted PCI-compliant checkout only; do not store payment card details.
- Verify payment webhook signatures; support duplicate/out-of-order events.
- Keep subscriptions, invoices, events and ledgers tenant-scoped; enforce RBAC and audit logging.
- Credit expiry, rollover, renewals, cancellations, proration, refunds, taxes and currency must be approved before production billing.

## Data model (inspect existing tables before migration)
BillingPlan, PlanVersion, PlanFeature, CreditPack, Subscription, Invoice, CheckoutSession, PaymentEvent, CreditLedger, UsageEvent, FeatureCost. All tenant data must be scoped and indexed. Unique constraints on provider event IDs and idempotency keys.

## Suggested API (adapt to existing routing)
GET /api/billing/overview
GET /api/billing/plans
GET /api/billing/packs
GET /api/billing/usage
GET /api/billing/transactions
POST /api/billing/checkout-session
POST /api/billing/webhooks/:provider

## Visual and accessibility behavior
RTL, responsive cards (2 columns desktop, 1 mobile), darkened overlay, modal max-width ~900px, green accent, clear selected tab, LTR numeric spans for USD prices. Accessible tabs, keyboard navigation, focus trap, Esc close, loading/empty/error states, and explicit recurring payment terms.

## Tests and acceptance
1. Modal tabs and plan cards render correctly on 375/768/1440px screens.
2. Values are loaded from backend catalog, not hardcoded in UI.
3. Insufficient credits block paid operation with understandable prompt.
4. Concurrent/retried operations cannot double-debit or overdraw.
5. Duplicate or forged webhooks cannot grant credits.
6. Failed/cancelled checkout never grants credits.
7. Tenant isolation and permission tests pass.
8. No live charges or subscriptions during testing.
