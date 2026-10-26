# ניהול קמפיינים ומנגנון אישורים

גרסה: 1.0 | 26.10.2026 | סטטוס: אפיון יעד לאישור ומימוש מדורג

## ישויות
CampaignDraft, Campaign, AdSet, Ad, Creative, AdAccount, BudgetProposal, ApprovalRequest, ExecutionJob.
## בניית טיוטה
Wizard או צ'אט: objective > business offer > audience > geography > budget > schedule > placements > creatives > review. כל שדה מסומן כמקור user/AI/external, וכל המלצת AI ניתנת לעריכה.
## תהליך אישור דו-שלבי
(1) אישור תוכנית/יצירת קמפיין PAUSED; (2) אישור נפרד להפעלה. שינוי תקציב, pause/unpause, מחיקת מודעות ושינוי targeting דורשים אישור ייעודי. אישור חתום ל-user, business, resource, action, payload_hash, expiry, version; שימוש חד-פעמי.
## מצבי טיוטה
DRAFT, NEEDS_INFO, READY_FOR_REVIEW, APPROVED_FOR_CREATE, CREATING, CREATED_PAUSED, ACTIVATION_PENDING, ACTIVE, FAILED, CANCELLED. מצבי ספק ממופים בזהירות ולא מוצגים כ'פעיל' ללא אימות.
## API Meta
בדוק הרשאות app review ו-scopes בפועל; השתמש ב-API version מוגדרת; טיפול ב-rate limits, partial failure, token refresh/reconnect; audit של מזהי משאבים בלבד. תוצאות פרסום לפי timezone/currency של חשבון המודעות.
## מדדים
Spend, impressions, reach, clicks, CTR, CPC, CPM, leads, CPL; לכל metric הגדרה, attribution window, תקופה, source, sync timestamp. אין לערבב lead count של CRM עם results של Meta בלי תווית.
## תנאי קבלה
טיוטה אינה מפרסמת; אישור פג אינו תקף; שינוי payload מבטל אישור; בקשה כפולה אינה יוצרת כפילות; כשל חלקי מתועד וניתן להתאוששות.

## עקרונות מחייבים
- המוצר הוא הרחבה של Campaign Bachat הקיים, לא מערכת חלופית.
- יש לבצע תחילה inventory לקוד, סכמת הנתונים, הנתיבים, הבדיקות והאינטגרציות הקיימים. אין להניח שמרכיב מסוים כבר עובד ללא בדיקה.
- ממשק עברי מלא RTL; תמיכה עתידית ב-i18n, נגישות WCAG 2.2 AA ככל הניתן.
- כל נתון עסקי מבודד לפי tenant/business; אימות ואישור בצד שרת, לא רק בממשק.
- שום פרסום, שינוי תקציב, הפעלת קמפיין, שליחת הודעה חיצונית או פריסה לייצור ללא אישור מפורש ותקף.
- כל פעולת שינוי חיצונית דורשת idempotency key, audit log, ניהול retries ומצב ברור למשתמש.
- אין להשתמש בנתוני דמה כאילו הם נתונים אמיתיים. נתונים לדוגמה רק במצב demo מסומן.
- כל מסך כולל loading, empty, error, success, permission-denied ו-mobile states.
