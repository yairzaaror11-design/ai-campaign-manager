'use strict';
// WhatsApp side of billing: "בטל מנוי" (with a confirmation button), refund
// requests and "המנוי שלי". Short, warm, and always with the dates in writing.
const subs = require('./subscriptionService'), plans = require('./billingPlans');

const CANCEL = /^(?:(?:אני\s+)?(?:רוצה|מבקש|מבקשת)\s+)?(?:בטל|לבטל|ביטול|תבטל|תבטלי)(?:\s+לי)?(?:\s+את)?\s+(?:ה)?מנוי(?:\s+שלי)?[.!\s]*$/;
// The cancel button sends the exact phrase; a typed confirmation in plain words also works (only after the prompt).
const CONFIRM = /^(?:אישור ביטול מנוי|(?:אני\s+)?מאשר(?:ת)?\s+(?:את\s+)?(?:ה)?ביטול(?:\s+(?:ה)?מנוי)?|כן,?\s+(?:לבטל|תבטל|תבטלי)\s+את\s+(?:ה)?מנוי)[.!\s]*$/;
const KEEP = /^(?:השאר|להשאיר|תשאיר)(?:\s+את)?\s+(?:ה)?מנוי[.!\s]*$/;
const REFUND = /^(?:(?:אני\s+)?(?:רוצה|מבקש|מבקשת|אפשר)\s+)?(?:לקבל\s+)?(?:(?:את\s+)?ה?החזר(?:\s+(?:כספי|כסף|ה?מלא))?|בקשת החזר|להחזיר לי את הכסף|(?:תחזיר|תחזירו|תחזירי) לי את הכסף)[.!\s]*$/;
const STATUS = /^(?:המנוי שלי|מצב המנוי|המסלול שלי|כמה עולה המנוי\??)[.!?\s]*$/;

function matches(text) { const t = String(text || '').trim(); return [CANCEL, CONFIRM, KEEP, REFUND, STATUS].some(r => r.test(t)); }

function statusReply(s) {
  const lines = [];
  if (!s.planKey) {
    lines.push('המסלולים שלנו (חודשי, מחיר קבוע):');
    for (const p of s.plans) lines.push(`• ${p.name} — ${p.priceText}`);
    lines.push(`${s.trialDays} ימי ניסיון חינם. בוחרים מסלול בדשבורד, במסך "מנוי וחיוב".`);
  } else {
    lines.push(`המסלול שלך: ${s.planName}, ${s.priceText}.`);
    if (s.cancelled) lines.push(`המנוי בוטל. הגישה נשארת עד ${s.accessEndsText}, ולא יהיה חיוב נוסף.`);
    else if (s.trialActive) lines.push(`תקופת הניסיון מסתיימת ב־${s.trialEndsText}.`);
    if (s.nextChargeText) lines.push(`החיוב הבא: ${s.nextChargeText}.`);
  }
  if (!s.paymentEnabled) lines.push(plans.NOT_ENABLED_NOTE);
  lines.push(plans.AD_BUDGET_NOTE);
  if (s.cancellable) lines.push(plans.CANCEL_HOW);
  return lines.join('\n');
}

async function handle(clientId, text) {
  const t = String(text || '').trim();
  if (STATUS.test(t)) return { handled: true, reply: statusReply(await subs.summary(clientId)) };
  if (CANCEL.test(t)) {
    const s = await subs.summary(clientId);
    if (s.cancelled) return { handled: true, reply: `המנוי כבר בוטל ✓ הגישה נשארת עד ${s.accessEndsText}, ולא יהיה חיוב נוסף.` };
    if (!s.cancellable) return { handled: true, reply: 'אין לך מנוי פעיל, אז אין מה לבטל ולא יתבצע שום חיוב 🙂' };
    await subs.promptCancel(clientId);
    const until = s.trialActive ? s.trialEndsText : s.nextChargeText;
    const body = [`לבטל את מסלול ${s.planName} (${s.priceText})?`, until ? `תמשיך ליהנות מהשירות עד ${until}, ומעבר לזה לא יהיה שום חיוב.` : 'לא יהיה שום חיוב נוסף.', 'אפשר לאשר בכפתור למטה, או פשוט לכתוב לי שאתה מאשר את הביטול.'].join('\n');
    return { handled: true, reply: body, decisionKey: 'billing_cancel' };
  }
  if (CONFIRM.test(t)) {
    const result = await subs.cancel(clientId, { channel: 'WHATSAPP', requirePrompt: true });
    const s = result.summary;
    if (result.status === 'PROMPT_REQUIRED') return { handled: true, reply: 'כדי לבטל, רק תגיד לי שאתה רוצה לבטל את המנוי ואשלח לך כפתור אישור.' };
    if (result.status === 'NOTHING_TO_CANCEL') return { handled: true, reply: 'אין לך מנוי פעיל, אז אין מה לבטל ולא יתבצע שום חיוב 🙂' };
    const lines = [`✅ המנוי בוטל. זה האישור שלך בכתב.`, `הגישה נשארת עד ${s.accessEndsText}. אחרי זה לא יהיה שום חיוב.`];
    if (result.providerStatus === 'MANUAL_REQUIRED') lines.push('הצוות שלנו יוודא את הביטול גם אצל ספק התשלום.');
    if (s.refundEligible) lines.push('אם חויבת החודש, מגיע לך החזר מלא. רק תבקש ממני ואטפל בזה.');
    lines.push('תודה שהיית איתנו. תמיד אפשר לחזור 🙏');
    return { handled: true, reply: lines.join('\n') };
  }
  if (KEEP.test(t)) return { handled: true, reply: 'מעולה, המנוי נשאר בדיוק כמו שהוא 🙂' };
  if (REFUND.test(t)) {
    const result = await subs.requestRefund(clientId, { channel: 'WHATSAPP' });
    if (result.status === 'NOT_CHARGED') return { handled: true, reply: 'עוד לא חויבת אצלנו בכלל, אז אין מה להחזיר 🙂' };
    if (result.status === 'ALREADY_REQUESTED') return { handled: true, reply: 'בקשת ההחזר שלך כבר אצלנו ✓ הצוות מטפל בה ויעדכן אותך כאן.' };
    if (result.status === 'OUTSIDE_WINDOW') return { handled: true, reply: `החזר מלא ניתן בחודש התשלום הראשון, והוא הסתיים. אם משהו בחיוב לא נראה לך תקין, תבקש לדבר עם נציג ונבדוק את זה יחד.` };
    const lines = ['✅ בקשת ההחזר נרשמה. בלי שאלות — החזר מלא.', 'הצוות שלנו יטפל בזה ויעדכן אותך כאן כשהכסף יוחזר.'];
    if (result.summary.cancellable) lines.push('אם תרצה גם לבטל את המנוי, רק תגיד לי.');
    return { handled: true, reply: lines.join('\n') };
  }
  return null;
}

module.exports = { handle, matches, statusReply, CANCEL, CONFIRM };
