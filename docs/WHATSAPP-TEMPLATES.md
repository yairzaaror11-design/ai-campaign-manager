# WhatsApp message templates to submit to Meta

WhatsApp lets SCORPIO start a conversation with a business owner only within 24 hours of the
owner's last message. Outside that window, Meta requires a pre-approved **template**. These three
templates let SCORPIO stay proactive. Submit them in WhatsApp Manager → Message templates →
Create template, category **Utility**, language **Hebrew (he)**, no variables, no buttons.

After Meta approves them, set in Render (Environment):

```
WHATSAPP_APPROVED_TEMPLATES=new_lead_alert,weekly_business_report,lead_followup_reminder
LEAD_ALERT_TEMPLATE=new_lead_alert
WEEKLY_REPORT_TEMPLATE=weekly_business_report
WEEKLY_REPORTS_ENABLED=true
```

## 1. `new_lead_alert`

> יש לך פנייה חדשה מהקמפיין. כדאי לחזור אליה כמה שיותר מהר. כתבו ״הלידים שלי״ כדי לראות את הפרטים ולקבל הודעה מוכנה לשליחה.

## 2. `weekly_business_report`

> הדוח העסקי השבועי שלך מוכן: כמה הושקע, כמה פניות הגיעו, כמה נסגרו ומה כדאי לעשות השבוע. כתבו ״דוח עסקי״ כדי לקבל אותו.

## 3. `lead_followup_reminder`

> יש פניות שמחכות לעדכון. עדכון קצר של מה קרה עם כל פנייה עוזר לדעת איזה קמפיין באמת מביא לקוחות. כתבו ״הפניות שלי״ כדי לעדכן.

## How each feature behaves

| Feature | Inside the 24h window | Outside the window |
|---|---|---|
| New lead alert (`leadAlert.js`) | Full details + ready reply + one-tap `wa.me` link | `new_lead_alert` template (if set) |
| Weekly report (`scheduledReports.js`, Sundays from 09:00 Israel time) | Full report | `weekly_business_report` template, opted-in owners only |
| Lead check-ins (`leadCheckins.js`, Sun–Fri 09:00–20:00) | Question with status buttons | Not sent (owners can write ״הפניות שלי״) |

## Lead concierge templates (messages to the LEAD, in the business's name)

The lead concierge (`leadConcierge.js`, `LEAD_CONCIERGE_ENABLED=true` + the owner's opt-in) writes
first to a lead who filled a Meta lead form. A first message to someone who never wrote to our
number requires an approved template **with variables**. Language **Hebrew (he)**. Meta decides the
category; submit as **Utility** (answering the lead's own request) and accept **Marketing** if Meta
reclassifies it. Without an approved template the concierge falls back to today's owner alert.

### 4. `lead_first_contact` — body with 3 variables + 2 quick-reply buttons

```
שלום {{1}}, כאן {{2}} 👋
קיבלנו את הפרטים שהשארתם לגבי {{3}}, ונשמח לעזור.
כדי שנוכל לעזור בדיוק במה שצריך, אפשר לשאול כמה שאלות קצרות?
לא מעוניינים בפניות מאיתנו? כתבו ״הסר״.
```

- Sample values for Meta review: {{1}} = `דנה`, {{2}} = `נדל״ן כהן`, {{3}} = `דירת 4 חדרים בגבעתיים`
- One template serves every business type (real estate, services, shops, fitness, other).
- Quick-reply buttons: `כן, אפשר` and `הסר`
- {{1}} is the lead's first name (or `לכם` when unknown), {{2}} the business name, {{3}} the listing/product the form belongs to, else a phrase by business type (`חיפוש נכס`, `הפנייה שלכם`, `המוצר שהתעניינתם בו`, `האימונים`).

### 5. `viewing_reminder` (optional) — body with 2 variables

```
תזכורת מ{{1}}: מחכים לכם היום בשעה {{2}}. אם משהו השתנה, השיבו להודעה הזו. להסרה כתבו ״הסר״.
```

- Sample values: {{1}} = `נדל״ן כהן`, {{2}} = `17:00`
- Used only when the lead's 24h window is closed; inside it the reminder is a normal message.
  Without it, the owner is told to call the lead instead.

```
WHATSAPP_APPROVED_TEMPLATES=...,lead_first_contact,viewing_reminder
WA_TEMPLATE_LEAD_FIRST_CONTACT=lead_first_contact
WA_TEMPLATE_VIEWING_REMINDER=viewing_reminder
LEAD_CONCIERGE_ENABLED=true
```
