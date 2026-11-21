'use strict';
// Every screen loads, leaves its loading state, shows no error, has no console errors,
// no failed requests and (on mobile) no sideways scroll.
const { test, expect, SCREENS, settled, noSidewaysScroll } = require('./fixtures');

for (const screen of SCREENS) {
  test(`screen ${screen} loads cleanly`, async ({ page, problems }) => {
    await page.goto('/app/' + screen);
    await settled(page);
    await expect(page.locator('#dashboard-screen .error, #dashboard-screen .form-error:not(:empty)')).toHaveCount(0);
    await expect(page.locator('#status.error')).toHaveCount(0);
    // No placeholder screens and no redirect away from a menu item.
    await expect(page.locator('#dashboard-screen')).not.toContainText(/היכולת הזו עדיין אינה מחוברת|lorem|TODO|placeholder/i);
    await expect(page.locator('#status')).not.toContainText('עוד לא זמין');
    await noSidewaysScroll(page);
    expect(problems).toEqual([]);
  });
}
