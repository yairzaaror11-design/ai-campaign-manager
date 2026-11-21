'use strict';
// Shared E2E fixtures: a signed-in page that records console errors, page errors and
// failed (4xx/5xx or aborted) requests, plus helpers every spec uses.
const path = require('path');
const base = require('@playwright/test');

const SCREENS = ['home', 'approvals', 'agent', 'leads', 'pipeline', 'customers', 'growth', 'team', 'tasks', 'sales',
  'catalog', 'campaign', 'performance', 'landing', 'research', 'content', 'creative', 'agreement', 'brand', 'finance',
  'profitability', 'expenses', 'integrations', 'billing', 'users', 'account', 'help', 'support', 'pages', 'products', 'onboarding'];

const test = base.test.extend({
  who: ['main', { option: true }],
  storageState: async ({ who }, use) => use(path.join(__dirname, '.auth', who + '.json')),
  problems: async ({ page }, use) => {
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.request().method()} ${new URL(r.url()).pathname}`); });
    page.on('requestfailed', (r) => {
      const why = r.failure()?.errorText || '';
      // Navigating away cancels in-flight requests; that is not a failure.
      if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(why)) problems.push(`requestfailed: ${r.method()} ${r.url()} ${why}`);
    });
    await use(problems);
  }
});

// The screen left its loading state: content rendered, no "טוען" placeholder, no skeleton.
async function settled(page) {
  await base.expect(page.locator('#dashboard-screen')).toBeVisible();
  await base.expect.poll(async () => page.evaluate(() => {
    const s = document.querySelector('#dashboard-screen');
    if (!s || !s.children.length) return 'empty';
    const visibleText = [...s.querySelectorAll('*')].filter((n) => n.childElementCount === 0 && n.getClientRects().length)
      .map((n) => n.textContent.trim()).join(' ');
    if (/טוען|בודק את/.test(visibleText)) return 'loading';
    if (s.querySelector('[aria-busy="true"], .skeleton')) return 'busy';
    return 'ok';
  }), { timeout: 15_000 }).toBe('ok');
}

async function noSidewaysScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  base.expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(1);
}

module.exports = { test, expect: base.expect, SCREENS, settled, noSidewaysScroll };
