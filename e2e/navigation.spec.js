'use strict';
// Navigation: header departments, sidebar items (desktop), bottom bar and section tabs (mobile),
// search, notifications, the guided tour and browser back.
const { test, expect, settled, noSidewaysScroll } = require('./fixtures');

test('every menu item opens its screen', async ({ page, problems }, info) => {
  await page.goto('/app/home');
  await settled(page);
  const mobile = info.project.name === 'mobile';
  const departments = mobile ? page.locator('.mobile-bottom-nav [data-mobile-nav]') : page.locator('.department-nav [data-department]');
  const count = await departments.count();
  expect(count).toBe(5);
  for (let d = 0; d < count; d++) {
    await departments.nth(d).click();
    await settled(page);
    const items = mobile ? page.locator('#department-context button') : page.locator('#scorpio-sidebar nav button[data-screen]');
    const labels = await items.allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const before = page.url();
      const item = items.filter({ hasText: label.trim() }).first();
      // Advanced items sit in a collapsed "כלים נוספים" group.
      if (!await item.isVisible()) await page.locator('#scorpio-sidebar details.advanced-navigation > summary').click();
      await item.click();
      await settled(page);
      await expect(page.locator('#status')).not.toContainText('עוד לא זמין');
      await expect(page.locator('#dashboard-screen h1, #dashboard-screen h2').first()).toBeVisible();
      if (mobile) await noSidewaysScroll(page);
      expect(page.url() === before || /\/app\/[a-z-]+$/.test(page.url())).toBeTruthy();
    }
  }
  expect(problems).toEqual([]);
});

test('search, notifications, tour and back button', async ({ page, problems }, info) => {
  await page.goto('/app/home');
  await settled(page);
  // Search (⌘K / mobile search button) finds a screen by name.
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'פתיחת חיפוש' }).click();
  else await page.keyboard.press('Control+k');
  const search = page.locator('dialog[open] input[type=search]');
  await expect(search).toBeVisible();
  await search.fill('לידים');
  await expect(page.locator('dialog[open]')).toContainText('כל הלידים');
  await page.locator('dialog[open]').getByRole('button', { name: 'כל הלידים' }).click();
  await expect(page).toHaveURL(/\/app\/leads$/);
  // Notifications list what needs attention, each with a working action.
  await page.getByRole('button', { name: 'התראות ועדכונים' }).click();
  const notices = page.locator('dialog[open]');
  await expect(notices).toContainText(/לטפל|הכול מטופל|מחכה|ליד/);
  await expect(notices).not.toContainText('לא הצלחנו לטעון');
  await page.keyboard.press('Escape');
  // The guided tour runs to the end (desktop shows the floating tour button).
  if (info.project.name === 'desktop') {
    await page.getByRole('button', { name: 'הפעלת מדריך' }).click();
    const tour = page.locator('.tour-popover');
    for (let i = 0; i < 12 && await tour.count(); i++) await tour.getByRole('button', { name: /הבא|סיום/ }).click();
    await expect(tour).toHaveCount(0);
  }
  // Back returns to the previous screen.
  await page.goto('/app/leads');
  await page.goto('/app/catalog');
  await settled(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/leads$/);
  expect(problems).toEqual([]);
});
