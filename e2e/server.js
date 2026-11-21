'use strict';
// E2E launcher (test-only, never used in production):
// - the real index.js on a throwaway embedded database (scripts/dev-local.js wiring: READ_ONLY,
//   no Meta writes, no WhatsApp sends, no billing),
// - served over HTTPS on localhost with a self-signed certificate, because the portal's session
//   cookies are Secure and its CSRF check requires an https APP_PUBLIC_URL origin,
// - a seeded demo business, and a 127.0.0.1-only helper that issues one-time login links.
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFileSync } = require('child_process');

const PORT = Number(process.env.E2E_PORT || 3443);
const root = path.join(__dirname, '..', '.local-dev');
const dataDir = path.join(root, 'e2e-pgdata');
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });

const keyFile = path.join(root, 'e2e-key.pem');
const certFile = path.join(root, 'e2e-cert.pem');
if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile,
    '-days', '30', '-subj', '/CN=localhost'], { stdio: 'ignore' });
}

process.env.PORT = String(PORT);
process.env.APP_PUBLIC_URL = `https://localhost:${PORT}/`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';

// index.js calls app.listen(); serve the same app over HTTPS instead.
const express = require('express');
express.application.listen = function listen(port, host, callback) {
  return https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, this).listen(port, callback); // all interfaces, IPv4 and IPv6 (localhost may resolve to ::1)
};

async function seed() {
  const db = require('../db');
  const clients = require('../clientStore');
  const facts = require('../conversationFacts');
  const store = require('../marketingStore');
  const crm = require('../crmService');
  const portal = require('../portalStore');
  const crypto = require('crypto');

  // An established business (most screens) and a brand-new one (onboarding).
  const main = await clients.getOrCreateClient('972500000101', 'E2E');
  const fresh = await clients.getOrCreateClient('972500000202', 'E2E new');
  await store.update(main.id, crypto.randomUUID(), (p) => {
    for (const [field, value] of Object.entries({
      businessName: 'משרד תיווך לדוגמה', businessType: 'תיווך נדל"ן', businessGoal: 'לידים של מוכרי דירות',
      product: 'תיווך במכירת דירה', audience: 'בעלי דירות בתל אביב', geography: 'תל אביב', serviceArea: 'תל אביב'
    })) facts.write(p, field, value);
    return { handled: true, changed: true };
  });
  await portal.register(main.id, { name: 'יעל', email: 'owner@example.test', acceptPrivacy: true });
  for (const [name, phone] of [['דני כהן', '0501111111'], ['רונית לוי', '0502222222']]) {
    await crm.create(main.id, { name, phone, note: 'ליד לדוגמה', source: 'manual', sourceEventId: crypto.randomUUID() });
  }
  await db.query("INSERT INTO tenant_audit(client_id,event,result) VALUES($1,'E2E_SEED','DONE')", [main.id]);
  return { main: main.id, fresh: fresh.id };
}

(async () => {
  await require('../scripts/dev-local').startLocal({ dataDir });
  const ids = await seed();
  const portal = require('../portalStore');
  // Local-only helper: GET /ticket?who=main|fresh&screen=leads -> one-time login URL.
  http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/ready') { res.writeHead(200).end('ok'); return; }
      if (url.pathname !== '/ticket') { res.writeHead(404).end(); return; }
      const id = ids[url.searchParams.get('who') || 'main'];
      if (!id) { res.writeHead(400).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(await portal.createTicket(id, url.searchParams.get('screen') || null));
    } catch (error) { res.writeHead(500).end(String(error.message)); }
  }).listen(PORT + 1, '127.0.0.1', () => console.log(`[e2e] ready on https://localhost:${PORT} (tickets on 127.0.0.1:${PORT + 1})`));
})().catch((error) => { console.error('[e2e] failed to start:', error); process.exit(1); });
