'use strict';
// Logs in once per seeded business (main / fresh) and saves the session cookies, so tests
// never race each other on one-time links (issuing a link revokes the previous one).
const fs = require('fs');
const path = require('path');
const { request } = require('@playwright/test');
const PORT = Number(process.env.E2E_PORT || 3443);

module.exports = async () => {
  const dir = path.join(__dirname, '.auth');
  fs.mkdirSync(dir, { recursive: true });
  for (const who of ['main', 'fresh']) {
    const link = await (await fetch(`http://127.0.0.1:${PORT + 1}/ticket?who=${who}`)).text();
    const token = link.split('#login=')[1];
    const ctx = await request.newContext({ baseURL: `https://localhost:${PORT}`, ignoreHTTPSErrors: true });
    const res = await ctx.post('/app/api/login', { data: { token }, headers: { Origin: `https://localhost:${PORT}` } });
    if (!res.ok()) throw Error(`login for ${who} failed: ${res.status()}`);
    await ctx.storageState({ path: path.join(dir, who + '.json') });
    await ctx.dispose();
  }
};
