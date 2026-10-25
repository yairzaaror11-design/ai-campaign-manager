'use strict';
const router=require('express').Router();
const db=require('./db');
router.use((req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'});next();});
router.get('/privacy',(req,res)=>{
 if(!process.env.PRIVACY_OPERATOR_NAME || !process.env.PRIVACY_CONTACT_EMAIL || !process.env.PRIVACY_HOSTING_PROVIDER || !process.env.PRIVACY_BACKUP_RETENTION) return res.status(503).type('text').send('Privacy policy configuration is incomplete. Customer onboarding must remain closed.');
 res.type('text').send(`מדיניות פרטיות — קמפיין בצ׳ט\nמפעיל: ${process.env.PRIVACY_OPERATOR_NAME}\nיצירת קשר: ${process.env.PRIVACY_CONTACT_EMAIL}\n\nהמערכת שומרת מספר טלפון, שם תצוגה, שיחות, בריפים, טיוטות, אישורים ואירועי מערכת לצורך ניהול הפרסום. חיבור Meta שומר מזהה משתמש, טוקן מוצפן, מועד תפוגה וחשבון מודעות שנבחר. נתוני פרסום נקראים לפי הרשאות המשתמש. פעולות כתיבה דורשות תוכנית מאושרת והפעלה נפרדת של יכולת הכתיבה בידי המפעיל.\n\nספקי שירות: Meta ו־WhatsApp להעברת הודעות ונתוני פרסום; ספק AI מוגדר (${process.env.AI_PROVIDER || 'gemini'}) לעיבוד תוכן השיחות והקול וליצירת גרפיקה לפי בקשה; ${process.env.PRIVACY_HOSTING_PROVIDER} לאחסון היישום והמסד. אין לשלוח בשיחה סודות או מידע אישי שאינו דרוש לבקשה. טוקני Meta אינם נמסרים למודל AI.\n\nטוקני Meta מוצפנים במסד. המערכת בודקת שיוך חשבון והרשאות ומשתמשת בחיבור HTTPS לספקים. אין הבטחה להגנה מוחלטת. שיחות, אישורי מסירה ורישומי ביקורת נשמרים עד ${require('./maintenance').retentionDays()} ימים. תוכן תורי הודעות מושחר לאחר עיבוד או בתום תקופת השמירה; מזהי אירועים נשמרים למניעת כפילויות. בריפים, טיוטות, פעולות, רשומות לקוח וחיבורי Meta נשמרים עד לבקשת מחיקה. גיבויים: ${process.env.PRIVACY_BACKUP_RETENTION}. קבצי מדיה שנוצרו או הועלו מקושרים ללקוח ליום אחד ומועברים לספק AI או ל־WhatsApp לפי הצורך בבקשה. נתוני ספקים חיצוניים כפופים לתנאיהם ולמדיניותם.\n\nלניתוק: /meta-disconnect בצ׳אט המורשה. להסרת ההרשאה ב־Meta יש להסיר גם את האפליקציה בהגדרות Meta. למחיקת הנתונים במסד הפעיל: /meta-delete-data-confirm. המחיקה כוללת שיחות, טיוטות, אישורים, חיבורי Meta ותוכן אירועים ממתינים המשויך למספר. קמפיינים ב־Meta אינם נמחקים. נשמר סימון מגובב חד־כיווני של המספר למניעת יצירה מחדש בשוגג, ומזהי אירועים ללא תוכנם למניעת עיבוד כפול. רישומי מחיקה נטולי פרטי לקוח נמחקים בתוך תקופת השמירה.\n\nלעיון, תיקון, ייצוא ובירור מחיקה אצל ספקים ובגיבויים, יש לפנות לכתובת הקשר. בקשות מעבר למחיקה העצמית מטופלות בידי המפעיל.`);
});
router.get('/data-deletion',(req,res)=>res.type('text').send('למחיקת חשבון Campaign Bachat, שלח /meta-delete-data-confirm מהצ׳אט המורשה. המחיקה מסירה נתונים משויכים מהמסד הפעיל, משחירה תוכן אירועי WhatsApp ממתינים ומבטלת הודעות יוצאות. היא אינה מוחקת קמפיינים ב־Meta או עותקים אצל ספקים ובגיבויים. נשמרים מזהי אירועים ללא תוכן וסימון חד־כיווני למניעת יצירה מחדש בשוגג. לבירור נוסף פנה למפעיל. אפשר גם לבקש מחיקה דרך הגדרות האפליקציות ב־Meta.'));
router.get('/data-deletion/status',async(req,res)=>{
 try {
  if(!/^[a-f0-9]{48}$/.test(String(req.query.code))) return res.sendStatus(404);
  const hash=require('crypto').createHash('sha256').update(req.query.code).digest('hex');
  const result=await db.query('SELECT status FROM deletion_receipts WHERE code_hash=$1',[hash]);
  if(!result.rows.length) return res.sendStatus(404);
  res.type('text').send('Active application database deletion: '+result.rows[0].status+'. Backups and provider copies are handled separately by the operator.');
 } catch {res.sendStatus(503);}
});
module.exports=router;
