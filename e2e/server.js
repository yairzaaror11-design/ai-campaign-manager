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
Object.assign(process.env, { // the public privacy page needs its operator details (demo values)
  PRIVACY_OPERATOR_NAME: 'SCORPIO AI (demo)', PRIVACY_CONTACT_EMAIL: 'privacy@example.test',
  PRIVACY_HOSTING_PROVIDER: 'local demo', PRIVACY_BACKUP_RETENTION: '30 days'
});
process.env.RATE_LIMIT_SCALE = '50'; // all test browsers share one IP; production ignores this

// index.js calls app.listen(); serve the same app over HTTPS instead.
const express = require('express');
express.application.listen = function listen(port, host, callback) {
  return https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, this).listen(port, callback); // all interfaces, IPv4 and IPv6 (localhost may resolve to ::1)
};

async function seed() {
  const clients = require('../clientStore');
  const facts = require('../conversationFacts');
  const store = require('../marketingStore');
  const crm = require('../crmService');
  const portal = require('../portalStore');
  const crypto = require('crypto');

  // Two identical established businesses (desktop and mobile projects run in parallel and must
  // not change each other's data) and a brand-new one (onboarding).
  const established = async (phone) => {
    const client = await clients.getOrCreateClient(phone, 'E2E');
    await store.update(client.id, crypto.randomUUID(), (p) => {
      for (const [field, value] of Object.entries({
        businessName: 'משרד תיווך לדוגמה', businessType: 'תיווך נדל"ן', businessGoal: 'לידים של מוכרי דירות',
        product: 'תיווך במכירת דירה', audience: 'בעלי דירות בתל אביב', geography: 'תל אביב', serviceArea: 'תל אביב'
      })) facts.write(p, field, value);
      return { handled: true, changed: true };
    });
    await portal.register(client.id, { name: 'יעל', email: 'owner@example.test', acceptPrivacy: true });
    for (const [name, phone] of [['דני כהן', '0501111111'], ['רונית לוי', '0502222222']]) {
      await crm.create(client.id, { name, phone, note: 'ליד לדוגמה', source: 'manual', sourceEventId: crypto.randomUUID() });
    }
    return client;
  };
  const main = await established('972500000101');
  const second = await established('972500000303');
  const fresh = await clients.getOrCreateClient('972500000202', 'E2E new');
  return { main: main.id, second: second.id, fresh: fresh.id };
}

(async () => {
  await require('../scripts/dev-local').startLocal({ dataDir });
  const ids = await seed();
  const portal = require('../portalStore');
  // Local-only helper: GET /ticket?who=main|second|fresh&screen=leads -> one-time login URL.
  http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/ready') { res.writeHead(200).end('ok'); return; }
      if (url.pathname !== '/ticket') { res.writeHead(404).end(); return; }
      const id = ids[url.searchParams.get('who') || 'main'];
      if (!id) { res.writeHead(400).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(await portal.createTicket(id, url.searchParams.get('screen') || null));
    } catch (error) { res.writeHead(500).end(String(error.message)); }
  }).listen(PORT + 1, '127.0.0.1', () => console.log(`[e2e] ready on https://localhost:${PORT} (tickets on 127.0.0.1:${PORT + 1})`))
    .unref(); // the process ends with the app server (SIGTERM/SIGINT shutdown)
})().catch((error) => { console.error('[e2e] failed to start:', error); process.exit(1); });
