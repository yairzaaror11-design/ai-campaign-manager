'use strict';
// Signed-out screen, sign-in with a WhatsApp code, a brand-new business, logout, privacy pages.
const { test, expect, settled, noSidewaysScroll } = require('./fixtures');

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('shows the sign-in screen and handles a wrong code in Hebrew', async ({ page, problems }) => {
    problems.allow(/401: (GET \/app\/api\/dashboard|POST \/app\/api\/login\/code\/verify)$/); // expected while signed out / wrong code
    await page.goto('/app');
    await expect(page.locator('#locked')).toBeVisible();
    await expect(page.locator('#workspace')).toBeHidden();
    await expect(page.locator('#status')).toContainText('צריך להיכנס');
    await page.locator('#code-request [name=phone]').fill('0501234567');
    await page.locator('#code-request button[type=submit]').click();
    await expect(page.locator('#code-verify')).toBeVisible();
    await page.locator('#code-verify [name=code]').fill('000000');
    await page.locator('#code-verify button[type=submit]').click();
    await expect(page.locator('#status')).toHaveClass(/error/);
    await expect(page.locator('#status')).not.toContainText(/[A-Z]{3,}_[A-Z]/);
    await page.locator('#code-again').click();
    await expect(page.locator('#code-request')).toBeVisible();
    await noSidewaysScroll(page);
    expect(problems).toEqual([]);
  });

  test('an expired or used link says so in Hebrew', async ({ page, problems }) => {
    problems.allow(/401: POST \/app\/api\/login$/);
    problems.allow(/401: GET \/app\/api\/dashboard$/);
    await page.goto('/app#login=' + 'a'.repeat(64));
    await expect(page.locator('#locked')).toBeVisible();
    await expect(page.locator('#status')).toContainText('הקישור אינו תקף');
    expect(problems).toEqual([]);
  });

  test('privacy and data deletion pages are public', async ({ page }) => {
    for (const path of ['/privacy', '/data-deletion']) {
      const response = await page.goto(path);
      expect(response.status()).toBe(200);
      await noSidewaysScroll(page);
    }
  });
});

test.describe('a brand-new business', () => {
  test.use({ who: 'fresh' });

  test('lands in the app and can open onboarding', async ({ page, problems }) => {
    await page.goto('/app');
    await settled(page);
    await page.goto('/app/onboarding');
    await settled(page);
    await expect(page.getByRole('heading', { name: 'ספרו לנו על העסק שלכם' })).toBeVisible();
    await page.getByRole('button', { name: /אין לי אתר/ }).click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.keyboard.press('Escape');
    await noSidewaysScroll(page);
    expect(problems).toEqual([]);
  });

  test('every main screen has a proper empty state', async ({ page, problems }) => {
    for (const screen of ['home', 'leads', 'pipeline', 'customers', 'catalog', 'campaign', 'content', 'finance', 'approvals']) {
      await page.goto('/app/' + screen);
      await settled(page);
      await expect(page.locator('#dashboard-screen .error')).toHaveCount(0);
      await noSidewaysScroll(page);
    }
    expect(problems).toEqual([]);
  });
});

test('logout ends the session', async ({ page, problems }, info) => {
  // A separate session from the shared one, so other tests keep theirs.
  problems.allow(/401: GET \/app\/api\/dashboard$/);
  const link = await (await fetch(`http://127.0.0.1:${Number(process.env.E2E_PORT || 3443) + 1}/ticket?who=fresh`)).text();
  await page.context().clearCookies();
  await page.goto(new URL(link).pathname + new URL(link).hash);
  await settled(page);
  // From settings → account: reachable on every screen size (the sidebar is hidden on phones).
  await page.goto('/app/account');
  await settled(page);
  await page.getByRole('button', { name: 'חשבון', exact: true }).click();
  await page.locator('#account-logout').click();
  await expect(page.locator('#locked')).toBeVisible();
  await page.reload();
  await expect(page.locator('#locked')).toBeVisible();
  expect(problems).toEqual([]);
});
