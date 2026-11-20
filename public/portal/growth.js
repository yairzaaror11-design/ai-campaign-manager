'use strict';
// Growth screens: "צמיחה" (funnels, deal value defaults, after-sale loop) and "צוות" (team routing and
// per-member mini report), plus the deal dialog and team/consent tools on each lead card.
// Uses the portal globals api() and tell() and window.ScorpioUI. Mobile first: cards, no tables.
window.ScorpioGrowth = (() => {
  const UI = window.ScorpioUI, { el, button, card, badge, field, dialog } = UI;
  const tall = (n) => { n.style.minHeight = '44px'; return n; };
  const btn = (label, action, cls = 'secondary') => tall(button(label, action, cls));
  const ils = (v) => '₪' + Math.round(Number(v) || 0).toLocaleString('he-IL');
  const say = (text, error = false) => { if (typeof tell === 'function') tell(text, error); };
  let cache = null;
  async function data(force = false) { if (!cache || force) cache = api('growth').catch(() => null); return cache; }
  function heading(title, subtitle) {
    const h = el('div', '', 'page-heading'), copy = el('div');
    copy.append(el('p', 'לקוחות', 'eyebrow'), el('h1', title), el('p', subtitle));
    h.append(copy); return h;
  }
  async function run(b, work) { if (b.disabled) return; b.disabled = true; try { await work(); } catch (e) { say(e.message, true); } finally { b.disabled = false; } }
  function link(href, label, cls = 'secondary') { const a = el('a', label, 'button ' + cls); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return tall(a); }
  function pre(text) { const p = el('p', text, 'muted'); p.style.whiteSpace = 'pre-line'; return p; }

  // ---------- צמיחה ----------
  async function growthScreen() {
    const d = await data(true);
    if (!d) return [heading('צמיחה', 'משפכים, ביקורות והמלצות'), el('p', 'לא הצלחתי לטעון את הנתונים. נסה לרענן.', 'notice')];
    return [heading('צמיחה', 'מכל עסקה עוד לקוחות: סוגי קמפיינים, שווי עסקה, ביקורות והמלצות'), funnelsCard(d), dealCard(d), loopCard(d), outreachCard(d)];
  }
  function funnelsCard(d) {
    const c = card('סוגי קמפיינים', 'לכל סוג: למי הקמפיין פונה ומה הטופס שואל. כל ליד מסומן לפי הסוג שלו.');
    for (const f of d.funnels.funnels) {
      const box = el('div', '', 'card'); box.style.margin = '8px 0';
      box.append(el('h3', f.label));
      if (f.key === d.funnels.recommended) box.append(badge('מומלץ עכשיו'));
      box.append(el('p', '״' + f.hook + '״'), el('p', 'הטופס שואל: ' + f.questions.join(' · '), 'muted'));
      const out = el('p', '', 'muted'); out.style.whiteSpace = 'pre-line';
      const go = btn('הכנת טיוטת קמפיין', () => run(go, async () => {
        const r = await api('growth/funnels/' + f.key + '/prepare', {});
        out.textContent = r.reply || ''; say(r.ok ? 'הסוכן מכין טיוטה. שום דבר לא עולה לאוויר בלי אישור שלך.' : (r.reply || 'לא הוכן'), !r.ok);
      }), 'primary');
      box.append(go, out); c.append(box);
    }
    c.append(el('p', 'הטיוטה עוברת את אותו תהליך אישור כמו כל קמפיין: יצירה במצב מושהה, והפעלה רק באישור שלך או לפי הסכם העבודה.', 'muted'));
    return c;
  }
  function dealCard(d) {
    const c = card('שווי עסקה', d.commission ? 'כשליד נסגר, נשאל מחיר עסקה ואחוז עמלה. העמלה היא ההכנסה שלך, ככה "נשאר לך אחרי הפרסום" מדויק.' : 'כשליד נסגר, נשאל כמה הלקוח שילם. זה נכנס להכנסות בדוח.');
    if (!d.commission) return c;
    const form = el('form');
    const sale = field(form, 'עמלה במכירה (%)', 'commissionPct', { type: 'number', value: d.settings.commissionPct });
    const rent = field(form, 'עמלה בשכירות (% משכר דירה חודשי)', 'rentCommissionPct', { type: 'number', value: d.settings.rentCommissionPct, help: '100% = חודש שכירות אחד' });
    sale.max = '100'; rent.max = '300';
    const save = btn('שמירת ברירות המחדל', null, 'primary'); save.type = 'submit'; form.append(save);
    form.addEventListener('submit', (e) => { e.preventDefault(); run(save, async () => { await api('growth/settings', { commissionPct: Number(sale.value), rentCommissionPct: Number(rent.value) }); say('נשמר. אפשר לשנות את האחוז בכל עסקה.'); }); });
    c.append(form); return c;
  }
  function loopCard(d) {
    const c = card('אחרי עסקה: תודה, ביקורת והמלצה', 'מאשרים פעם אחת את הקצב, והסוכן מטפל בכל לקוח שנסגר');
    c.append(pre(d.cadence));
    const form = el('form');
    const url = field(form, 'הקישור לביקורות שלך בגוגל', 'reviewUrl', { type: 'url', value: d.settings.reviewUrl || '', maxLength: 500, help: 'בפרופיל העסק בגוגל: "בקשת ביקורות" > העתקת קישור. מגדירים פעם אחת.' });
    const save = btn('שמירת הקישור', null, 'secondary'); save.type = 'submit'; form.append(save);
    form.addEventListener('submit', (e) => { e.preventDefault(); run(save, async () => { await api('growth/settings', { reviewUrl: url.value.trim() }); say('הקישור נשמר.'); }); });
    c.append(form);
    c.append(el('p', d.autoSend.template && d.autoSend.sending
      ? 'הסוכן שולח בעצמו רק ללקוח שסימנת שהסכים לקבל הודעות. לשאר תקבל הודעה מוכנה לשליחה מהוואטסאפ שלך.'
      : 'כרגע ההודעות ללקוחות נשלחות ממך: תקבל הודעה מוכנה ותשלח אותה מהוואטסאפ שלך בלחיצה. שליחה ישירה מהסוכן תופעל רק אחרי שתבנית הודעה תאושר ב־WhatsApp.', 'notice'));
    const approved = d.settings.cadenceApproved;
    c.append(approved ? badge('✅ אישרת את הקצב') : badge('עוד לא אושר', 'warning'));
    const toggle = btn(approved ? 'ביטול האישור' : 'מאשר את הקצב', () => run(toggle, async () => {
      if (!approved && !await UI.confirm('אישור הקצב', 'אחרי כל עסקה: תודה + ביקורת, בקשת המלצה ותזכורת ללקוח, כמו שמתואר כאן. בכל הודעה יש אפשרות "הסר". אפשר לבטל בכל רגע.', 'מאשר')) return;
      await api('growth/cadence', { approve: !approved }); say(approved ? 'האישור בוטל.' : 'אושר. הסוכן יפעל לפי הקצב הזה.');
      window.ScorpioDashboard?.navigate('growth');
    }), approved ? 'secondary' : 'primary');
    c.append(toggle); return c;
  }
  const OUT_STATUS = { PLANNED: 'מתוכנן', OFFERED: 'מחכה לך', SENT: 'נשלח ע״י הסוכן', LINK_GIVEN: 'נשלח ממך', SKIPPED: 'דילגת', OPTED_OUT: 'הלקוח הסיר את עצמו' };
  function outreachCard(d) {
    const c = card('הודעות ללקוחות', 'מה מתוכנן ומה כבר נשלח');
    if (!d.outreach.length) { c.append(el('p', 'עוד אין. כשליד יסומן "נסגר ✅", יופיעו כאן ההודעות שלו.', 'muted')); return c; }
    for (const o of d.outreach) {
      const row = el('div', '', 'card'); row.style.margin = '8px 0';
      row.append(el('h3', (o.name || 'לקוח') + ' · ' + o.kindLabel), el('p', OUT_STATUS[o.status] + (['PLANNED'].includes(o.status) ? ' · ' + new Date(o.dueAt).toLocaleDateString('he-IL') : ''), 'muted'));
      if (o.status === 'OFFERED' || o.status === 'PLANNED') {
        const a = el('div', '', 'actions');
        if (o.link) a.append(link(o.link, '💬 שליחה מהוואטסאפ שלי', 'primary'));
        const done = btn('✅ שלחתי', () => run(done, async () => { await api('growth/outreach/' + o.id, { action: 'done' }); window.ScorpioDashboard?.navigate('growth'); }));
        const skip = btn('דלג', () => run(skip, async () => { await api('growth/outreach/' + o.id, { action: 'skip' }); window.ScorpioDashboard?.navigate('growth'); }));
        if (o.status === 'OFFERED') a.append(done); a.append(skip); row.append(a);
      }
      c.append(row);
    }
    return c;
  }

  // ---------- צוות ----------
  const NOTIFY = { ON: '✅ מקבל לידים בוואטסאפ', WAITING: '⏳ עוד לא הצטרף בוואטסאפ', STOPPED: '⏸ ביקש להפסיק הודעות' };
  async function teamScreen() {
    const d = await data(true);
    if (!d) return [heading('צוות', 'מי מטפל בלידים'), el('p', 'לא הצלחתי לטעון את הנתונים. נסה לרענן.', 'notice')];
    const out = [heading('צוות', 'לידים חדשים עוברים לאנשי הצוות, ואתה רואה הכול')];
    const routing = card('איך מחלקים לידים חדשים');
    const form = el('form');
    const sel = field(form, 'חלוקה', 'routing', { value: d.settings.routing, options: [['OWNER', 'הכול נשאר אצלי'], ['ROUND_ROBIN', 'לפי התור, אחד אחרי השני'], ['AREA', 'לפי אזור או נכס (ואם אין התאמה, לפי התור)']] });
    const save = btn('שמירה', null, 'primary'); save.type = 'submit'; form.append(save);
    form.addEventListener('submit', (e) => { e.preventDefault(); run(save, async () => { await api('growth/settings', { routing: sel.value }); say('נשמר. מהליד הבא החלוקה תעבוד כך.'); }); });
    routing.append(form);
    if (d.settings.routing !== 'OWNER' && !d.team.members.some((m) => m.active)) routing.append(el('p', 'אין עדיין אנשי צוות פעילים, אז כל הלידים נשארים אצלך.', 'notice'));
    out.push(routing, addCard());
    for (const m of d.team.members) out.push(memberCard(m, d.team.report.members.find((r) => r.id === m.id)));
    out.push(el('p', `לידים שנשארו אצלך ב־30 הימים האחרונים: ${d.team.report.unassigned}`, 'muted'));
    return out;
  }
  function addCard() {
    const c = card('הוספת איש צוות'), form = el('form');
    const name = field(form, 'שם', 'name', { required: true, maxLength: 80 });
    const phone = field(form, 'טלפון (לוואטסאפ)', 'phone', { type: 'tel', maxLength: 20 });
    const areas = field(form, 'אזורים (מופרדים בפסיקים)', 'areas', { maxLength: 400, help: 'למשל: גבעתיים, רמת גן. משמש לחלוקה לפי אזור.' });
    const save = btn('הוספה', null, 'primary'); save.type = 'submit'; form.append(save);
    form.addEventListener('submit', (e) => { e.preventDefault(); run(save, async () => {
      await api('growth/team', { name: name.value, ...(phone.value.trim() ? { phone: phone.value.trim() } : {}), areas: areas.value });
      say('נוסף. כדי שיקבל לידים בוואטסאפ, שלח לו את הודעת ההצטרפות שבכרטיס שלו.'); window.ScorpioDashboard?.navigate('team');
    }); });
    c.append(form); return c;
  }
  function memberCard(m, r) {
    const c = card(m.name, [m.phone, m.areas.join(', ')].filter(Boolean).join(' · '));
    c.append(badge(m.active ? NOTIFY[m.notifications] : 'לא פעיל', m.active && m.notifications === 'ON' ? '' : 'warning'));
    if (r) c.append(el('p', `30 ימים: ${r.leads} לידים · ${r.handled} טופלו · ${r.waiting} מחכים · ${r.won} עסקאות${r.revenue ? ' · ' + ils(r.revenue) : ''}`));
    const a = el('div', '', 'actions');
    if (m.active && m.notifications !== 'ON' && m.phone) {
      const invite = 'כדי לקבל ממני לידים בוואטסאפ, שלח את ההודעה: הצטרפות ' + m.joinCode + (m.joinLink ? '\n' + m.joinLink : '');
      c.append(el('p', 'קוד הצטרפות: ' + m.joinCode + '. הוא שולח "הצטרפות ' + m.joinCode + '" למספר של הסוכן, ורק אז מתחיל לקבל לידים.', 'muted'));
      a.append(link('https://wa.me/' + m.phone + '?text=' + encodeURIComponent(invite), '📨 שליחת הזמנה אליו'));
    }
    const areasBtn = btn('עריכת אזורים', () => {
      const dd = dialog('אזורים — ' + m.name), form = el('form');
      const input = field(form, 'אזורים (מופרדים בפסיקים)', 'areas', { value: m.areas.join(', '), maxLength: 400 });
      const save = btn('שמירה', null, 'primary'); save.type = 'submit'; form.append(save); dd.append(form); dd.showModal();
      form.addEventListener('submit', (e) => { e.preventDefault(); run(save, async () => { await api('growth/team/' + m.id, { areas: input.value }, 'PATCH'); dd.close(); window.ScorpioDashboard?.navigate('team'); }); });
    });
    const toggle = btn(m.active ? 'השבתה' : 'החזרה לצוות', () => run(toggle, async () => { await api('growth/team/' + m.id, { active: !m.active }, 'PATCH'); window.ScorpioDashboard?.navigate('team'); }));
    a.append(areasBtn, toggle); c.append(a); return c;
  }

  // ---------- lead card tools ----------
  async function dealDialog(lead) {
    const terms = await api('growth/leads/' + lead.id + '/deal');
    const dd = dialog('שווי העסקה — ' + lead.name), form = el('form'), error = el('p', '', 'form-error'); error.setAttribute('role', 'alert');
    const price = field(form, terms.priceLabel, 'price', { type: 'number', required: true, value: lead.deal_value_minor ? Number(lead.deal_value_minor) / 100 : '' });
    const pct = terms.commission ? field(form, 'עמלה (%)', 'commissionPct', { type: 'number', value: lead.commission_pct ?? terms.defaultPct, help: terms.kind === 'RENT' ? 'אחוז משכר דירה חודשי. 100% = חודש שכירות.' : 'ברירת המחדל שלך. אפשר לשנות לעסקה הזו.' }) : null;
    const result = el('p', '', 'muted');
    const calc = () => { const p = Number(price.value) || 0, r = terms.commission ? p * (Number(pct.value) || 0) / 100 : p; result.textContent = p ? (terms.commission ? 'הכנסה לך (עמלה): ' : 'הכנסה: ') + ils(r) : ''; };
    price.addEventListener('input', calc); pct?.addEventListener('input', calc); calc();
    const save = btn('שמירת העסקה', null, 'primary'); save.type = 'submit';
    form.append(result, error, save); dd.append(form); dd.showModal();
    form.addEventListener('submit', (e) => { e.preventDefault(); run(save, async () => {
      try { const r = await api('growth/leads/' + lead.id + '/deal', { price: Number(price.value), ...(pct ? { commissionPct: Number(pct.value) } : {}) }); dd.close(); say(r.text.split('\n')[0]); if (typeof loadLeads === 'function') await loadLeads(); }
      catch (err) { error.textContent = err.message; }
    }); });
  }
  function leadTools(lead) {
    const box = el('div', '', 'actions');
    data().then((d) => {
      if (!d) return;
      const f = d.funnels.funnels.find((x) => x.key === lead.funnel);
      if (f) box.append(badge('🎯 ' + f.label.split(' — ')[0]));
      const active = d.team.members.filter((m) => m.active);
      if (active.length) {
        const s = el('select'); s.setAttribute('aria-label', 'מי מטפל ב־' + lead.name);
        for (const [v, l] of [['', 'אצלי (בעל העסק)'], ...active.map((m) => [m.id, m.name])]) { const o = el('option', l); o.value = v; o.selected = (lead.assigned_member_id || '') === v; s.append(o); }
        s.addEventListener('change', () => run(s, async () => { const r = await api('growth/leads/' + lead.id + '/assign', { memberId: s.value || null }); say(r.notified === 'QUEUED' || r.notified === 'TEMPLATE_QUEUED' ? 'הליד הועבר ונשלח אליו בוואטסאפ.' : 'הליד הועבר. איש הצוות יראה אותו כשיצטרף בוואטסאפ, או שתעדכן אותו בעצמך.'); }));
        box.append(s);
      }
      if (lead.status === 'WON') {
        box.append(btn(lead.deal_value_minor ? '💰 עסקה: ' + ils(Number(lead.deal_value_minor) / 100) : '💰 שווי העסקה', () => dealDialog(lead).catch((e) => say(e.message, true))));
        if (lead.customer_consent !== false) {
          const label = el('label', 'הלקוח הסכים לקבל ממני הודעות'), cb = document.createElement('input');
          cb.type = 'checkbox'; cb.checked = lead.customer_consent === true; label.prepend(cb); tall(label);
          cb.addEventListener('change', () => run(cb, async () => { await api('growth/leads/' + lead.id + '/consent', { consent: cb.checked }); say(cb.checked ? 'סומן. כשהשליחה הישירה פעילה, הסוכן ישלח לו לפי הקצב שאישרת.' : 'הסימון הוסר. ההודעות אליו יגיעו אליך כהודעה מוכנה לשליחה.'); }));
          box.append(label);
        } else box.append(badge('הלקוח הסיר את עצמו מהודעות', 'warning'));
      }
    });
    return box;
  }
  return { growthScreen, teamScreen, dealDialog, leadTools, refresh: () => data(true) };
})();
