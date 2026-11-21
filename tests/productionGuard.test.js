'use strict';
// Guard: production code paths never use mocks or placeholders, and the served dashboard has no
// fake content or dead buttons. Test-only files are whitelisted explicitly below.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// Production JavaScript: every .js outside tests, e2e, scripts, node_modules and dotfolders.
function productionFiles(dir = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (e.name.startsWith('.') || ['node_modules', 'tests', 'e2e', 'scripts', 'public', 'test-results', 'playwright-report', 'coverage'].includes(e.name)) continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...productionFiles(rel));
    else if (e.name.endsWith('.js') && e.name !== 'playwright.config.js') out.push(rel);
  }
  return out;
}

// Files allowed to load a mock Meta adapter, and why. Everything else is a failure.
const MOCK_ADAPTER_USERS = {
  'durableMockMetaAdapter.js': 'the adapter itself',
  'mockMetaAdapter.js': 'the adapter itself',
  'workflowWorker.js': 'isolated mock workflow; runOne() refuses unless MOCK_META_ENABLED=true, READ_ONLY=true and not production',
  'workflowReconciliation.js': 'only called by workflowWorker.runOne()'
};

test('only the whitelisted mock workflow loads a mock Meta adapter', () => {
  const offenders = productionFiles().filter((f) => !MOCK_ADAPTER_USERS[f] && /require\(['"][./]*(?:src\/[\w/]*)?(?:durableMockMetaAdapter|mockMetaAdapter)['"]\)/.test(read(f)));
  assert.deepEqual(offenders, [], 'production files load a mock Meta adapter');
  const reconcileUsers = productionFiles().filter((f) => f !== 'workflowReconciliation.js' && /require\(['"]\.\/workflowReconciliation['"]\)/.test(read(f)));
  assert.deepEqual(reconcileUsers, ['workflowWorker.js']);
});

test('the mock Meta workflow is off in production and whenever writes are allowed', async () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, MOCK_META_ENABLED: process.env.MOCK_META_ENABLED, READ_ONLY: process.env.READ_ONLY };
  try {
    const { runOne } = require('../workflowWorker');
    for (const env of [
      { NODE_ENV: 'production', MOCK_META_ENABLED: 'true', READ_ONLY: 'true' },
      { NODE_ENV: 'development', MOCK_META_ENABLED: 'true', READ_ONLY: 'false' },
      { NODE_ENV: 'development', MOCK_META_ENABLED: 'false', READ_ONLY: 'true' }
    ]) {
      Object.assign(process.env, env);
      assert.deepEqual(await runOne(), { status: 'DISABLED' }, JSON.stringify(env));
    }
    assert.match(read('worker.js'), /NODE_ENV === 'production'/, 'worker.js must refuse to start in production');
    assert.match(read('runtimeConfig.js'), /MOCK_META_ENABLED==='true'\) throw Error\('UNSAFE_PRODUCTION_MODE'\)/);
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test('the local rate-limit scale is ignored in production', () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, RATE_LIMIT_SCALE: process.env.RATE_LIMIT_SCALE };
  try {
    const { scale } = require('../rateLimit');
    process.env.RATE_LIMIT_SCALE = '50';
    process.env.NODE_ENV = 'production'; assert.equal(scale(), 1);
    process.env.NODE_ENV = 'development'; assert.equal(scale(), 50);
    delete process.env.RATE_LIMIT_SCALE; assert.equal(scale(), 1);
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

// ---------- the served dashboard ----------
const SERVED = [...fs.readdirSync(path.join(root, 'public/portal')).map((f) => 'public/portal/' + f),
  ...fs.readdirSync(path.join(root, 'public/landing')).map((f) => 'public/landing/' + f)];

// "Coming soon" lines that stay for now, and why. Everything else must be real or hidden.
const COMING_SOON_ALLOWED = [
  ['Google Ads ויומן Google יגיעו בקרוב.', 'integrations screen, owned by the Meta connections work (public/portal/connections.js)'],
  ['החיבור הזה יגיע בקרוב.', 'integrations screen: a social provider without server credentials, owned by the connections work']
];

test('served dashboard files have no TODO, placeholder text, mock or demo data', () => {
  const problems = [];
  for (const f of SERVED) {
    const text = read(f);
    for (const [re, what] of [
      [/\b(?:TODO|FIXME|XXX)\b/, 'unfinished-work marker'],
      [/lorem ipsum|\blorem\b/i, 'lorem ipsum'],
      [/\b(?:dummy|fake|mock)(?:Data|_data| data|Leads|Metrics|Campaigns)?\b/i, 'mock/dummy/fake'],
      [/placeholder (?:text|data|content)|PLACEHOLDER/, 'placeholder content'],
      [/[׳']?(?:₪\s?\d[\d,]{2,}|\d[\d,]{2,}\s?₪)['׳]/, 'hard-coded shekel amount'],
      [/stats\(\[\[[^\]]*?,\s*\d+\s*[,\]]/, 'hard-coded number in a stats row'],
      [/היכולת הזו טרם מומשה|תצוגה לדוגמה|נתוני דמו|נתונים לדוגמה/, 'demo/sample data wording']
    ]) if (re.test(text)) problems.push(`${f}: ${what} (${text.match(re)[0]})`);
    const soon = text.match(/[^'"`>]*בקרוב[^'"`<]*/g) || [];
    for (const line of soon) if (!COMING_SOON_ALLOWED.some(([allowed]) => line.includes(allowed.replace(/[.]$/, '')))) problems.push(`${f}: "coming soon" text: ${line.trim()}`);
  }
  assert.deepEqual(problems, []);
});

test('every button in the portal page has a handler', () => {
  const html = read('public/portal/index.html');
  const js = SERVED.filter((f) => f.endsWith('.js')).map(read).join('\n');
  const problems = [];
  for (const tag of html.match(/<button\b[^>]*>/g)) {
    const id = tag.match(/\bid="([^"]+)"/)?.[1], panel = /data-panel=/.test(tag), submit = /type="submit"/.test(tag) || !/type=/.test(tag);
    if (panel) { if (!/\[data-panel\]/.test(js)) problems.push(tag); continue; }
    if (id) { if (!new RegExp(`\\$\\('${id}'\\)|getElementById\\('${id}'\\)`).test(js)) problems.push(tag); continue; }
    if (!submit) problems.push(tag);
  }
  // Submit buttons belong to forms with a submit handler.
  for (const formId of (html.match(/<form id="([^"]+)"/g) || []).map((t) => t.match(/id="([^"]+)"/)[1])) {
    if (!new RegExp(`\\$\\('${formId}'\\)\\??\\.addEventListener\\('submit'|\\w+ = \\$\\('${formId}'\\)`).test(js)) problems.push('form #' + formId + ' has no submit handler');
  }
  // UI.button(label) with no action and no later submit type is a dead button.
  for (const f of SERVED.filter((x) => x.endsWith('.js'))) {
    for (const m of read(f).matchAll(/(?:const|let|,)\s*(\w+)\s*=\s*(?:btn|button)\(([^()]|\([^()]*\))*?,\s*null\s*(?:,[^)]*)?\)/g)) {
      const name = m[1], rest = read(f).slice(m.index, m.index + 600);
      if (!new RegExp(`${name}\\.type\\s*=\\s*'submit'`).test(rest)) problems.push(`${f}: button ${name} has no action and is not a submit button`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every screen in the dashboard menu has a working /app/<screen> address', async () => {
  const js = read('public/portal/dashboard.js');
  const groups = js.match(/const groups=(.*?);\n/)[1];
  const hidden = new Set(js.match(/const HIDDEN=new Set\((\[[^\]]*\])\)/)[1].match(/'([a-z-]+)'/g).map((s) => s.slice(1, -1)));
  const screens = [...groups.matchAll(/\['([a-z-]+)','/g)].map((m) => m[1]).filter((s) => !hidden.has(s));
  assert.ok(screens.length > 20 && screens.includes('integrations'));
  const express = require('express');
  const app = express().use(require('../portalRoutes'));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const failed = [];
    for (const s of [...screens, 'pages', 'onboarding', 'products']) {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/app/${s}`);
      if (r.status !== 200 || !(await r.text()).includes('/app/dashboard.js')) failed.push(s + ' ' + r.status);
    }
    assert.deepEqual(failed, []);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
