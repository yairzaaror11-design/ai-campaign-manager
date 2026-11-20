'use strict';
// Experience layer: sign-in with a WhatsApp code, onboarding progress "X מתוך 5", the 30-second
// tour, and the "בבדיקה" badge on capabilities not yet verified with a real customer.
// All onboarding wording comes from the server (onboardingCopy.js).
window.ScorpioExperience = (() => {
  const $ = (id) => document.getElementById(id);
  const node = (tag, text = '', cls = '') => { const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n; };
  const say = (text, error = false) => { if (typeof window.tell === 'function') window.tell(text, error); else if ($('status')) $('status').textContent = text; };
  async function post(path, body) {
    const r = await fetch('/app/api/' + path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(data.error || 'הפעולה לא הושלמה.');
    return data;
  }
  const call = (path, body) => (typeof window.api === 'function' ? window.api(path, body) : post(path, body));

  // ---------- sign-in with a code ----------
  let phone = '';
  const request = $('code-request'), verify = $('code-verify');
  request?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = request.querySelector('button[type=submit]'); b.disabled = true;
    try {
      phone = request.elements.phone.value;
      const r = await post('login/code/request', { phone });
      say(r.message);
      request.hidden = true; verify.hidden = false; verify.elements.code.value = ''; verify.elements.code.focus();
    } catch (error) { say(error.message, true); } finally { b.disabled = false; }
  });
  verify?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = verify.querySelector('button[type=submit]'); b.disabled = true;
    try { await post('login/code/verify', { phone, code: verify.elements.code.value.trim() }); location.replace(location.pathname); }
    catch (error) { say(error.message, true); } finally { b.disabled = false; }
  });
  $('code-again')?.addEventListener('click', () => { verify.hidden = true; request.hidden = false; request.elements.phone.focus(); });

  // ---------- experience data (after sign-in) ----------
  let data = null, loading = null;
  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) loading = fetch('/app/api/experience', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((d) => { data = d; loading = null; return d; }).catch(() => { loading = null; return null; });
    return loading;
  }

  // ---------- "בבדיקה" badges ----------
  function badges() {
    if (!data?.capabilities) return;
    const titles = new Map();
    for (const c of data.capabilities) if (!c.verified) for (const t of c.titles || []) titles.set(t, c.badge);
    document.querySelectorAll('#main-content h1, #main-content h2').forEach((h) => {
      if (h.dataset.capabilityChecked) return;
      const label = titles.get(h.textContent.trim());
      h.dataset.capabilityChecked = '1';
      if (!label) return;
      const b = node('span', label, 'badge testing-badge');
      b.title = 'חדש. עוד לא נבדק עד הסוף עם לקוח אמיתי.';
      h.append(' ', b);
    });
  }
  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return; pending = true;
    requestAnimationFrame(() => { pending = false; if (!$('workspace') || $('workspace').hidden) { if (!document.querySelector('#dashboard-screen')) return; } load().then(badges); });
  });
  if ($('main-content')) observer.observe($('main-content'), { childList: true, subtree: true });

  // ---------- the 30-second tour ----------
  function tour(steps, labels) {
    if (!steps?.length || document.querySelector('.xp-tour')) return;
    let i = 0;
    const overlay = node('div', '', 'xp-tour'), box = node('div', '', 'xp-tour-box');
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', labels.open);
    const close = () => { overlay.remove(); post('experience/tour-seen', {}).catch(() => {}); if (data?.progress) data.progress.tourSeen = true; };
    const draw = () => {
      const s = steps[i], actions = node('div', '', 'actions');
      const next = node('button', i === steps.length - 1 ? labels.done : labels.next, 'primary'); next.type = 'button';
      next.addEventListener('click', () => { if (++i >= steps.length) close(); else draw(); });
      const skip = node('button', labels.skip, 'secondary'); skip.type = 'button'; skip.addEventListener('click', close);
      actions.append(next, skip);
      box.replaceChildren(node('p', `${i + 1} / ${steps.length}`, 'muted'), node('h2', s.title), node('p', s.text), actions);
      next.focus();
    };
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    overlay.append(box); document.body.append(overlay); draw();
  }

  // ---------- progress "X מתוך 5" (home screen) ----------
  function progressSection() {
    const sec = node('section', '', 'lg-sec xp-progress'); sec.hidden = true;
    load().then((d) => {
      const p = d?.progress;
      if (!p?.enabled) { sec.remove(); return; }
      const head = node('div', '', 'lg-sec-head'); head.append(node('h2', p.title));
      const bar = node('progress'); bar.max = p.total; bar.value = p.done; bar.setAttribute('aria-label', p.title);
      const list = node('ol', '', 'xp-steps');
      for (const s of p.steps) { const li = node('li', '', s.done ? 'done' : ''); li.append(node('span', s.done ? '✓' : '○', 'setup-mark'), node('span', s.title)); list.append(li); }
      const actions = node('div', '', 'actions');
      const t = node('button', p.tourLabels.open, 'secondary'); t.type = 'button'; t.addEventListener('click', () => tour(p.tour, p.tourLabels));
      actions.append(t);
      sec.replaceChildren(head, bar, ...(p.done < p.total ? [list] : []), actions);
      sec.hidden = false;
      // The 5-step progress replaces the older 3-step checklist on the same screen.
      if (p.done < p.total) document.querySelectorAll('.hx-setup').forEach((x) => { x.hidden = true; });
      if (!p.tourSeen) tour(p.tour, p.tourLabels);
      badges();
    });
    return sec;
  }

  return { progressSection, tour, load, badges, call };
})();
