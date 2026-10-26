"use strict";
// Optional UI verification: requires Playwright and an installed Chromium.
// Uses an isolated, disposable PGlite database; no provider calls or real data.
const assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  path = require("node:path");
const { chromium } = require("playwright");
async function run() {
  const fixture = await require("../../tests/helpers/database").openDatabase();
  let server, browser;
  try {
    await require("../common").initialize();
    const id = String(
        (
          await fixture.db.query(
            "INSERT INTO clients(phone,display_name) VALUES('+19998887777','עסק בדיקה מבודד') RETURNING id",
          )
        ).rows[0].id,
      ),
      token = crypto.randomBytes(32).toString("hex");
    process.env.DASHBOARD_ACCOUNTS = JSON.stringify([
      {
        clientId: id,
        role: "owner",
        tokenHash: require("../../dashboardAuth").hash(token),
      },
    ]);
    const app = require("../../index");
    app.use("/app/modules", require("../router").router);
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const origin = "http://127.0.0.1:" + server.address().port;
    process.env.DASHBOARD_ORIGIN = origin;
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/app/modules/");
    await page.locator("#login input[name=token]").fill(token);
    await page.locator("#login-form button").click();
    await page.locator("#workspace").waitFor({ state: "visible" });
    await page
      .getByRole("heading", { name: "החיבורים שלי", exact: true })
      .waitFor();
    await page.locator('#nav a[href="#crm"]').click();
    await page.getByRole("button", { name: "ליד חדש", exact: true }).click();
    await page.locator("#editor input[name=name]").fill("לקוח מהדפדפן");
    await page.locator("#editor input[name=phone]").fill("+972501234567");
    await page
      .locator("#editor input[name=email]")
      .fill("browser@example.test");
    await page.locator("#editor button[type=submit]").click();
    await page.locator("#editor").waitFor({ state: "hidden" });
    await page
      .getByRole("cell", { name: "לקוח מהדפדפן", exact: true })
      .waitFor();
    await page.screenshot({
      path: path.join(__dirname, "../screenshots/crm-desktop.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "תצוגת Kanban", exact: true })
      .click();
    await page.locator(".module-lane").first().waitFor();
    assert.equal(await page.locator(".module-lane").count(), 7);
    await page.locator('#nav a[href="#campaigns"]').click();
    await page.getByRole("button", { name: "יצירה חדשה", exact: true }).click();
    await page.locator("#editor input[name=name]").fill("טיוטה מבודדת");
    await page.locator("#editor input[name=objective]").fill("לידים");
    await page
      .locator("#editor")
      .getByRole("button", { name: "הבא", exact: true })
      .click();
    await page.locator("#editor textarea[name=product]").fill("מוצר בדיקה");
    await page
      .locator("#editor")
      .getByRole("button", { name: "הבא", exact: true })
      .click();
    await page.locator("#editor textarea[name=audience]").fill("עסקים");
    await page
      .locator("#editor")
      .getByRole("button", { name: "הבא", exact: true })
      .click();
    await page
      .locator("#editor")
      .getByRole("button", { name: "הבא", exact: true })
      .click();
    await page.locator("#editor input[name=budget]").fill("100");
    await page
      .locator("#editor")
      .getByRole("button", { name: "הבא", exact: true })
      .click();
    await page.locator("#editor input[name=headline]").fill("כותרת");
    await page.locator("#editor textarea[name=copy]").fill("עותק");
    await page.locator("#editor button[type=submit]").click();
    await page.locator("#editor").waitFor({ state: "hidden" });
    await page
      .getByRole("heading", { name: "טיוטה מבודדת", exact: true })
      .waitFor();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const item of [
        "connections",
        "crm",
        "campaigns",
        "media",
        "posts",
        "billing",
        "business",
        "tasks",
        "support",
        "knowledge",
        "activity",
        "settings",
      ]) {
        await page.locator('#nav a[href="#' + item + '"]').click();
        await page.waitForTimeout(100);
        assert.equal(
          await page.evaluate(() => document.documentElement.dir),
          "rtl",
        );
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        );
        assert.equal(
          overflow,
          false,
          "page overflow: " + item + " at " + width,
        );
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#nav a[href="#crm"]').click();
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(__dirname, "../screenshots/crm-mobile.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    assert.equal(
      (
        await fixture.db.query(
          "SELECT count(*)::int AS n FROM dashboard_leads WHERE client_id=$1",
          [id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await fixture.db.query(
          "SELECT count(*)::int AS n FROM scorpio_records WHERE client_id=$1 AND kind=$2",
          [id, "campaign"],
        )
      ).rows[0].n,
      1,
    );
    console.log(
      "PASS: browser login, persisted CRM create, Kanban, campaign wizard, all 12 module pages at 390/768/1440px, RTL, no horizontal page overflow, no JavaScript exceptions.",
    );
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
    await fixture.close();
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
