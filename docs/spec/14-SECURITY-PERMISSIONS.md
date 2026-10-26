# אבטחה והרשאות

גרסה: 1.0 | 26.10.2026 | סטטוס: אפיון יעד לאישור ומימוש מדורג

## אבטחת חשבונות
OIDC/OAuth או auth קיים, cookies HttpOnly/Secure/SameSite לפי ארכיטקטורה, הגנה CSRF, הגבלת ניסיונות, session revocation, MFA לבעלי הרשאות גבוהות אם זמין.
## Multi-tenancy
בדיקת membership לכל endpoint וכל job; business_id תמיד מהקשר מורשה; בדיקות IDOR לכל entity; קבצים חתומים/מבודדים; tenant context גם ב-AI tools וב-webhooks.
## ספקים וסודות
Tokens בצד שרת בלבד, secret manager/env מוגן, הצפנה במנוחה, rotation, מינימום scopes, log redaction, איסור secrets בתשובות AI ובדפדפן.
## פעולות רגישות
approval bound to action/payload hash/version/tenant/actor/expiry, one-time use; separation between draft and activation; audit immutable ככל הניתן; safe retries; no silent spending.
## פרטיות
הסכמה לעיבוד מידע, הודעות שיווק רק בכפוף לדין ול-opt-in, זכויות גישה/מחיקה, retention, הפרדה בין נתוני אנליטיקה לתוכן שיחות, תנאי שימוש ומדיניות פרטיות מאושרים לפני השקה.
## תפעול
Rate limiting, input validation, output encoding, upload scanning, dependency scanning, SAST, structured logs, alerting, backup+restore verified, least privilege DB, ניטור expiry מסד Render.
## בדיקות חובה
Cross-tenant read/write, replay approvals, stale version, forged webhook, prompt injection, leaked secret, malformed upload, rate-limit, CSRF/XSS, provider timeout, job duplication.

## עקרונות מחייבים
- המוצר הוא הרחבה של Campaign Bachat הקיים, לא מערכת חלופית.
- יש לבצע תחילה inventory לקוד, סכמת הנתונים, הנתיבים, הבדיקות והאינטגרציות הקיימים. אין להניח שמרכיב מסוים כבר עובד ללא בדיקה.
- ממשק עברי מלא RTL; תמיכה עתידית ב-i18n, נגישות WCAG 2.2 AA ככל הניתן.
- כל נתון עסקי מבודד לפי tenant/business; אימות ואישור בצד שרת, לא רק בממשק.
- שום פרסום, שינוי תקציב, הפעלת קמפיין, שליחת הודעה חיצונית או פריסה לייצור ללא אישור מפורש ותקף.
- כל פעולת שינוי חיצונית דורשת idempotency key, audit log, ניהול retries ומצב ברור למשתמש.
- אין להשתמש בנתוני דמה כאילו הם נתונים אמיתיים. נתונים לדוגמה רק במצב demo מסומן.
- כל מסך כולל loading, empty, error, success, permission-denied ו-mobile states.
