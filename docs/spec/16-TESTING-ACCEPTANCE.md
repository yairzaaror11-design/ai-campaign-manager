# בדיקות וקריטריוני קבלה

גרסה: 1.0 | 26.10.2026 | סטטוס: אפיון יעד לאישור ומימוש מדורג

## איכות
Typecheck, lint, unit, integration, contract, migration, security, E2E, accessibility, RTL visual, responsive. CI green נדרש אך אינו תחליף לבדיקות חיות.
## תרחישי E2E
1. הרשמה > עסק > חיבור Meta sandbox > KPI.
2. בקשת קמפיין בצ'אט > טיוטה > שינוי > אישור יצירה > יצירת PAUSED > אישור נפרד להפעלה.
3. משתמש ללא הרשאה מנסה לאשר ומקבל 403; אין שינוי ב-Meta.
4. הודעת WhatsApp משויכת לשיחה קיימת רק לאחר אימות זהות.
5. יצירת ליד > שינוי סטטוס > משימה > audit.
6. refresh באמצע שיחה משמר הקשר.
7. webhook כפול לא יוצר הודעה/ליד כפול.
8. token expired מציג reconnect.
9. משתמש בעסק A לא קורא/עורך נתוני B.
10. rollback של migration בסביבת בדיקה ושחזור גיבוי מבודד.
## Definition of Done לכל מודול
כל מסך כולל empty/loading/error; APIs מאומתים; לוגים נקיים מסודות; בדיקות אוטומטיות; E2E בסיסי; מסמכי שימוש; no regressions; screenshots desktop/mobile; reviewer approval.
## שער פריסה
Backup verified + restore tested, migrations reviewed, env validated, secrets present, Meta permissions validated, observability, rollout/rollback plan, אישור מפורש של בעל המערכת. אין להניח שהמערכת מוכנה לייצור בגלל CI ירוק.
## דווח ביצוע
לכל שלב: קבצים ששונו, tests run/results, known issues, manual steps, risks, PR link, האם נפרס (ברירת מחדל: לא).

## עקרונות מחייבים
- המוצר הוא הרחבה של Campaign Bachat הקיים, לא מערכת חלופית.
- יש לבצע תחילה inventory לקוד, סכמת הנתונים, הנתיבים, הבדיקות והאינטגרציות הקיימים. אין להניח שמרכיב מסוים כבר עובד ללא בדיקה.
- ממשק עברי מלא RTL; תמיכה עתידית ב-i18n, נגישות WCAG 2.2 AA ככל הניתן.
- כל נתון עסקי מבודד לפי tenant/business; אימות ואישור בצד שרת, לא רק בממשק.
- שום פרסום, שינוי תקציב, הפעלת קמפיין, שליחת הודעה חיצונית או פריסה לייצור ללא אישור מפורש ותקף.
- כל פעולת שינוי חיצונית דורשת idempotency key, audit log, ניהול retries ומצב ברור למשתמש.
- אין להשתמש בנתוני דמה כאילו הם נתונים אמיתיים. נתונים לדוגמה רק במצב demo מסומן.
- כל מסך כולל loading, empty, error, success, permission-denied ו-mobile states.
