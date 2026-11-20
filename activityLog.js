'use strict';
// "What did you do and why": a plain Hebrew log of everything SCORPIO did or
// prepared in the ad account and in content, so the owner never wonders.
const db = require('./db');

const STATUS = { VERIFIED: 'בוצע ✅', APPROVED: 'אושר, בביצוע', PROPOSED: 'מחכה לאישור שלך', CANCELLED: 'בוטל', BLOCKED: 'לא בוצע (חסרה הרשאה)', MANUAL_REVIEW: 'בבדיקה' };
const REQUEST = /^(?:מה עשית(?: השבוע| לאחרונה| בחשבון| בחשבון שלי)?|יומן פעולות|מה עשית בשבילי)[?？]?$/;

async function list(clientId, { days = 7 } = {}) {
  const intents = require('./actionPlan').INTENT_HE;
  const plans = (await db.query(`SELECT p.id,p.intent,p.payload,p.status,p.updated_at,u.reason AS auto_reason,(u.action_id IS NOT NULL) AS autonomous FROM action_plans p
    LEFT JOIN authority_uses u ON u.action_id=p.id AND u.client_id=p.client_id
    WHERE p.client_id=$1 AND p.updated_at>NOW()-($2::int*INTERVAL '1 day') ORDER BY p.updated_at DESC LIMIT 30`, [clientId, days])).rows;
  // "החזר למצב הקודם": budget changes, pauses and activations of the last 24 hours.
  const undoable = await require('./undoActions').undoableIds(clientId);
  const items = plans.map((p) => {
    const t = p.payload?.target || {}, name = t.campaignName || p.payload?.parameters?.name || '';
    return {
      at: p.updated_at,
      what: (intents[p.intent] || 'פעולה בחשבון הפרסום') + (name ? `: ${name}` : ''),
      why: String(p.auto_reason || p.payload?.summary || p.payload?.reason || '').slice(0, 300),
      status: (STATUS[p.status] || 'בטיפול') + (p.autonomous ? ' · לבד, לפי הסכם העבודה' : ''),
      autonomous: !!p.autonomous,
      kind: 'ad',
      actionId: p.id,
      undo: undoable.has(p.id) ? { label: require('./onboardingCopy').undoButton } : null
    };
  });
  let posts = [];
  try {
    posts = (await db.query(`SELECT topic,sent_at FROM organic_posts WHERE client_id=$1 AND status='SENT' AND sent_at>NOW()-($2::int*INTERVAL '1 day') ORDER BY sent_at DESC LIMIT 10`, [clientId, days])).rows;
  } catch { posts = []; }
  for (const p of posts) items.push({ at: p.sent_at, what: `שלחתי לך פוסט מוכן: "${p.topic}"`, why: 'לפי לוח התוכן שאישרת', status: 'נשלח ✅', kind: 'content' });
  return items.sort((a, b) => new Date(b.at) - new Date(a.at));
}

const day = (d) => new Date(d).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'short', day: 'numeric', month: 'numeric' });

async function handle(clientId, text) {
  if (!REQUEST.test(String(text || '').trim())) return null;
  const items = await list(clientId);
  if (!items.length) return { handled: true, reply: 'השבוע לא עשיתי שום פעולה בחשבון הפרסום שלך. כל פעולה שאני מכין מחכה קודם לאישור שלך ✋' };
  const lines = items.slice(0, 8).map((x) => `• ${day(x.at)} · ${x.what} · ${x.status}` + (x.why ? `\n  למה: ${x.why.slice(0, 140)}` : ''));
  const auto = items.some((x) => x.autonomous), canUndo = items.some((x) => x.undo);
  return { handled: true, reply: `📋 מה עשיתי ב־7 הימים האחרונים:\n\n${lines.join('\n')}\n\n${auto ? 'מה שסומן "לבד" נעשה בתוך הסכם העבודה שלך. שום דבר לא עבר את התקרה שקבעת.' : 'שום דבר שעולה כסף לא בוצע בלי האישור שלך.'}${canUndo ? '\n' + require('./onboardingCopy').undoWhatsAppLine : ''}\n${require('./dashboardLink').hint('approvals')}` };
}

// The five things the owner must always see: done, running now, waiting for approval, failed, actual spend.
async function status(clientId, { spendLoader = loadSpend } = {}) {
  const intents = require('./actionPlan').INTENT_HE;
  const label = (r) => (intents[r.intent] || 'פעולה') + (r.payload?.target?.campaignName ? `: ${r.payload.target.campaignName}` : '');
  const rows = (await db.query(`SELECT p.id,p.intent,p.payload,p.status,p.updated_at,(u.action_id IS NOT NULL) AS autonomous FROM action_plans p
    LEFT JOIN authority_uses u ON u.action_id=p.id AND u.client_id=p.client_id
    WHERE p.client_id=$1 AND p.status IN ('VERIFIED','APPROVED','MANUAL_REVIEW','BLOCKED') AND p.updated_at>NOW()-INTERVAL '7 days' ORDER BY p.updated_at DESC LIMIT 60`, [clientId])).rows;
  const waiting = (await db.query(`SELECT a.action_id,a.expires_at,p.intent,p.payload FROM approvals a JOIN action_plans p ON p.id=a.action_id AND p.client_id=a.client_id
    WHERE a.client_id=$1 AND a.status='PENDING' AND a.expires_at>NOW() AND p.status='PROPOSED' ORDER BY a.created_at DESC LIMIT 10`, [clientId])).rows;
  const task = await require('./taskAgent').active(clientId).catch(() => null);
  const agreement = await require('./scopedAuthority').getAgreement(clientId).catch(() => null);
  const pick = (st) => rows.filter((r) => st.includes(r.status)).map((r) => ({ actionId: r.id, what: label(r), at: r.updated_at, autonomous: !!r.autonomous }));
  const spend = await spendLoader(clientId).catch(() => null);
  const running = pick(['APPROVED']).map((x) => ({ ...x, what: x.what + ' (בביצוע)' }));
  if (task && !['COMPLETE', 'CANCELLED'].includes(task.status)) running.push({ what: 'משימה: ' + String(task.request || task.state?.request || 'משימה פתוחה').slice(0, 80), at: task.updated_at || null });
  if (spend?.activeCampaigns !== undefined) running.unshift({ what: spend.activeCampaigns === 1 ? 'קמפיין אחד פעיל עכשיו' : `${spend.activeCampaigns} קמפיינים פעילים עכשיו`, at: null });
  return {
    done: pick(['VERIFIED']), running, failed: pick(['MANUAL_REVIEW', 'BLOCKED']),
    waiting: waiting.map((w) => ({ actionId: w.action_id, what: label(w), expiresAt: w.expires_at })),
    spend: spend ? { today: spend.today, month: spend.month, currency: spend.currency, monthlyCeiling: agreement?.monthlyCeiling ?? null } : null,
    agreement: agreement ? { paused: agreement.paused, monthlyCeiling: agreement.monthlyCeiling } : null
  };
}
async function loadSpend(clientId) {
  const meta = require('./metaConnection');
  return meta.context.run(String(clientId), async () => {
    const c = await meta.credentials(clientId);
    if (!c.meta_ad_account_id) return null;
    const acc = c.meta_ad_account_id, read = (p, q) => meta.tenantRead(p, q), sum = (r) => (r.data || []).reduce((t, x) => t + (Number(x.spend) || 0), 0);
    const [today, month, account, active] = await Promise.all([read('/' + acc + '/insights', { fields: 'spend', date_preset: 'today' }), read('/' + acc + '/insights', { fields: 'spend', date_preset: 'this_month' }),
      read('/' + acc, { fields: 'currency' }), read('/' + acc + '/campaigns', { fields: 'id', effective_status: JSON.stringify(['ACTIVE']), limit: 100 })]);
    return { today: sum(today), month: sum(month), currency: account.currency || 'ILS', activeCampaigns: (active.data || []).length };
  });
}
const STATUS_REQUEST = /^(?:תמונת מצב|סטטוס|מה המצב בחשבון|מה קורה בחשבון|מה המצב עם הפרסום)[?？]?$/;
function formatStatus(s) {
  const cur = { ILS: '₪', USD: '$', EUR: '€' }[s.spend?.currency] || '₪', m = (v) => Math.round(v).toLocaleString('en-US') + ' ' + cur;
  const list = (items, empty) => (items.length ? items.slice(0, 3).map((x) => '  • ' + x.what + (x.autonomous ? ' (לבד, לפי ההסכם)' : '')).join('\n') + (items.length > 3 ? `\n  ועוד ${items.length - 3}` : '') : '  ' + empty);
  return ['📊 *תמונת מצב*', '',
    '✅ מה עשיתי (7 ימים):', list(s.done, 'עוד לא בוצעו פעולות.'),
    '⏳ מה רץ עכשיו:', list(s.running, 'אין כרגע שום דבר בביצוע.'),
    '✋ מחכה לאישור שלך:', list(s.waiting, 'שום דבר.'),
    '⚠️ מה נכשל או נעצר:', list(s.failed, 'כלום, הכול עבר תקין.'),
    '💸 הוצאה בפועל:', s.spend ? `  היום ${m(s.spend.today)} · החודש ${m(s.spend.month)}` + (s.spend.monthlyCeiling ? ` מתוך תקרה של ${m(s.spend.monthlyCeiling)}` : '') : '  לא זמין כרגע (חשבון Meta לא מחובר או לא ענה).',
    ...(s.agreement?.paused ? ['', '⏸ הפעולות האוטומטיות עצורות. להחזרה כתוב: חדש את הפעולות האוטומטיות'] : [])].join('\n');
}
async function handleStatus(clientId, text) {
  if (!STATUS_REQUEST.test(String(text || '').trim())) return null;
  return { handled: true, reply: formatStatus(await status(clientId)) + '\n' + require('./dashboardLink').hint('home') };
}

module.exports = { list, handle, REQUEST, status, formatStatus, handleStatus, STATUS_REQUEST };
