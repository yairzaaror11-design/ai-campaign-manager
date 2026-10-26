# Design System

גרסה: 1.0 | 26.10.2026 | סטטוס: אפיון יעד לאישור ומימוש מדורג

## שפה חזותית
בהשראת הצילום של PowerAds AI, ללא העתקת לוגו/נכסים. SaaS מודרני, מינימליסטי, RTL. Desktop sidebar ימני כהה, תוכן בהיר וכרטיסים מעוגלים.
## Design tokens מוצעים
primary #00A878; primaryHover #008F68; sidebar #171F2B; bg #F6F8FA; surface #FFFFFF; text #17202A; muted #64748B; border #E2E8F0; danger #DC2626; warning #D97706; success #15803D.
Font: Heebo, fallback Arial/sans-serif; base 16px; headings 32/24/20; radius card 16px, button 10px; spacing scale 4/8/12/16/24/32; sidebar 260px; topbar 72px.
## רכיבים
AppShell, Sidebar, Topbar, Breadcrumbs, PageHeader, KPIcard, ChartCard, DataTable, StatusBadge, FilterBar, DateRangePicker, EmptyState, ErrorState, ConfirmDialog, ApprovalPanel, ChatComposer, MessageBubble, FormField, Toast, Drawer.
## מצבי רכיבים
Default, hover, focus-visible, active, disabled, loading, invalid; keyboard navigation, labels, contrast >=4.5:1 לטקסט רגיל כשאפשר, reduced-motion.
## רספונסיביות
>=1280 sidebar + 4 KPI columns; 768-1279 2 columns; <768 drawer + single column/2 narrow KPI, טבלאות עם overflow או card view; אין גלילה אופקית של כל הדף.
## תרשימים
מקרא, ציר תאריכים ברור, tooltip, טקסט חלופי/טבלה נגישה, הבדלה גם ללא צבע.
## מסירת עיצוב
יש לבנות Storybook או gallery של קומפוננטות, screenshot tests ברוחבים 390/768/1440 ולבצע בדיקת RTL.

## עקרונות מחייבים
- המוצר הוא הרחבה של Campaign Bachat הקיים, לא מערכת חלופית.
- יש לבצע תחילה inventory לקוד, סכמת הנתונים, הנתיבים, הבדיקות והאינטגרציות הקיימים. אין להניח שמרכיב מסוים כבר עובד ללא בדיקה.
- ממשק עברי מלא RTL; תמיכה עתידית ב-i18n, נגישות WCAG 2.2 AA ככל הניתן.
- כל נתון עסקי מבודד לפי tenant/business; אימות ואישור בצד שרת, לא רק בממשק.
- שום פרסום, שינוי תקציב, הפעלת קמפיין, שליחת הודעה חיצונית או פריסה לייצור ללא אישור מפורש ותקף.
- כל פעולת שינוי חיצונית דורשת idempotency key, audit log, ניהול retries ומצב ברור למשתמש.
- אין להשתמש בנתוני דמה כאילו הם נתונים אמיתיים. נתונים לדוגמה רק במצב demo מסומן.
- כל מסך כולל loading, empty, error, success, permission-denied ו-mobile states.
