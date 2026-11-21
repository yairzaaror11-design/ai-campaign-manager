'use strict';
// Public routes: landing pages (/p/<slug>) and their lead forms, item photos, images Meta
// fetches when the agent publishes a post (/m/<id>), the accessibility statement, and the
// authenticated lead webhook per business (/hooks/leads/<id>).
const express = require('express'), path = require('node:path');
const router = express.Router();
const limit = (name, n) => require('./rateLimit').middleware(name, n);
const pages = () => require('./landingPages');
const PUBLIC_HEADERS = { 'X-Content-Type-Options': 'nosniff' };

router.get('/landing.js', (req, res) => res.set({ ...PUBLIC_HEADERS, 'Cache-Control': 'public, max-age=300' }).type('application/javascript').sendFile(path.join(__dirname, 'public/landing/landing.js')));
router.get('/landing.css', (req, res) => res.set({ ...PUBLIC_HEADERS, 'Cache-Control': 'public, max-age=300' }).type('text/css').sendFile(path.join(__dirname, 'public/landing/landing.css')));

router.get('/p/:slug', limit('landing-read', 120), async (req, res) => {
  try {
    const page = await pages().get(req.params.slug), v = await pages().view(page);
    res.set({ ...PUBLIC_HEADERS, 'Content-Security-Policy': pages().csp(v.pixel), 'Cache-Control': 'no-store' }).type('html').send(pages().render(v));
  } catch { res.sendStatus(404); }
});
router.get('/p/:slug/photo/:photoId', limit('landing-photo', 300), async (req, res) => {
  try {
    const p = await pages().photo(req.params.slug, req.params.photoId);
    res.set({ ...PUBLIC_HEADERS, 'Cache-Control': 'public, max-age=600', 'Content-Security-Policy': "default-src 'none'" }).type(p.mimeType).send(p.buffer);
  } catch { res.sendStatus(404); }
});
router.post('/p/:slug/lead', limit('landing-submit', 10), async (req, res) => {
  try {
    if (req.headers.origin !== require('./portalStore').origin() || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return res.sendStatus(403);
    await pages().submit(req.params.slug, req.body, { ip: req.ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 400) });
    res.json({ ok: true });
  } catch { res.status(400).json({ error: 'לא ניתן לשמור את הפנייה. בדקו את הפרטים ונסו שוב.' }); }
});

// Images the agent published (Meta downloads them by URL). Random ids, short-lived.
router.get('/m/:id', limit('channel-media', 120), async (req, res) => {
  const m = await require('./socialPublisher').media(req.params.id).catch(() => null);
  if (!m) return res.sendStatus(404);
  res.set({ ...PUBLIC_HEADERS, 'Cache-Control': 'public, max-age=3600', 'Content-Security-Policy': "default-src 'none'" }).type(m.mimeType).send(m.buffer);
});

router.get('/accessibility', (req, res) => res.set({ ...PUBLIC_HEADERS, 'Content-Security-Policy': "default-src 'none'; style-src 'self'" }).type('html').send(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>הצהרת נגישות</title><link rel="stylesheet" href="/landing.css"></head><body><main id="main"><h1>הצהרת נגישות</h1>
<p>דפי העסקים שנבנים ב־SCORPIO AI מותאמים לנייד ונבנו לפי עקרונות התקן הישראלי 5568 והנחיות WCAG 2.1 ברמה AA: כל שדה בטופס מתויג, אפשר לנווט במקלדת, יש קישור "דילוג לתוכן", הניגודיות בין טקסט לרקע עומדת בדרישות, לתמונות יש טקסט חלופי והודעות הטופס מוקראות לקוראי מסך.</p>
<p>אם נתקלתם בקושי, אפשר לפנות לעסק דרך הטופס בדף, או אלינו${process.env.PRIVACY_CONTACT_EMAIL ? ' בכתובת ' + require('./landingService').escape(process.env.PRIVACY_CONTACT_EMAIL) : ''}, ונטפל בזה.</p></main></body></html>`));

// Lead webhook per business, for website forms and Zapier. Authenticated by the secret
// shown once in the dashboard: "Authorization: Bearer <secret>" or "X-Scorpio-Key: <secret>".
router.post('/hooks/leads/:id', limit('lead-webhook', 60), express.urlencoded({ extended: false, limit: '64kb' }), async (req, res) => {
  res.set({ 'Cache-Control': 'no-store' });
  const header = String(req.headers.authorization || '');
  const secret = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.headers['x-scorpio-key'] || '');
  const intake = require('./leadIntake');
  const clientId = await intake.authenticate(req.params.id, secret).catch(() => null);
  if (!clientId) return res.status(401).json({ error: 'UNAUTHORIZED' });
  try {
    const saved = await intake.fromWebhook(clientId, req.body);
    res.status(saved.duplicate ? 200 : 201).json({ ok: true, duplicate: !!saved.duplicate, id: saved.id || null });
  } catch (e) {
    res.status(400).json({ error: /^[A-Z_]+$/.test(e.message) ? e.message : 'INVALID_LEAD' });
  }
});

module.exports = router;
