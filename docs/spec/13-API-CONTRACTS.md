# חוזי API מוצעים

גרסה: 1.0 | 26.10.2026 | סטטוס: אפיון יעד לאישור ומימוש מדורג

## כללים
Prefix `/api/v1`; auth session/JWT בהתאם לתשתית קיימת; business context נגזר מהרשאות ולא רק מפרמטר שהלקוח שולח; pagination cursor; errors סטנדרטיים `{code,message,requestId,details}`; timestamps ISO8601 UTC; סכומים במינור יוניט או decimal מוגדר; rate limits.
## Endpoints יעד (להתאים לקיים)
GET `/me`; GET/POST `/businesses`; GET/PATCH `/businesses/:id`; GET `/businesses/:id/overview?from=&to=`; GET `/businesses/:id/campaigns`; POST `/businesses/:id/campaign-drafts`; GET/PATCH `/businesses/:id/campaign-drafts/:draftId`; POST `/businesses/:id/approval-requests`; POST `/businesses/:id/approvals/:id/approve`; POST `/businesses/:id/approvals/:id/reject`; GET `/businesses/:id/approvals`; GET/POST `/businesses/:id/leads`; GET/PATCH `/businesses/:id/leads/:id`; GET/POST `/businesses/:id/tasks`; GET/POST `/businesses/:id/conversations`; POST `/businesses/:id/conversations/:id/messages`; GET `/businesses/:id/activity`; GET `/businesses/:id/integrations`.
## דוגמת response ל-overview
`{period:{from,to},currency:"ILS",sync:{status:"ok",lastSyncedAt:"..."},metrics:{spend:{value:"3420.00",source:"meta"},leads:{value:87,source:"crm"},cpl:{value:"39.31",definition:"spend/crm_leads"}},campaigns:[],pendingApprovals:[]}`. ערכים דוגמתיים בלבד.
## דוגמת אישור
POST approval request body `{actionType:"ACTIVATE_CAMPAIGN",resourceId:"...",payloadHash:"...",version:3}`; approve דורש auth+role+CSRF/replay protection, גרסה זהה ואישור שלא פג. תוצאה `{approvalId,state,executionJobId}` ולא טענה שהפעולה הושלמה לפני receipt.
## Webhooks
Meta/WhatsApp/Telnyx לפי מה שמחובר בפועל: אימות חתימה על raw body, replay protection, dedupe, ACK מהיר, async queue, observability, quarantine לאירועים שגויים.
## OpenAPI
Codex יפיק OpenAPI 3.1 מתוך המימוש או schema מקורית, בדיקות חוזה ו-types ל-frontend. אין להוסיף endpoint כפול אם קיים מקביל.

## עקרונות מחייבים
- המוצר הוא הרחבה של Campaign Bachat הקיים, לא מערכת חלופית.
- יש לבצע תחילה inventory לקוד, סכמת הנתונים, הנתיבים, הבדיקות והאינטגרציות הקיימים. אין להניח שמרכיב מסוים כבר עובד ללא בדיקה.
- ממשק עברי מלא RTL; תמיכה עתידית ב-i18n, נגישות WCAG 2.2 AA ככל הניתן.
- כל נתון עסקי מבודד לפי tenant/business; אימות ואישור בצד שרת, לא רק בממשק.
- שום פרסום, שינוי תקציב, הפעלת קמפיין, שליחת הודעה חיצונית או פריסה לייצור ללא אישור מפורש ותקף.
- כל פעולת שינוי חיצונית דורשת idempotency key, audit log, ניהול retries ומצב ברור למשתמש.
- אין להשתמש בנתוני דמה כאילו הם נתונים אמיתיים. נתונים לדוגמה רק במצב demo מסומן.
- כל מסך כולל loading, empty, error, success, permission-denied ו-mobile states.
