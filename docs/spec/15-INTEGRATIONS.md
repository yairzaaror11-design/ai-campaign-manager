# אינטגרציות

גרסה: 1.0 | 26.10.2026 | סטטוס: אפיון יעד לאישור ומימוש מדורג

## Meta Marketing API
OAuth/Business Login, token lifecycle, ad account selection, insights polling, campaign draft creation PAUSED, activation after explicit approval. Review app permissions and production eligibility; test account first.
## WhatsApp Cloud API
Webhook inbound verified, dedupe external_message_id, async processing, outbound window/template constraints, delivery receipts, identity linking to user account, conversation state persistence, media handling, rate limits.
## AI providers
Gemini/Claude behind provider adapter; structured outputs validated server-side, token/cost limits, retry policies, prompt versioning, PII minimization, observability.
## Telnyx
Only if current deployment requires SMS verification or messaging. Separate webhook signature verification and access control. Do not assume SMS is WhatsApp message transport.
## Render/PostgreSQL
Read-only environment inventory before change; verify active commit, auto-deploy state, database backups, isolated restore, DB expiry and public access. Do not deploy until safeguards verified.
## אחסון מדיה
S3-compatible or existing provider; private buckets, signed URLs, retention; validate ownership on download.
## Failure matrix
Meta disconnected -> banner + reconnect; WhatsApp provider down -> queue + status; AI timeout -> retry/cancel; DB unavailable -> no destructive fallback; sync stale -> show timestamp, no fabricated metrics.

## עקרונות מחייבים
- המוצר הוא הרחבה של Campaign Bachat הקיים, לא מערכת חלופית.
- יש לבצע תחילה inventory לקוד, סכמת הנתונים, הנתיבים, הבדיקות והאינטגרציות הקיימים. אין להניח שמרכיב מסוים כבר עובד ללא בדיקה.
- ממשק עברי מלא RTL; תמיכה עתידית ב-i18n, נגישות WCAG 2.2 AA ככל הניתן.
- כל נתון עסקי מבודד לפי tenant/business; אימות ואישור בצד שרת, לא רק בממשק.
- שום פרסום, שינוי תקציב, הפעלת קמפיין, שליחת הודעה חיצונית או פריסה לייצור ללא אישור מפורש ותקף.
- כל פעולת שינוי חיצונית דורשת idempotency key, audit log, ניהול retries ומצב ברור למשתמש.
- אין להשתמש בנתוני דמה כאילו הם נתונים אמיתיים. נתונים לדוגמה רק במצב demo מסומן.
- כל מסך כולל loading, empty, error, success, permission-denied ו-mobile states.
