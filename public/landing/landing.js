'use strict';
// Landing page behaviour: keeps UTM / click ids for the lead, asks before loading the
// Meta Pixel, validates the form accessibly and sends the lead with one event id that
// the browser pixel and the server (Conversions API) share, so Meta counts it once.
(function () {
  var body = document.body, pixel = body.getAttribute('data-pixel') || '', KEY = 'scorpio_measure';
  var params = new URLSearchParams(location.search), utm = {};
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'].forEach(function (k) { var v = params.get(k); if (v) utm[k] = v.slice(0, 500); });
  try {
    if (Object.keys(utm).length) sessionStorage.setItem('scorpio_utm', JSON.stringify(utm));
    else utm = JSON.parse(sessionStorage.getItem('scorpio_utm') || '{}') || {};
  } catch (e) { /* storage unavailable */ }
  var consent = null;
  try { consent = localStorage.getItem(KEY); } catch (e) { consent = null; }
  function loadPixel() {
    if (!pixel || window.fbq) return;
    var n = window.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!window._fbq) window._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    var s = document.createElement('script'); s.async = true; s.src = 'https://connect.facebook.net/en_US/fbevents.js'; document.head.appendChild(s);
    window.fbq('init', pixel); window.fbq('track', 'PageView');
  }
  var banner = document.getElementById('measure-banner');
  function remember(v) { consent = v; try { localStorage.setItem(KEY, v); } catch (e) { /* ignore */ } if (banner) banner.hidden = true; if (v === 'yes') loadPixel(); }
  if (pixel && banner) {
    if (consent === 'yes') loadPixel(); else if (consent !== 'no') banner.hidden = false;
    banner.querySelector('[data-measure="yes"]').addEventListener('click', function () { remember('yes'); });
    banner.querySelector('[data-measure="no"]').addEventListener('click', function () { remember('no'); });
  }
  function cookie(name) { var c = document.cookie.split('; ').find(function (x) { return x.indexOf(name + '=') === 0; }); return c ? c.slice(name.length + 1) : ''; }

  var form = document.getElementById('contact-form'), status = document.getElementById('form-status');
  if (!form) return;
  var eventId = crypto.randomUUID();
  function setError(input, message) {
    var box = document.getElementById(input.id + '-error');
    if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    if (box) box.textContent = message || '';
  }
  function validate() {
    var first = null;
    var checks = [
      ['f-name', function (v) { return v.trim().length >= 2 ? '' : 'צריך לכתוב שם.'; }],
      ['f-phone', function (v) { return /^\+?[\d ()-]{7,30}$/.test(v.trim()) ? '' : 'צריך מספר טלפון תקין, למשל 050-1234567.'; }],
      ['f-email', function (v) { return !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'כתובת הדוא״ל לא תקינה.'; }]
    ];
    checks.forEach(function (c) { var el = document.getElementById(c[0]); if (!el) return; var m = c[1](el.value); setError(el, m); if (m && !first) first = el; });
    var box = document.getElementById('f-consent') || form.querySelector('[name=consent]');
    if (box) { var m = box.checked ? '' : 'כדי לשלוח צריך לסמן הסכמה.'; setError(box, m); if (m && !first) first = box; }
    if (first) first.focus();
    return !first;
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validate()) { status.textContent = 'יש שדות שצריך לתקן.'; return; }
    var button = form.querySelector('button'); button.disabled = true; status.textContent = 'שולח…';
    var f = new FormData(form), measure = consent === 'yes' && !!pixel;
    var data = { name: f.get('name') || '', phone: f.get('phone') || '', email: f.get('email') || '', website: f.get('website') || '', consent: f.get('consent') === 'on', eventId: eventId, utm: utm, measurementConsent: measure, fbp: measure ? cookie('_fbp') : '', fbc: measure ? cookie('_fbc') : '', page: location.href.split('#')[0] };
    fetch(location.pathname.replace(/\/$/, '') + '/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { if (!r.ok) throw Error('לא ניתן לשלוח כרגע. בדקו את הפרטים ונסו שוב.'); })
      .then(function () {
        if (measure && window.fbq) window.fbq('track', 'Lead', {}, { eventID: eventId });
        form.hidden = true; status.textContent = 'הפנייה נשלחה. העסק יחזור אליכם לפי הפרטים שמסרתם.'; status.focus && status.setAttribute('tabindex', '-1'); status.focus();
      })
      .catch(function (err) { status.textContent = err.message; button.disabled = false; });
  });
})();
