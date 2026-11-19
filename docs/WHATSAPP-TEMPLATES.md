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
