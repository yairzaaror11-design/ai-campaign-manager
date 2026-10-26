# אפיון מנוע שיחה וזיכרון

גרסה: 1.0 | 26.10.2026 | סטטוס: אפיון יעד לאישור ומימוש מדורג

## UX
חלון צ'אט נגיש מכל מסך; רשימת שיחות, יצירת שיחה, טקסט, הקלטה אם נתמכת, קבצים לפי הרשאה, חיווי thinking/tool status, retry, stop, קישור לישות שנוצרה. שיחה בדשבורד ו-WhatsApp משתמשת באותו business context עם זהות מאומתת.
## מסע שיחה
Intent classification: create_campaign, analyze_performance, manage_lead, create_content, business_question, unknown. שאל שאלה אחת בכל פעם כשחסר מידע קריטי; אל תשאל מחדש פרטים שכבר אומתו אלא אם התיישנו/סותרים.
## זיכרון
Fact: business_id, key, value, source, confidence, verified_at, expires_at, visibility. הפרדה בין user assertion, inferred preference, third-party data. המשתמש יכול לצפות, לערוך ולמחוק זיכרונות עסקיים בהתאם למדיניות.
## כללי סוכן
LLM אינו מקור הרשאות; כל tool call עובר policy engine. prompt injection בתוכן לקוח/קבצים אינו יכול לשנות מדיניות. אין לחשוף סודות. אין להמציא תוצאות או לטעון שבוצעה פעולה לפני receipt.
## דוגמאות
משתמש: 'תעשה לי קמפיין ב-2,000 ₪'. מערכת: 'מה המטרה המרכזית: פניות, רכישות או חשיפה?' אם כבר ידוע העסק, לא לשאול שמו מחדש. בסיום: תקציר טיוטה + סיכונים + CTA 'אשר הכנת קמפיין מושהה'.
משתמש: 'למה עלה המחיר לליד?' מערכת: שולפת נתונים לתקופות נבחרות, בודקת שינוי הוצאה/CTR/CVR ומחזירה השערות מבוססות נתונים, מגבלות ופעולה מומלצת.
## ספקים
Provider abstraction ל-Gemini/Claude; timeouts, quotas, fallback מוגדר ללא שינוי סמוי של מדיניות פרטיות, logging ללא PII מיותר.
## בדיקות
Intent, state restoration, missing info, prompt injection, cross-tenant, approval bypass, WhatsApp identity mismatch, provider timeout.

## עקרונות מחייבים
- המוצר הוא הרחבה של Campaign Bachat הקיים, לא מערכת חלופית.
- יש לבצע תחילה inventory לקוד, סכמת הנתונים, הנתיבים, הבדיקות והאינטגרציות הקיימים. אין להניח שמרכיב מסוים כבר עובד ללא בדיקה.
- ממשק עברי מלא RTL; תמיכה עתידית ב-i18n, נגישות WCAG 2.2 AA ככל הניתן.
- כל נתון עסקי מבודד לפי tenant/business; אימות ואישור בצד שרת, לא רק בממשק.
- שום פרסום, שינוי תקציב, הפעלת קמפיין, שליחת הודעה חיצונית או פריסה לייצור ללא אישור מפורש ותקף.
- כל פעולת שינוי חיצונית דורשת idempotency key, audit log, ניהול retries ומצב ברור למשתמש.
- אין להשתמש בנתוני דמה כאילו הם נתונים אמיתיים. נתונים לדוגמה רק במצב demo מסומן.
- כל מסך כולל loading, empty, error, success, permission-denied ו-mobile states.
