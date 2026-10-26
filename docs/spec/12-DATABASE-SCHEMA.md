# סכמת נתונים לוגית

גרסה: 1.0 | 26.10.2026 | סטטוס: אפיון יעד לאישור ומימוש מדורג

## חובה לפני migrations
להשוות לסכמה הקיימת ולבצע additive migrations בלבד. אין למחוק/לשנות טבלאות קיימות ללא תוכנית התאמה ו-backfill. PostgreSQL הוא מקור האמת.
## ישויות ושדות מינימום
businesses(id, name, industry, timezone, currency, created_at, updated_at)
users(id, identity_provider_id, display_name, created_at)
business_memberships(id, business_id, user_id, role, status, created_at)
ad_accounts(id, business_id, provider, external_id, connection_status, last_sync_at)
campaign_drafts(id, business_id, author_id, payload_json, version, state, created_at)
campaigns(id, business_id, ad_account_id, external_id, status, last_sync_at)
contacts(id, business_id, name, phone_e164, email, created_at)
leads(id, business_id, contact_id, campaign_id, source, status, assigned_user_id, created_at, updated_at)
lead_activities(id, business_id, lead_id, type, body, actor_id, created_at)
tasks(id, business_id, lead_id, title, due_at, status, assigned_user_id)
conversations(id, business_id, owner_user_id, channel, state, created_at)
messages(id, business_id, conversation_id, direction, role, body, external_message_id, created_at)
business_facts(id, business_id, key, value_json, source, verified_at, expires_at)
assets(id, business_id, storage_key, media_type, created_at)
approvals(id, business_id, actor_id, action_type, resource_id, payload_hash, version, expires_at, state)
execution_jobs(id, business_id, approval_id, idempotency_key, state, provider_receipt, created_at)
audit_events(id, business_id, actor_id, action, target_type, target_id, metadata_redacted, created_at)
## אינדקסים ואילוצים
FK בכל קשר; index על (business_id, created_at), (business_id,status), unique(provider, external_id) לפי הצורך, unique(idempotency_key, business_id); partial unique ל-external_message_id; NOT NULL לשדות מפתח; migration tests.
## אבטחה
tenant-scoped queries חובה; אם משתמשים ב-RLS, להגדיר מדיניות ולבדוק אותה; credentials בהצפנה במנגנון secrets קיים ולא בטבלאות גלויות; PII מוצפן לפי הצורך; audit לא כולל תוכן הודעות רגיש.
## retention
להגדיר עם בעל המוצר תקופות שמירה/מחיקה לפי סוג נתון, בקשות מחיקה, גיבויים וחריגים משפטיים לפני השקה.

## עקרונות מחייבים
- המוצר הוא הרחבה של Campaign Bachat הקיים, לא מערכת חלופית.
- יש לבצע תחילה inventory לקוד, סכמת הנתונים, הנתיבים, הבדיקות והאינטגרציות הקיימים. אין להניח שמרכיב מסוים כבר עובד ללא בדיקה.
- ממשק עברי מלא RTL; תמיכה עתידית ב-i18n, נגישות WCAG 2.2 AA ככל הניתן.
- כל נתון עסקי מבודד לפי tenant/business; אימות ואישור בצד שרת, לא רק בממשק.
- שום פרסום, שינוי תקציב, הפעלת קמפיין, שליחת הודעה חיצונית או פריסה לייצור ללא אישור מפורש ותקף.
- כל פעולת שינוי חיצונית דורשת idempotency key, audit log, ניהול retries ומצב ברור למשתמש.
- אין להשתמש בנתוני דמה כאילו הם נתונים אמיתיים. נתונים לדוגמה רק במצב demo מסומן.
- כל מסך כולל loading, empty, error, success, permission-denied ו-mobile states.
