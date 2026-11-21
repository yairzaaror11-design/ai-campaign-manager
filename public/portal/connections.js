'use strict';
// "חיבורים" screen (route: integrations). Live status per integration from
// GET /app/api/connections: Meta ads, Page/Instagram publishing, Pixel/CAPI, Lead Ads and
// WhatsApp — connected or not, granted vs missing permissions, token expiry, last sync,
// and the action for each. Uses the portal globals api() and tell() and window.ScorpioUI.
// Mobile first: one column of cards, 44px+ touch targets, loading / empty / error states.
window.ScorpioConnections = (() => {
  const UI = window.ScorpioUI, { el, button, card, badge } = UI;
  const say = (text, error = false) => { if (typeof tell === 'function') tell(text, error); };
  const tall = (n) => { n.style.minHeight = '44px'; return n; };
  const btn = (label, action, cls = 'secondary') => tall(button(label, action, cls));
  const date = (v) => (v ? new Date(v).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' }) : null);
  const when = (v) => (v ? new Date(v).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'עוד לא');
  // Latin handles inside Hebrew text: isolate left-to-right so "@name" keeps its order.
  const handle = (u) => '\u2066@' + (u || '') + '\u2069';
  const daysLeft = (v) => (v ? Math.ceil((new Date(v).getTime() - Date.now()) / 86400000) : null);
  async function run(b, work) {
    if (b.disabled) return;
    const label = b.textContent; b.disabled = true; b.setAttribute('aria-busy', 'true');
    try { await work(); } catch (e) { say(e.message || 'הפעולה לא הושלמה. נסה שוב.', true); }
    finally { b.disabled = false; b.removeAttribute('aria-busy'); b.textContent = label; }
  }
  function stack() { const s = el('div', '', 'connections-stack'); s.style.display = 'grid'; s.style.gap = '16px'; return s; }
  function facts(rows) {
    const list = el('dl', '', 'connection-facts'); list.style.margin = '12px 0'; list.style.display = 'grid'; list.style.gap = '6px';
    for (const [label, value] of rows) {
      if (value === undefined) continue;
      const line = el('div'); line.style.display = 'flex'; line.style.flexWrap = 'wrap'; line.style.gap = '6px';
      const dt = el('dt', label + ':'); dt.style.fontWeight = '700';
      line.append(dt, el('dd', value === null || value === '' ? 'לא נבחר' : String(value)));
      line.lastChild.style.margin = '0';
      list.append(line);
    }
    return list;
  }
  function actions(...items) { const a = el('div', '', 'actions'); a.style.display = 'flex'; a.style.flexWrap = 'wrap'; a.style.gap = '8px'; a.append(...items.filter(Boolean)); return a; }
  function heading() {
    const h = el('div', '', 'page-heading'), copy = el('div');
    copy.append(el('p', 'העסק שלי', 'eyebrow'), el('h1', 'חיבורים'), el('p', 'מה מחובר לעסק, אילו הרשאות ניתנו, ומה צריך לעשות כדי שהכול יעבוד.'));
    h.append(copy); return h;
  }
  // The invite link opens our own page, which sends the owner to Meta's official login.
  async function openMetaLogin(kind) {
    const r = await api('connections/meta/' + kind, {});
    const url = new URL(r.url, location.origin);
    if (url.origin !== location.origin) throw Error('הקישור לא תקין. נסה שוב.');
    location.assign(url.href);
  }

  const STATUS = {
    CONNECTED: ['מחובר ✓', ''], MISSING_PERMISSIONS: ['חסרות הרשאות', 'warning'], ACCOUNT_SELECTION_REQUIRED: ['צריך לבחור חשבון מודעות', 'warning'],
    NOT_CONNECTED: ['לא מחובר', 'muted'], REVOKED: ['החיבור בוטל', 'danger'], EXPIRED: ['פג תוקף', 'danger']
  };
  const REASON = {
    DEAUTHORIZED: 'הגישה של SCORPIO הוסרה מתוך פייסבוק. כל הפעולות מול Meta נעצרו.',
    APP_REMOVED: 'ההרשאה הוסרה בפייסבוק. כל הפעולות מול Meta נעצרו.',
    SESSION_INVALIDATED: 'פייסבוק ביטלה את החיבור (בדרך כלל אחרי שינוי סיסמה). כל הפעולות מול Meta נעצרו.',
    TOKEN_EXPIRED: 'פג התוקף של החיבור. כל הפעולות מול Meta נעצרו עד לחיבור מחדש.',
    TOKEN_INVALID: 'החיבור כבר לא תקף. כל הפעולות מול Meta נעצרו עד לחיבור מחדש.'
  };

  function metaCard(m, reload) {
    const [label, variant] = STATUS[m.status] || STATUS.NOT_CONNECTED;
    const c = card('פרסום ב־Meta (פייסבוק ואינסטגרם)', 'קמפיינים, דוחות ולידים דרך החשבון העסקי שלך');
    c.append(badge(label, variant));
    if (!m.configured) { c.append(el('p', 'החיבור ל־Meta עוד לא הוגדר בשרת. הצוות שלנו מטפל בזה.', 'muted')); return c; }
    if (['REVOKED', 'EXPIRED'].includes(m.status)) c.append(el('p', REASON[m.reason] || REASON.TOKEN_INVALID, 'notice'));
    if (m.status === 'NOT_CONNECTED') c.append(el('p', 'אחרי החיבור אוכל להכין קמפיינים, להביא לידים ולמדוד תוצאות. שום קמפיין לא יופעל ושום כסף לא ייצא בלי אישור שלך.', 'muted'));
    if (m.connected) {
      const left = daysLeft(m.tokenExpiresAt);
      c.append(facts([
        ['חשבון מודעות', m.assets.adAccount ? (m.assets.adAccount.name || 'חשבון שנבחר') : null],
        ['עמוד פייסבוק', m.assets.page?.name ?? null],
        ['אינסטגרם', m.assets.instagram ? handle(m.assets.instagram.username) : null],
        ['פיקסל', m.assets.pixel ? (m.assets.pixel.name || 'פיקסל שנבחר') : null],
        ['החיבור בתוקף עד', m.tokenExpiresAt ? date(m.tokenExpiresAt) + (left !== null && left <= 10 ? ` (עוד ${left} ימים)` : '') : 'ללא תאריך תפוגה'],
        ['גישה לנתונים עד', m.dataAccessExpiresAt ? date(m.dataAccessExpiresAt) : undefined],
        ['סנכרון אחרון', when(m.lastSyncAt)]
      ]));
      if (left !== null && left <= 7) c.append(el('p', 'Meta דורשת לאשר את החיבור מחדש מדי פעם. לחץ ״חבר מחדש״ כדי שהכול ימשיך לעבוד בלי הפסקה.', 'notice'));
    }
    // Permissions: granted vs missing, with "תן הרשאה" asking only for the missing ones.
    if (m.connected || m.missing.length) {
      const perms = el('ul', '', 'permission-list'); perms.style.listStyle = 'none'; perms.style.padding = '0'; perms.style.margin = '8px 0'; perms.style.display = 'grid'; perms.style.gap = '4px';
      for (const p of m.permissions) {
        if (!p.required && !p.granted) continue;
        const li = el('li', (p.granted ? '✓ ' : '✗ ') + p.label + (p.required ? '' : ' (לא חובה)'));
        if (!p.granted) li.className = 'error';
        perms.append(li);
      }
      const box = el('details'); box.open = m.missing.length > 0;
      box.append(el('summary', m.missing.length ? `חסרות ${m.missing.length} הרשאות` : 'כל ההרשאות הנדרשות ניתנו'), perms);
      c.append(box);
      if (m.missing.length) c.append(el('p', 'בלי ההרשאות המסומנות ב־✗ חלק מהדברים לא יעבדו (למשל קבלת לידים או יצירת מודעות). לחיצה על ״תן הרשאה״ תפתח את המסך של Meta ותבקש רק אותן.', 'notice'));
    }
    const picker = el('div');
    const items = [];
    if (m.missing.length) items.push(btn('תן הרשאה', function () { run(this, () => openMetaLogin('permissions')); }, 'primary'));
    if (!m.connected) items.push(btn(m.status === 'NOT_CONNECTED' ? 'חבר את Meta' : 'חבר מחדש', function () { run(this, () => openMetaLogin('connect')); }, m.missing.length ? 'secondary' : 'primary'));
    if (m.connected) {
      items.push(btn(m.status === 'ACCOUNT_SELECTION_REQUIRED' ? 'בחר חשבון מודעות' : 'בחר נכסים', function () { run(this, () => assetsPicker(picker, reload)); }, m.status === 'ACCOUNT_SELECTION_REQUIRED' && !m.missing.length ? 'primary' : 'secondary'));
      items.push(btn('בדוק עכשיו', function () { run(this, async () => { await api('connections/meta/check', {}); say('בדקתי את החיבור מול Meta.'); await reload(); }); }));
      items.push(btn('חבר מחדש', function () { run(this, () => openMetaLogin('connect')); }));
      items.push(btn('נתק', function () {
        run(this, async () => {
          if (!await UI.confirm('ניתוק מ־Meta', 'הסוכן יפסיק כל פעולה מול Meta, ואישורים שמחכים יבוטלו. הנתונים והטיוטות נשארים. אפשר לחבר שוב בכל רגע.', 'נתק')) return;
          await api('connections/meta/disconnect', { confirm: true }); say('החיבור ל־Meta נותק.'); await reload();
        });
      }, 'secondary danger'));
    }
    c.append(actions(...items), picker);
    return c;
  }

  // Live lists from Meta; the owner's choice is saved per business.
  async function assetsPicker(target, reload) {
    target.replaceChildren(el('p', 'טוען את החשבונות מ־Meta…', 'muted'));
    let a;
    try { a = await api('connections/meta/assets'); } catch (e) {
      target.replaceChildren(el('p', e.message || 'לא הצלחתי לטעון את הרשימות מ־Meta.', 'error'), btn('נסה שוב', function () { run(this, () => assetsPicker(target, reload)); }));
      return;
    }
    const box = el('div', '', 'asset-picker'); box.style.display = 'grid'; box.style.gap = '14px'; box.style.marginTop = '12px';
    const groups = [
      ['adAccount', 'חשבון מודעות', a.adAccounts.filter((x) => x.active).map((x) => [x.id, x.name + (x.currency ? ' · ' + x.currency : '')]), 'לא נמצא חשבון מודעות פעיל. אפשר לפתוח חשבון ב־Meta Business ואז לבדוק שוב.'],
      ['page', 'עמוד פייסבוק', a.pages.map((x) => [x.id, x.name]), 'לא נמצאו עמודים שאישרת גישה אליהם.'],
      ['instagram', 'חשבון אינסטגרם עסקי', a.instagram.map((x) => [x.id, handle(x.username)]), 'לא נמצא חשבון אינסטגרם עסקי שמחובר לעמודים שלך.'],
      ['pixel', 'פיקסל (מדידת המרות)', a.pixels.map((x) => [x.id, x.name + (x.lastFiredAt ? ' · פעיל' : ' · עוד לא קיבל אירועים')]), a.selected.adAccount ? 'לא נמצא פיקסל בחשבון המודעות הזה. אפשר ליצור אחד במנהל האירועים של Meta.' : 'קודם בוחרים חשבון מודעות.']
    ];
    for (const [kind, label, options, emptyText] of groups) {
      const wrap = el('div');
      const id = 'asset-' + kind;
      const lab = el('label', label); lab.htmlFor = id; lab.style.fontWeight = '700'; lab.style.display = 'block';
      wrap.append(lab);
      if (!options.length) { wrap.append(el('p', emptyText, 'muted')); box.append(wrap); continue; }
      const select = el('select'); select.id = id; tall(select); select.style.width = '100%';
      if (!a.selected[kind]) { const o = el('option', 'בחר…'); o.value = ''; select.append(o); }
      for (const [value, text] of options) { const o = el('option', text); o.value = value; o.selected = value === a.selected[kind]; select.append(o); }
      const save = btn('שמור', function () {
        run(this, async () => {
          if (!select.value) throw Error('בחר אפשרות מהרשימה.');
          await api('connections/meta/assets', { kind, id: select.value }); say('נשמר ✓'); await reload();
        });
      });
      const row = el('div'); row.style.display = 'flex'; row.style.gap = '8px'; row.style.alignItems = 'center';
      row.append(select, save); wrap.append(row); box.append(wrap);
    }
    box.append(el('p', 'הבחירה נשמרת לעסק שלך ואפשר לשנות אותה בכל רגע.', 'muted'));
    target.replaceChildren(box);
  }

  function publishingCard(list, reload) {
    const c = card('פרסום פוסטים בעמוד ובאינסטגרם', 'פרסום תוכן אורגני מהסוכן, לפי הסכם העבודה');
    if (!list.length) { c.append(el('p', 'החיבור הזה עוד לא זמין.', 'muted')); return c; }
    for (const p of list) {
      const box = el('div'); box.style.borderTop = '1px solid var(--border)'; box.style.paddingTop = '12px'; box.style.marginTop = '12px';
      box.append(el('h3', p.name), badge(p.connected ? 'מחובר ✓' : p.selectionRequired ? 'צריך לבחור חשבון' : p.expired ? 'פג תוקף' : p.configured ? 'לא מחובר' : 'עוד לא זמין', p.connected ? '' : 'muted'));
      if (p.displayName && p.connected) box.append(el('p', p.displayName));
      const items = [];
      if (!p.configured) box.append(el('p', 'החיבור הזה יגיע בקרוב.', 'muted'));
      else if (p.selectionRequired) {
        for (const a of p.accounts) items.push(btn(a.name, function () { run(this, async () => { await api('social/' + p.id + '/account', { accountId: a.id }); await reload(); }); }));
      } else if (!p.connected) {
        items.push(btn(p.expired ? 'חבר מחדש' : 'חבר את ' + p.name, function () {
          run(this, async () => {
            const r = await api('social/' + p.id + '/connect', {});
            const u = new URL(r.url);
            if (u.protocol !== 'https:' || !/(^|\.)facebook\.com$/.test(u.hostname)) throw Error('הקישור לא תקין. נסה שוב.');
            location.assign(u.href);
          });
        }, 'primary'));
      }
      if (p.hasAuthorization) {
        items.push(btn('נתק', function () {
          run(this, async () => {
            if (!await UI.confirm('ניתוק ' + p.name, 'הסוכן יפסיק לפרסם פוסטים ב־' + p.name + '. אפשר לחבר שוב בכל רגע.', 'נתק')) return;
            await api('social/' + p.id + '/disconnect', { confirm: true }); await reload();
          });
        }, 'secondary danger'));
      }
      box.append(actions(...items)); c.append(box);
    }
    return c;
  }

  function pixelCard(px, m, openAssets) {
    const c = card('פיקסל ומדידת המרות', 'Meta לומדת אילו פניות הפכו ללקוחות ומביאה עוד כאלה');
    c.append(badge(px.configured ? 'פיקסל מחובר ✓' : 'לא נבחר פיקסל', px.configured ? '' : 'muted'));
    c.append(facts([
      ['פיקסל', m.assets.pixel ? (m.assets.pixel.name || 'פיקסל שנבחר') : null],
      ['שליחת אירועים מהשרת (CAPI)', px.conversionsApi ? 'פעיל' : 'עוד לא פעיל בשרת'],
      ['אירוע אחרון שנשלח', when(px.lastEventAt)],
      ['אירועים שנכשלו', px.failedEvents ? String(px.failedEvents) : undefined]
    ]));
    if (!m.connected) c.append(el('p', 'כדי לבחור פיקסל צריך קודם לחבר את Meta.', 'muted'));
    else c.append(actions(btn(px.configured ? 'החלף פיקסל' : 'בחר פיקסל', function () { run(this, openAssets); }, px.configured ? 'secondary' : 'primary')));
    return c;
  }

  function leadCard(l, m) {
    const c = card('לידים מטפסי Meta', 'כל ליד שממלא טופס בפייסבוק או באינסטגרם נכנס אוטומטית ללידים');
    const ready = l.enabled && l.webhookReady && m.connected && !l.missingPermission;
    c.append(badge(ready && l.forms ? 'פעיל ✓' : ready ? 'מוכן, עוד לא נבחר טופס' : 'לא פעיל', ready ? '' : 'muted'));
    c.append(facts([
      ['קבלת לידים בשרת', l.enabled && l.webhookReady ? 'פעיל' : 'עוד לא פעיל בשרת'],
      ['טפסים מחוברים', String(l.forms)],
      ['ליד אחרון שהתקבל', when(l.lastLeadAt)]
    ]));
    if (l.missingPermission) {
      c.append(el('p', 'חסרה ההרשאה ״קבלת לידים מטפסי Meta״, ולכן לידים מהטפסים לא יגיעו.', 'notice'));
      c.append(actions(btn('תן הרשאה', function () { run(this, () => openMetaLogin('permissions')); }, 'primary')));
    } else if (!m.connected) c.append(el('p', 'כדי לקבל לידים מטפסים צריך קודם לחבר את Meta.', 'muted'));
    else if (l.enabled && !l.forms) c.append(el('p', 'בחר עמוד וטופס בחלק ״כלים נוספים״ למטה.', 'muted'));
    return c;
  }

  function whatsappCard(w) {
    const c = card('WhatsApp', 'השיחה עם הסוכן, התראות על לידים ואישורים');
    c.append(badge(w.connected ? 'מחובר ✓' : 'לא פעיל', w.connected ? '' : 'muted'));
    c.append(facts([['הודעה אחרונה שנשלחה אליך', when(w.lastMessageAt)]]));
    if (!w.connected) c.append(el('p', 'שליחת הודעות עוד לא פעילה בשרת. הצוות שלנו מטפל בזה.', 'muted'));
    return c;
  }

  async function load(body, extras) {
    const loading = el('p', 'טוען את מצב החיבורים…', 'muted'); loading.setAttribute('role', 'status');
    body.replaceChildren(loading);
    let d;
    try { d = await api('connections'); } catch (e) {
      const box = el('div', '', 'empty-state');
      box.append(el('h3', 'לא הצלחתי לטעון את החיבורים'), el('p', 'ייתכן שיש בעיית רשת. הנתונים שלך שמורים.', 'muted'), btn('נסה שוב', function () { run(this, () => load(body, extras)); }, 'primary'));
      body.replaceChildren(box);
      return;
    }
    const reload = () => load(body, extras);
    const s = stack();
    const metaBox = metaCard(d.meta, reload);
    const openAssets = async () => { metaBox.scrollIntoView({ behavior: 'smooth', block: 'start' }); const target = metaBox.lastChild; await assetsPicker(target, reload); };
    s.append(metaBox, publishingCard(d.publishing, reload), pixelCard(d.pixel, d.meta, openAssets), leadCard(d.leadAds, d.meta), whatsappCard(d.whatsapp));
    body.replaceChildren(s);
    if (extras) {
      const more = el('details', '', 'card'); more.style.marginTop = '16px';
      more.append(el('summary', 'כלים נוספים: טפסי לידים, פרסום אוטומטי, Webhook ועמודי מכירה'));
      body.append(more);
      try { for (const node of await extras()) if (node) more.append(node); } catch { more.append(el('p', 'לא הצלחתי לטעון את הכלים הנוספים.', 'muted')); }
    }
  }

  async function screen({ extras } = {}) {
    const body = el('div'); body.setAttribute('aria-live', 'polite');
    await load(body, extras);
    return [heading(), body];
  }
  return { screen };
})();
