'use strict';
// Competitor research the way media buyers do it: Meta's public Ad Library shows
// every ad currently running in Israel. SCORPIO links straight to a filtered search
// and says what to look for.
const PATTERN = /^(?:מודעות (?:של )?(?:ה)?מתחרים|מה (?:ה)?מתחרים (?:שלי )?מפרסמים\??|מתחרים)(?:\s+(.{2,40}))?$/u;
function link(query) {
  return 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=IL&search_type=keyword_unordered&q=' + encodeURIComponent(query);
}
function reply(query) {
  const q = String(query || '').trim();
  if (!q) return 'על איזה תחום לבדוק? כתוב למשל: ״מודעות מתחרים שיפוצים ברחובות״ או ״מודעות מתחרים״ ושם של מתחרה.';
  return [`🔎 כל המודעות שרצות עכשיו בישראל על "${q}":`, link(q), '', 'על מה כדאי להסתכל:',
    '• מודעות שרצות כבר הרבה זמן (תאריך התחלה ישן): כנראה עובדות ומביאות כסף',
    '• איזו הצעה הם נותנים (מחיר, מבצע, ייעוץ חינם)',
    '• איזה סגנון תמונה או סרטון חוזר אצל כמה מתחרים',
    '', 'אם תשלח לי צילום מסך של מודעה שאהבת, אכין לך גרסה משלך עם זווית שמבדלת אותך.'].join('\n');
}
module.exports = { PATTERN, reply, link };
