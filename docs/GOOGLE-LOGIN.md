# כניסה לדשבורד עם Google

## מה זה עושה
- כפתור "כניסה עם Google" במסך הכניסה, ו"חיבור חשבון Google" בהגדרות → חשבון.
- מבקשים מ־Google רק `openid email` (זהות ומייל). אין גישה ל־Gmail, Drive או אנשי קשר. אין עלות.
- חשבון Google נכנס רק לעסק שהוא חובר אליו. חיבור קורה באחת משתי דרכים:
  1. בעל העסק מחובר → הגדרות → חשבון → "חיבור חשבון Google".
  2. נכנסים עם Google בפעם הראשונה → המערכת מבקשת להיכנס פעם אחת עם הטלפון והקוד (או הקישור מוואטסאפ) → החשבון מתחבר אוטומטית.
- חשבון Google אחד לא יכול להיות מחובר לשני עסקים. ניתוק בהגדרות.
- כל עוד לא הוגדרו מפתחות — הכפתור לא מופיע (אין כפתור שלא עובד).

## הגדרה (פעם אחת, ~10 דקות, בעל החשבון)
1. https://console.cloud.google.com → פרויקט חדש "SCORPIO AI".
2. APIs & Services → OAuth consent screen: External; שם האפליקציה SCORPIO AI; מייל תמיכה; דומיין האפליקציה; קישור למדיניות פרטיות `https://<הדומיין>/privacy`. Scopes: `openid`, `email` בלבד (לא דורש אימות של Google). Publish app.
3. Credentials → Create credentials → OAuth client ID → Web application.
   - Authorized redirect URI: `https://<הדומיין>/app/auth/google/callback` (בדיוק כמו `APP_PUBLIC_URL`).
4. ב־Render → Environment: `GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET`. Deploy.

## אבטחה
Authorization code + PKCE (S256), state חד־פעמי ל־10 דקות שקשור לדפדפן בעוגייה HttpOnly, בדיקת issuer/audience/תוקף/מייל מאומת, רק hash של טוקנים נשמר, קישור ממתין תקף 15 דקות ובאותו דפדפן בלבד, עוגיות הסשן נשארות SameSite=Strict. טבלאות: `google_login_identities`, `google_login_flows` (מיגרציה 051), נמחקות יחד עם העסק.
קוד: `googleLogin.js`, נתיבים ב־`portalRoutes.js`, בדיקות `tests/googleLogin.test.js`.
