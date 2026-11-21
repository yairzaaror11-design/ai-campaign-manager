'use strict';
// End-to-end flows: fill the real forms, save, and see the saved data on screen (and after a reload).
// Names are unique per run and project, because desktop and mobile share the seeded business.
const { test, expect, settled, noSidewaysScroll } = require('./fixtures');

const unique = (info, what) => `${what} ${info.project.name} ${Date.now().toString(36)}`;
const dialog = (page) => page.locator('dialog[open]');

async function saveRecord(page, screen, open, fill, name) {
  await page.goto('/app/' + screen);
  await settled(page);
  await page.getByRole('button', { name: open }).first().click();
  await expect(dialog(page)).toBeVisible();
  await fill(dialog(page));
  await dialog(page).getByRole('button', { name: /^שמירה$|שמירת טיוטה/ }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('#dashboard-screen')).toContainText(name);
  await page.reload();
  await settled(page);
  await expect(page.locator('#dashboard-screen')).toContainText(name);
}

test('add a lead, answer it, update the deal and see its history', async ({ page, problems }, info) => {
  const name = unique(info, 'ליד');
  await page.goto('/app/leads');
  await expect(page.locator('#lead-form')).toBeVisible();
  await page.locator('#lead-form [name=name]').fill(name);
  await page.locator('#lead-form [name=phone]').fill('0503334444');
  await page.locator('#lead-form [name=note]').fill('רוצה הערכת שווי');
  await page.locator('#lead-form button[type=submit]').click();
  await expect(page.locator('#status')).toContainText('הליד נשמר');
  const card = page.locator('article.lead', { hasText: name });
  await expect(card).toBeVisible();
  await expect(card).toContainText('מקור: הוספה ידנית');
  await card.getByRole('button', { name: /חזרתי ללקוח/ }).click();
  await expect(page.locator('#status')).toContainText('קיבל מענה');
  await expect(card.locator('select').first()).toHaveValue('CONTACTED');

  await card.getByRole('button', { name: 'הערות והכנסה' }).click();
  await dialog(page).locator('[name=note]').fill('נקבעה פגישה ליום ראשון');
  await dialog(page).getByRole('button', { name: 'שמירת הליד' }).click();
  await expect(dialog(page)).toHaveCount(0);

  await page.locator('article.lead', { hasText: name }).getByRole('button', { name: 'היסטוריה ותזכורת' }).click();
  await expect(dialog(page)).toContainText('הליד נכנס');
  await expect(dialog(page)).toContainText('שלב עודכן');
  await page.keyboard.press('Escape');
  expect(problems).toEqual([]);
});

test('lead moves through the pipeline', async ({ page, problems }, info) => {
  problems.allow(/400: POST \/app\/api\/leads$/); // the deliberate missing-contact attempt
  const name = unique(info, 'צנרת');
  await page.goto('/app/leads');
  await page.locator('#lead-form [name=name]').fill(name);
  // Without phone or email the server refuses, in Hebrew.
  await page.locator('#lead-form button[type=submit]').click();
  await expect(page.locator('#status')).toContainText('כדי לשמור ליד צריך טלפון או דוא״ל');
  await page.locator('#lead-form [name=email]').fill('buyer@example.test');
  await page.locator('#lead-form button[type=submit]').click();
  await expect(page.locator('article.lead', { hasText: name })).toBeVisible();
  await page.goto('/app/pipeline');
  await settled(page);
  const card = page.locator('.pipeline-column[data-status=NEW] .card', { hasText: name });
  await card.locator('select').selectOption('APPOINTMENT');
  await expect(page.locator('#status')).toContainText('השלב עודכן');
  await page.reload();
  await settled(page);
  await expect(page.locator('.pipeline-column[data-status=APPOINTMENT]')).toContainText(name);
  expect(problems).toEqual([]);
});

test('task, expense, product and customer profile are saved', async ({ page, problems }, info) => {
  const task = unique(info, 'משימה');
  await saveRecord(page, 'tasks', 'משימה חדשה', async (d) => { await d.locator('[name=title]').fill(task); await d.locator('[name=note]').fill('להתקשר לבעל הדירה'); }, task);
  const expense = unique(info, 'הוצאה');
  await saveRecord(page, 'expenses', 'הוצאה חדשה', async (d) => { await d.locator('[name=title]').fill(expense); await d.locator('[name=amountMinor]').fill('250'); }, expense);
  await page.goto('/app/finance');
  await settled(page);
  await expect(page.locator('#dashboard-screen')).not.toContainText('מתחילים מרישום ההוצאה הראשונה');
  const product = unique(info, 'מוצר');
  await saveRecord(page, 'products', 'הוסף מוצר', async (d) => { await d.locator('[name=name]').fill(product); await d.locator('[name=priceMinor]').fill('1000'); await d.locator('[name=costMinor]').fill('400'); }, product);
  const persona = unique(info, 'פרופיל');
  await saveRecord(page, 'research', 'פרופיל לקוח חדש', async (d) => { await d.locator('[name=name]').fill(persona); await d.locator('[name=audience]').fill('בעלי דירות 3 חדרים'); }, persona);
  expect(problems).toEqual([]);
});

test('a property is added to what I sell', async ({ page, problems }, info) => {
  const city = unique(info, 'עיר');
  await page.goto('/app/catalog');
  await settled(page);
  await page.getByRole('button', { name: /נכס חדש/ }).first().click();
  const d = dialog(page);
  await d.locator('[name=price]').fill('2900000');
  await d.locator('[name=a_city]').fill(city);
  await d.locator('[name=a_rooms]').fill('4');
  await d.locator('[name=licenseNumber]').fill('12345');
  await d.locator('[name=consent]').check();
  await d.getByRole('button', { name: 'שמירה' }).click();
  await expect(d).toHaveCount(0);
  await expect(page.locator('#dashboard-screen')).toContainText(city);
  expect(problems).toEqual([]);
});

test('a sales page is drafted, published and collects a lead', async ({ page, problems }, info) => {
  const title = unique(info, 'עמוד');
  await saveRecord(page, 'landing', 'צור עמוד מכירה', async (d) => {
    await d.locator('[name=businessName]').fill('משרד תיווך לדוגמה');
    await d.locator('[name=title]').fill(title);
    await d.locator('[name=body]').fill('הערכת שווי חינם לדירה שלך');
    await d.locator('[name=cta]').fill('השאירו פרטים');
  }, title);
  // Preview → publish (with the explicit confirmation) → the public page collects a lead.
  const row = page.locator('tr', { hasText: title });
  await row.getByRole('button', { name: 'תצוגה מקדימה' }).click();
  await dialog(page).getByRole('button', { name: 'אישור ופרסום העמוד' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'אישור פרסום' }).click();
  await expect(page.locator('#status')).toContainText('עמוד המכירה פורסם');
  const href = await page.locator('tr', { hasText: title }).getByRole('link', { name: 'פתיחת הדף' }).getAttribute('href');
  const visitor = await page.context().newPage();
  await visitor.goto(new URL(href).pathname);
  await expect(visitor.getByRole('heading', { name: title })).toBeVisible();
  const leadName = unique(info, 'פונה');
  await visitor.locator('#contact-form [name=name]').fill(leadName);
  await visitor.locator('#contact-form [name=phone]').fill('0507778888');
  await visitor.locator('#contact-form [name=consent]').check();
  await visitor.locator('#contact-form button').click();
  await expect(visitor.locator('#form-status')).not.toBeEmpty();
  await noSidewaysScroll(visitor);
  await visitor.close();
  await page.goto('/app/leads');
  const card = page.locator('article.lead', { hasText: leadName });
  await expect(card).toBeVisible();
  await expect(card).toContainText('מקור: עמוד מכירה');
  expect(problems).toEqual([]);
});

test('team member is added and the work agreement is saved', async ({ page, problems }, info) => {
  const member = unique(info, 'סוכן');
  await page.goto('/app/team');
  await settled(page);
  const form = page.locator('form', { has: page.locator('[name=areas]') });
  await form.locator('[name=name]').fill(member);
  await form.locator('[name=phone]').fill('05055' + String(Date.now()).slice(-5)); // unique: the same phone twice is refused
  await form.locator('[name=areas]').fill('גבעתיים, רמת גן');
  await form.getByRole('button', { name: 'הוספה' }).click();
  await expect(page.locator('#dashboard-screen')).toContainText(member);

  await page.goto('/app/agreement');
  await settled(page);
  await page.getByRole('button', { name: 'שמירת הסכם העבודה' }).click();
  await expect(page.locator('#status, #dashboard-screen [role=status]').first()).not.toHaveClass(/error/);
  expect(problems).toEqual([]);
});

test('the agent answers in the dashboard', async ({ page, problems }) => {
  await page.goto('/app/agent');
  await settled(page);
  await page.getByRole('button', { name: 'פתיחת שיחה' }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'מה כבר ידוע?' }).click();
  await expect(dialog(page).locator('.chat-message, .message, [data-role=assistant]').last()).toBeVisible({ timeout: 20_000 });
  expect(problems).toEqual([]);
});
