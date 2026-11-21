'use strict';
// Clicks every safe button on every screen. Each click must do something visible
// (change the page, open a dialog, navigate, open a file picker or call the server),
// and must not cause console errors or failed requests.
const { test, expect, SCREENS, settled } = require('./fixtures');

// Never clicked: effects outside the demo (sign out, delete, money, publishing, approvals).
const UNSAFE = /יציאה|מחיק|מחק|הסר|ניתוק|ביטול מנוי|החזר|לאשר|מאשר|אישור|פרסום הדף|לפרסם|הזמנת יום צילום|ייצוא|שליחה$|חיבור Meta/;

async function candidates(page) {
  return page.evaluate((unsafe) => {
    const re = new RegExp(unsafe);
    return [...document.querySelectorAll('#dashboard-screen button, main > section:not([hidden]) button')]
      .filter((b) => b.getClientRects().length && !b.disabled && b.type !== 'submit' && !b.closest('dialog'))
      // Screen-reader-only controls (e.g. table sort headers when tables become cards on phones) are not visible buttons.
      .filter((b) => { for (let n = b; n; n = n.parentElement) { const c = getComputedStyle(n); if ((c.clip && c.clip !== 'auto') || (c.clipPath && c.clipPath !== 'none')) return false; } return true; })
      .map((b) => (b.textContent.trim() || b.getAttribute('aria-label') || '').slice(0, 60))
      .filter((label, i, all) => label && !re.test(label) && all.indexOf(label) === i); // repeated rows share one handler
  }, UNSAFE.source);
}

for (const screen of SCREENS) {
  test(`buttons on ${screen} all work`, async ({ page, problems }, info) => {
    await page.goto('/app/' + screen);
    await settled(page);
    const labels = await candidates(page);
    const dead = [], broken = [];
    let clicked = 0;
    for (const label of labels) {
      const nth = 0;
      if (!page.url().endsWith('/app/' + screen)) { await page.goto('/app/' + screen); await settled(page); }
      const target = page.locator('#dashboard-screen button, main > section:not([hidden]) button').filter({ hasText: label }).nth(nth);
      const fallback = page.getByRole('button', { name: label, exact: true }).nth(nth);
      const button = (await target.count()) ? target : fallback;
      if (!(await button.count()) || !(await button.isVisible()) || !(await button.isEnabled())) continue;
      await page.evaluate(() => { window.__effects = 0; window.__obs?.disconnect(); window.__obs = new MutationObserver((m) => { window.__effects += m.length; }); window.__obs.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); });
      let requests = 0, chooser = false;
      const onRequest = () => { requests++; }, onChooser = (fc) => { chooser = true; };
      page.on('request', onRequest); page.on('filechooser', onChooser);
      const before = page.url();
      await button.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
      page.off('request', onRequest); page.off('filechooser', onChooser);
      const effects = await page.evaluate(() => window.__effects || 0).catch(() => 1);
      if (!effects && !requests && !chooser && page.url() === before) dead.push(label);
      const status = await page.locator('#status').textContent().catch(() => '');
      if (/עוד לא זמין/.test(status)) broken.push(label + ' → leads to a screen that is not available');
      const shown = [status, ...await page.locator('.form-error, .error, dialog[open]').allTextContents()].join(' ');
      if (/\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/.test(shown)) broken.push(label + ' → raw error code: ' + shown.match(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/)[0]);
      clicked++;
      // Close whatever opened (dialogs, drawers, sheets) before the next click.
      for (let i = 0; i < 3 && await page.locator('dialog[open]').count(); i++) await page.keyboard.press('Escape');
    }
    info.annotations.push({ type: 'clicked', description: String(clicked) });
    expect(dead, 'buttons that do nothing').toEqual([]);
    expect(broken, 'buttons that lead nowhere or show raw errors').toEqual([]);
    expect(problems).toEqual([]);
  });
}
