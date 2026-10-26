# הוראת ביצוע ל-Codex

גרסה: 1.0 | 26.10.2026 | סטטוס: אפיון יעד לאישור ומימוש מדורג

## משימה
המשך פיתוח מערכת Campaign Bachat במאגר `yairzaaror11-design/ai-campaign-manager`. בנה Dashboard + CRM + UI ל-AI + ממשקי קמפיינים בהתאם למסמכי אפיון אלה. אל תבנה מוצר נפרד ואל תשכתב תשתית עובדת ללא צורך.
## שלב 0: Discovery מחייב
בדוק branch/PR הפעילים, commits, מבנה קוד, package scripts, סכמת DB, migrations, endpoints, auth, roles, webhooks, WhatsApp, Meta, AI, Render config, tests. צור `docs/implementation-gap-analysis.md` עם מפת קיים/חסר/סיכון ותוכנית שינוי מינימלית. אם ענף PR #1 עדיין קיים ומתאים, השתמש בו לאחר אימות; אחרת צור feature branch חדש מבסיס בטוח. אל תשנה main או render-safe-deploy ללא הנחיה מפורשת.
## שלב 1: UI foundation
Design tokens, RTL shell, Sidebar, Topbar, reusable components, routing, skeletons, error boundaries, accessible keyboard navigation, responsive. הוסף Storybook/gallery לפי הקיים.
## שלב 2: Dashboard
Overview API עם metrics אמיתיים או empty states; KPI, charts, campaigns table, recommendations, approvals, date filters; test loading/error/permission.
## שלב 3: CRM
Additive migrations אחרי השוואת סכמה; tenant-scoped CRUD leads/tasks, validation, audit, list/detail UI, filters, pagination; no destructive migrations.
## שלב 4: Chat
חבר UI למנוע שיחה קיים, persisted conversations, memory read/update permission, shared context across channels only with verified identity, approval-aware tools.
## שלב 5: Campaigns
List/detail, draft workflow, review, PAUSED creation, separate activation approval, execution jobs with idempotency; test in sandbox only.
## שלב 6: Integrations and polish
Connection status, alerts, creative copy/assets minimal, accessibility, mobile, metrics consistency, audit trail.
## שלב 7: QA
Unit, integration, E2E, security/tenant tests, migration dry run, visual snapshots, API docs, update README; fix failures; open PR with detailed report.
## מגבלות פעולה
אין פריסה לייצור; אין הפעלת קמפיינים, שינוי תקציב, שליחת הודעות אמיתיות, רכישות, מחיקת נתונים או שינוי הרשאות ספק ללא אישור מפורש. אל תציג secrets. אל תשנה branch main. לפני כל שינוי שעלול לפרוס אוטומטית, אמת Auto-Deploy כבוי.
## כללי עבודה
בצע משימות עצמאית בלי שאלות חוזרות כאשר ההחלטות כבר מפורטות; אם חסר פרט שאינו חוסם, בחר default בטוח ותעד. אם חסרה הרשאה/מידע מהותי, עצור רק בנקודה החוסמת והצג בדיוק מה נדרש. לאחר כל שלב: קוד, בדיקות, תיעוד, תוצאות.
## תנאי סיום
PR מוכן לבדיקה עם UI עובד על נתונים אמיתיים/empty state, כל ה-endpoints מוגנים, בדיקות ירוקות, תיעוד מפורט, רשימת בדיקות ידניות ותלויות פתוחות. אין להכריז 'מוכן להשקה' לפני אימות גיבוי ושחזור וחיבורים חיים.

## עקרונות מחייבים
- המוצר הוא הרחבה של Campaign Bachat הקיים, לא מערכת חלופית.
- יש לבצע תחילה inventory לקוד, סכמת הנתונים, הנתיבים, הבדיקות והאינטגרציות הקיימים. אין להניח שמרכיב מסוים כבר עובד ללא בדיקה.
- ממשק עברי מלא RTL; תמיכה עתידית ב-i18n, נגישות WCAG 2.2 AA ככל הניתן.
- כל נתון עסקי מבודד לפי tenant/business; אימות ואישור בצד שרת, לא רק בממשק.
- שום פרסום, שינוי תקציב, הפעלת קמפיין, שליחת הודעה חיצונית או פריסה לייצור ללא אישור מפורש ותקף.
- כל פעולת שינוי חיצונית דורשת idempotency key, audit log, ניהול retries ומצב ברור למשתמש.
- אין להשתמש בנתוני דמה כאילו הם נתונים אמיתיים. נתונים לדוגמה רק במצב demo מסומן.
- כל מסך כולל loading, empty, error, success, permission-denied ו-mobile states.


## Extension: subscription and credits
Read `18-BILLING-PLANS-CREDITS.md` and implement billing UI in demo mode first. No production payment activation or real charges without owner approval. Inspect and reuse existing billing models if any. Add automated tests.
