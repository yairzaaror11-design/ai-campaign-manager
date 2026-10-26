"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express"),
  crypto = require("node:crypto"),
  axios = require("axios");
const { openDatabase } = require("./helpers/database");
const { hash } = require("../dashboardAuth");
test("SCORPIO modules reuse tenant authentication and persist isolated business workflows", async (t) => {
  const env = { ...process.env },
    database = await openDatabase(),
    db = database.db,
    originalAdapter = axios.defaults.adapter;
  let server;
  try {
    await require("../scorpio/common").initialize();
    await require("../scorpio/common").initialize();
    const a = String(
        (
          await db.query(
            "INSERT INTO clients(phone) VALUES('+19991110001') RETURNING id",
          )
        ).rows[0].id,
      ),
      b = String(
        (
          await db.query(
            "INSERT INTO clients(phone) VALUES('+19991110002') RETURNING id",
          )
        ).rows[0].id,
      );
    const tokens = {
      owner: "a".repeat(48),
      other: "b".repeat(48),
      viewer: "c".repeat(48),
    };
    process.env.DASHBOARD_ACCOUNTS = JSON.stringify([
      { clientId: a, role: "owner", tokenHash: hash(tokens.owner) },
      { clientId: b, role: "owner", tokenHash: hash(tokens.other) },
      { clientId: a, role: "viewer", tokenHash: hash(tokens.viewer) },
    ]);
    const app = express();
    app.use(
      express.json({
        limit: "2mb",
        verify: (req, res, buf) => (req.rawBody = buf),
      }),
    );
    app.use("/app", require("../dashboard").router);
    app.use("/app/modules", require("../scorpio/router").router);
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const origin = "http://127.0.0.1:" + server.address().port;
    process.env.DASHBOARD_ORIGIN = origin;
    const request = (
      path,
      {
        cookie,
        method = "GET",
        body,
        originHeader = origin,
        type = "application/json",
      } = {},
    ) =>
      fetch(origin + "/app/modules" + path, {
        method,
        headers: {
          "Content-Type": type,
          "X-Dashboard-Request": "1",
          Origin: originHeader,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body !== undefined
          ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }
          : {}),
      });
    const login = async (token) => {
      const r = await fetch(origin + "/app/api/login", {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "X-Dashboard-Request": "1",
        },
        body: JSON.stringify({ token }),
      });
      assert.equal(r.status, 200);
      return r.headers.get("set-cookie").split(";")[0];
    };
    const owner = await login(tokens.owner),
      other = await login(tokens.other),
      viewer = await login(tokens.viewer);
    let lead, second, asset, campaign;
    await t.test(
      "public shell is Hebrew RTL with CSP and no data; API requires auth and same-origin owner mutations",
      async () => {
        const r = await request("/");
        assert.match(await r.text(), /lang="he" dir="rtl"/);
        assert.match(
          r.headers.get("content-security-policy"),
          /frame-ancestors 'none'/,
        );
        assert.equal((await request("/api/leads")).status, 401);
        assert.equal(
          (
            await request("/api/leads", {
              cookie: viewer,
              method: "POST",
              body: { name: "x" },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request("/api/leads", {
              cookie: owner,
              method: "POST",
              body: { name: "x" },
              originHeader: "https://evil.example",
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request("/api/leads", {
              cookie: owner,
              method: "POST",
              body: { name: "x", clientId: b },
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "create, search, edit and conflict protection use the existing CRM table",
      async () => {
        let r = await request("/api/leads", {
          cookie: owner,
          method: "POST",
          body: {
            name: "לקוח א",
            phone: "+972501234567",
            email: "a@example.test",
            details: {
              assignee: "מנהל",
              estimatedValue: 100,
              actualValue: 90,
              currency: "ILS",
              campaignId: "123",
            },
          },
        });
        assert.equal(r.status, 201);
        lead = (await r.json()).id;
        assert.equal(
          (
            await db.query("SELECT name FROM dashboard_leads WHERE id=$1", [
              lead,
            ])
          ).rows[0].name,
          "לקוח א",
        );
        let data = await (
          await request("/api/leads?q=" + encodeURIComponent("לקוח"), {
            cookie: owner,
          })
        ).json();
        assert.equal(data.items.length, 1);
        r = await request("/api/leads/" + lead, {
          cookie: owner,
          method: "PATCH",
          body: { revision: 1, name: "לקוח מעודכן", status: "WON" },
        });
        assert.equal(r.status, 200);
        assert.equal((await r.json()).revision, 2);
        assert.equal(
          (
            await request("/api/leads/" + lead, {
              cookie: owner,
              method: "PATCH",
              body: { revision: 1, name: "stale" },
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await request("/api/leads/" + lead, {
              cookie: other,
              method: "PATCH",
              body: { revision: 2, name: "attack" },
            })
          ).status,
          404,
        );
        assert.equal(
          (await (await request("/api/leads", { cookie: other })).json()).items
            .length,
          0,
        );
      },
    );
    await t.test(
      "notes and CSV enforce tenant ownership, quoting, duplicate detection and atomic validation",
      async () => {
        assert.equal(
          (
            await request("/api/leads/" + lead + "/notes", {
              cookie: other,
              method: "POST",
              body: { body: "attack" },
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await request("/api/leads/" + lead + "/notes", {
              cookie: owner,
              method: "POST",
              body: { body: "שיחה חשובה" },
            })
          ).status,
          201,
        );
        assert.equal(
          (
            await request("/api/crm/import", {
              cookie: owner,
              method: "POST",
              body: {
                csv: 'name,email\n"דנה, כהן",a@example.test\nחדש,new@example.test',
              },
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM dashboard_leads WHERE client_id=$1",
              [a],
            )
          ).rows[0].n,
          2,
        );
        const r = await request("/api/crm/import", {
          cookie: owner,
          method: "POST",
          body: { csv: "name,email\nValid,ok@example.test\nInvalid,broken" },
        });
        assert.equal(r.status, 400);
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM dashboard_leads WHERE client_id=$1",
              [a],
            )
          ).rows[0].n,
          2,
        );
        assert.throws(
          () => require("../scorpio/crm").parseCSV('name\n"open'),
          /INVALID_CSV/,
        );
        await request("/api/leads", {
          cookie: owner,
          method: "POST",
          body: { name: '=HYPERLINK("evil")' },
        });
        const csv = await (
          await request("/api/crm/export", { cookie: owner })
        ).text();
        assert.match(csv, /'=HYPERLINK/);
      },
    );
    await t.test(
      "duplicates merge with version checks and transfer owned notes without cross-tenant writes",
      async () => {
        second = (
          await (
            await request("/api/leads", {
              cookie: owner,
              method: "POST",
              body: { name: "duplicate", email: "a@example.test" },
            })
          ).json()
        ).id;
        let groups = (
          await (await request("/api/crm/duplicates", { cookie: owner })).json()
        ).items;
        assert.equal(groups.length, 1);
        const body = {
          target: lead,
          source: second,
          revisions: { target: 2, source: 1 },
        };
        assert.equal(
          (
            await request("/api/crm/merge", {
              cookie: other,
              method: "POST",
              body,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await request("/api/crm/merge", {
              cookie: owner,
              method: "POST",
              body: { ...body, revisions: { target: 1, source: 1 } },
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await request("/api/crm/merge", {
              cookie: owner,
              method: "POST",
              body,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await db.query("SELECT id FROM dashboard_leads WHERE id=$1", [
              second,
            ])
          ).rows.length,
          0,
        );
      },
    );
    await t.test(
      "images are decoded and rewritten; foreign or referenced media cannot be read/deleted",
      async () => {
        const png = await require("sharp")({
          create: { width: 8, height: 8, channels: 3, background: "#17654e" },
        })
          .png()
          .toBuffer();
        const r = await request("/api/media?name=test", {
          cookie: owner,
          method: "POST",
          body: png,
          type: "image/png",
        });
        assert.equal(r.status, 201);
        asset = (await r.json()).id;
        assert.equal(
          (await request("/api/media/" + asset + "/file", { cookie: other }))
            .status,
          404,
        );
        assert.equal(
          (
            await request("/api/media/" + asset + "/file", { cookie: owner })
          ).headers.get("content-type"),
          "image/png",
        );
        assert.equal(
          (
            await request("/api/media", {
              cookie: owner,
              method: "POST",
              body: Buffer.from("<script>bad</script>"),
              type: "image/png",
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "campaign drafts require tenant assets and create pending existing lifecycle with no approval/job/provider writes",
      async () => {
        const p = {
          name: "קמפיין בדיקה",
          objective: "לידים",
          product: "שירות",
          audience: "בעלי עסקים",
          platform: "meta",
          budget: 100,
          currency: "ILS",
          headline: "כותרת",
          copy: "טקסט",
          assetIds: [asset],
        };
        assert.equal(
          (
            await request("/api/records/campaign", {
              cookie: other,
              method: "POST",
              body: p,
            })
          ).status,
          404,
        );
        const r = await request("/api/records/campaign", {
          cookie: owner,
          method: "POST",
          body: p,
        });
        assert.equal(r.status, 201);
        campaign = (await r.json()).id;
        const before = (
          await db.query("SELECT count(*)::int AS n FROM workflow_jobs")
        ).rows[0].n;
        assert.equal(
          (
            await request("/api/campaigns/" + campaign + "/review", {
              cookie: owner,
              method: "POST",
              body: { revision: 1 },
            })
          ).status,
          200,
        );
        const flow = (
          await db.query(
            "SELECT payload,status FROM campaign_lifecycles WHERE client_id=$1",
            [a],
          )
        ).rows[0];
        assert.equal(flow.status, "AWAITING_DRAFT_APPROVAL");
        assert.equal(flow.payload.approvals.length, 0);
        assert.equal(
          (await db.query("SELECT count(*)::int AS n FROM workflow_jobs"))
            .rows[0].n,
          before,
        );
        assert.equal(
          (
            await request("/api/media/" + asset, {
              cookie: owner,
              method: "DELETE",
              body: {},
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "business settings revisions and appointment references enforce isolation",
      async () => {
        const p = {
          name: "עסק",
          brand: { primary: "#17654e" },
          stages: [{ id: "NEW", label: "חדש" }],
        };
        assert.equal(
          (
            await request("/api/business", {
              cookie: owner,
              method: "PUT",
              body: { payload: p, revision: 0 },
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request("/api/business", {
              cookie: owner,
              method: "PUT",
              body: { payload: p, revision: 0 },
            })
          ).status,
          409,
        );
        assert.deepEqual(
          (await (await request("/api/business", { cookie: other })).json())
            .payload,
          {},
        );
        assert.equal(
          (
            await request("/api/records/appointment", {
              cookie: other,
              method: "POST",
              body: { name: "bad", leadId: lead },
            })
          ).status,
          404,
        );
      },
    );
    await t.test(
      "writes from the original dashboard also invalidate module lead revisions",
      async () => {
        const before = (
          await db.query("SELECT revision FROM dashboard_leads WHERE id=$1", [
            lead,
          ])
        ).rows[0].revision;
        await db.query(
          "UPDATE dashboard_leads SET status='NEW',updated_at=NOW() WHERE id=$1",
          [lead],
        );
        assert.equal(
          (
            await db.query("SELECT revision FROM dashboard_leads WHERE id=$1", [
              lead,
            ])
          ).rows[0].revision,
          before + 1,
        );
        assert.equal(
          (
            await request("/api/leads/" + lead, {
              cookie: owner,
              method: "PATCH",
              body: { revision: before, name: "stale" },
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "unconfigured integrations are explicit; site URLs and unknown providers fail closed",
      async () => {
        const r = await request("/api/connections", { cookie: owner });
        assert.equal(r.status, 200);
        const items = (await r.json()).items;
        assert.equal(
          items.find((p) => p.id === "analytics").status,
          "requires_configuration",
        );
        assert.equal(
          (
            await request("/api/connections/analytics/connect", {
              cookie: owner,
              method: "POST",
              body: {},
            })
          ).status,
          503,
        );
        assert.equal(
          (
            await request("/api/connections/unknown/disconnect", {
              cookie: owner,
              method: "POST",
              body: {},
            })
          ).status,
          400,
        );
        const sites = require("../scorpio/connections");
        process.env.SCORPIO_SITE_HOSTS = "site.example";
        for (const u of [
          "http://site.example",
          "https://localhost",
          "https://127.0.0.1",
          "https://site.example@evil.example",
          "https://site.example/path",
        ])
          assert.throws(() => sites.siteURL(u));
      },
    );
    await t.test(
      "OAuth wrong-browser, replay and disconnect races do not authorize a connection",
      async () => {
        process.env.APP_PUBLIC_URL = "https://app.example";
        process.env.DASHBOARD_ORIGIN = "https://app.example";
        process.env.META_TOKEN_ENCRYPTION_KEY = crypto
          .randomBytes(32)
          .toString("base64");
        process.env.SCORPIO_GOOGLE_CLIENT_ID = "test-client";
        process.env.SCORPIO_GOOGLE_CLIENT_SECRET = "test-only";
        const c = require("../scorpio/connections");
        axios.defaults.adapter = async (config) => ({
          status: 200,
          statusText: "OK",
          headers: {},
          config,
          data: config.url.includes("oauth2.googleapis.com")
            ? {
                access_token: "test-access",
                refresh_token: "test-refresh",
                expires_in: 3600,
              }
            : {
                accountSummaries: [
                  {
                    propertySummaries: [
                      { property: "properties/123", displayName: "Property" },
                    ],
                  },
                ],
              },
        });
        const s = await c.begin(a, "analytics", hash(tokens.owner)),
          query = {
            state: new URL(s.url).searchParams.get("state"),
            code: "test-code",
          };
        assert.ok(new URL(s.url).searchParams.get("code_challenge"));
        await assert.rejects(
          c.callback("analytics", query, "x".repeat(43)),
          /INVALID_OAUTH_STATE/,
        );
        await c.callback("analytics", query, s.binding);
        assert.equal(
          (await c.list(a)).items.find((p) => p.id === "analytics").status,
          "connected",
        );
        await assert.rejects(
          c.callback("analytics", query, s.binding),
          /INVALID_OAUTH_STATE/,
        );
        const next = await c.begin(a, "analytics", hash(tokens.owner));
        await c.disconnect(a, "analytics");
        await assert.rejects(
          c.callback(
            "analytics",
            { state: new URL(next.url).searchParams.get("state"), code: "x" },
            next.binding,
          ),
          /INVALID_OAUTH_STATE/,
        );
        process.env.DASHBOARD_ORIGIN = origin;
      },
    );
    await t.test(
      "new provider adapters exchange tokens, constrain accounts, and persist bounded read snapshots with mocks",
      async () => {
        const c = require("../scorpio/connections");
        const cleaned = c.publicData({
          access_token: "do-not-expose",
          paging: { next: "https://provider.example/?access_token=secret" },
          nested: {
            url: "https://provider.example/?access_token=secret&id=123",
          },
        });
        assert.equal(JSON.stringify(cleaned).includes("secret"), false);
        assert.equal(JSON.stringify(cleaned).includes("do-not-expose"), false);
        process.env.APP_PUBLIC_URL = "https://app.example";
        process.env.DASHBOARD_ORIGIN = "https://app.example";
        process.env.SCORPIO_GOOGLE_ADS_VERSION = "v99";
        process.env.SCORPIO_GOOGLE_ADS_DEVELOPER_TOKEN = "fixture-developer";
        process.env.SCORPIO_PINTEREST_CLIENT_ID = "fixture-pinterest";
        process.env.SCORPIO_PINTEREST_CLIENT_SECRET =
          "fixture-pinterest-secret";
        process.env.SCORPIO_SHOPIFY_CLIENT_ID = "fixture-shopify";
        process.env.SCORPIO_SHOPIFY_CLIENT_SECRET = "fixture-shopify-secret";
        process.env.SCORPIO_SHOPIFY_VERSION = "2026-10";
        axios.defaults.adapter = async (config) => {
          let data;
          if (
            config.url.includes("oauth2.googleapis.com") ||
            config.url.includes("/oauth/token")
          )
            data = { access_token: "fixture-access", expires_in: 3600 };
          else if (config.url.endsWith("/admin/oauth/access_token"))
            data = { access_token: "fixture-shop-access" };
          else if (config.url.includes("listAccessibleCustomers"))
            data = { resourceNames: ["customers/123"] };
          else if (config.url.includes("googleAds:search"))
            data = { results: [{ campaign: { id: "456", name: "Fixture" } }] };
          else if (
            config.url ===
            "https://mybusinessaccountmanagement.googleapis.com/v1/accounts"
          )
            data = {
              accounts: [{ name: "accounts/123", accountName: "Business" }],
            };
          else if (config.url.includes("/locations"))
            data = { locations: [{ name: "locations/123", title: "Fixture" }] };
          else if (config.url.endsWith("/user_account"))
            data = { username: "fixture-studio" };
          else if (config.url.endsWith("/pins"))
            data = { items: [{ id: "fixture-pin" }] };
          else if (config.url.endsWith("/graphql.json"))
            data = {
              data: {
                shop: { name: "Fixture" },
                products: { nodes: [] },
                orders: { nodes: [] },
              },
            };
          else if (config.url.endsWith("/wp-json/wp/v2/users/me"))
            data = { id: 7 };
          else if (config.url.includes("/wp-json/")) data = [];
          else throw Error("UNEXPECTED_PROVIDER_ENDPOINT");
          return { status: 200, statusText: "OK", headers: {}, config, data };
        };
        for (const provider of [
          "google_ads",
          "business_profile",
          "pinterest",
          "shopify",
        ]) {
          await db.query("DELETE FROM api_rate_limits WHERE bucket=$1", [
            "scorpio:oauth:" + a,
          ]);
          const start = await c.begin(a, provider, hash(tokens.owner), {
            shop: "fixture-shop.myshopify.com",
          });
          const query = {
            state: new URL(start.url).searchParams.get("state"),
            code: "fixture-code",
          };
          if (provider === "shopify") {
            query.shop = "fixture-shop.myshopify.com";
            query.timestamp = String(Math.floor(Date.now() / 1000));
            const message = Object.keys(query)
              .sort()
              .map((k) => k + "=" + query[k])
              .join("&");
            query.hmac = crypto
              .createHmac("sha256", process.env.SCORPIO_SHOPIFY_CLIENT_SECRET)
              .update(message)
              .digest("hex");
          }
          await c.callback(provider, query, start.binding);
          assert.equal(
            (await c.list(a)).items.find((p) => p.id === provider).status,
            "connected",
          );
          await assert.rejects(
            c.select(b, provider, "forged"),
            /INVALID_ACCOUNT/,
          );
          const snapshot = await c.sync(a, provider);
          assert.equal(snapshot.partial, true);
          const row = (
            await db.query(
              "SELECT credentials,last_sync_at FROM scorpio_connections WHERE client_id=$1 AND provider=$2",
              [a, provider],
            )
          ).rows[0];
          assert.ok(row.last_sync_at);
          assert.equal(row.credentials.includes("fixture-access"), false);
        }
        process.env.SCORPIO_SITE_HOSTS = "site.example";
        await c.connectSite(a, "wordpress", {
          site: "https://site.example",
          username: "fixture-user",
          password: "fixture-only-password",
        });
        await c.sync(a, "wordpress");
        assert.equal(
          (
            await db.query(
              "SELECT credentials FROM scorpio_connections WHERE client_id=$1 AND provider=$2",
              [a, "wordpress"],
            )
          ).rows[0].credentials.includes("fixture-only-password"),
          false,
        );
        const bad = {
          code: "fixture",
          shop: "fixture-shop.myshopify.com",
          hmac: "0".repeat(64),
        };
        assert.throws(
          () =>
            c.verifyShopHmac(bad, process.env.SCORPIO_SHOPIFY_CLIENT_SECRET),
          /INVALID_SHOPIFY_SIGNATURE/,
        );
        process.env.DASHBOARD_ORIGIN = origin;
      },
    );
    await t.test(
      "billing catalog is admin-only and never accepts live keys; signed paid invoices credit once",
      async () => {
        const billing = require("../scorpio/billing");
        await assert.rejects(
          billing.plan({ name: "no" }, hash(tokens.owner)),
          /BILLING_ADMIN_REQUIRED/,
        );
        process.env.SCORPIO_BILLING_ADMINS = hash(tokens.owner);
        const plan = (
          await billing.plan(
            {
              name: "Sandbox",
              currency: "ils",
              amount: 100,
              interval: "month",
              credits: 10,
            },
            hash(tokens.owner),
          )
        ).id;
        process.env.SCORPIO_STRIPE_SECRET_KEY = "sk_live_rejected";
        await assert.rejects(
          billing.checkout(a, plan, true),
          /BILLING_SANDBOX_NOT_CONFIGURED/,
        );
        process.env.SCORPIO_STRIPE_SECRET_KEY = "sk_test_fixture";
        process.env.SCORPIO_STRIPE_WEBHOOK_SECRET = "test-only-signing-secret";
        const subscription = crypto.randomUUID();
        await db.query(
          "INSERT INTO scorpio_subscriptions(id,client_id,plan_id,plan_snapshot) VALUES($1,$2,$3,$4::jsonb)",
          [
            subscription,
            a,
            plan,
            JSON.stringify({ amount: 100, currency: "ils", credits: 10 }),
          ],
        );
        axios.defaults.adapter = async (config) => ({
          status: 200,
          statusText: "OK",
          headers: {},
          config,
          data: {
            id: "sub_test",
            metadata: { scorpio_subscription_id: subscription },
          },
        });
        const event = {
          id: "evt_1",
          livemode: false,
          type: "invoice.paid",
          data: {
            object: {
              id: "in_1",
              status: "paid",
              subscription: "sub_test",
              amount_paid: 100,
              currency: "ils",
            },
          },
        };
        const signed = (e) => {
          const raw = Buffer.from(JSON.stringify(e)),
            stamp = String(Math.floor(Date.now() / 1000));
          return {
            raw,
            sig:
              "t=" +
              stamp +
              ",v1=" +
              crypto
                .createHmac("sha256", process.env.SCORPIO_STRIPE_WEBHOOK_SECRET)
                .update(stamp + ".")
                .update(raw)
                .digest("hex"),
          };
        };
        let s = signed(event);
        await billing.webhook(s.raw, s.sig);
        assert.equal((await billing.state(a)).balance, 10);
        await billing.webhook(s.raw, s.sig);
        s = signed({ ...event, id: "evt_2" });
        await billing.webhook(s.raw, s.sig);
        assert.equal((await billing.state(a)).balance, 10);
        await assert.rejects(
          billing.webhook(s.raw, "t=1,v1=" + "0".repeat(64)),
          /INVALID_SIGNATURE/,
        );
        s = signed({ ...event, id: "evt_live", livemode: true });
        await assert.rejects(
          billing.webhook(s.raw, s.sig),
          /LIVE_PAYMENTS_DISABLED/,
        );
        assert.equal((await billing.state(b)).balance, 0);
      },
    );
    await t.test(
      "AI requires explicit cost approval, credits and idempotency; concurrent requests cannot overspend",
      async () => {
        const ai = require("../scorpio/ai");
        await assert.rejects(ai.generate(a, { kind: "text" }), /AI_DISABLED/);
        process.env.SCORPIO_AI_ENABLED = "true";
        let calls = 0;
        ai.register("text", async () => {
          calls++;
          return { text: "תוכן אמיתי מספק מדומה בבדיקה" };
        });
        const input = {
          kind: "text",
          prompt: "פוסט",
          confirmCost: true,
          idempotencyKey: crypto.randomUUID(),
        };
        const first = await ai.generate(a, input);
        assert.equal(first.status, "COMPLETE");
        assert.equal((await ai.generate(a, input)).status, "COMPLETE");
        assert.equal(calls, 1);
        await assert.rejects(
          ai.generate(a, { ...input, prompt: "changed" }),
          /IDEMPOTENCY_CONFLICT/,
        );
        await assert.rejects(
          ai.generate(b, { ...input, idempotencyKey: crypto.randomUUID() }),
          /INSUFFICIENT_CREDITS/,
        );
        assert.equal((await require("../scorpio/billing").state(a)).balance, 9);
        await db.query(
          "INSERT INTO scorpio_credits(id,client_id,delta,reason) VALUES($1,$2,1,'TEST_FIXTURE')",
          [crypto.randomUUID(), b],
        );
        const concurrent = await Promise.allSettled([
          ai.generate(b, { ...input, idempotencyKey: crypto.randomUUID() }),
          ai.generate(b, { ...input, idempotencyKey: crypto.randomUUID() }),
        ]);
        assert.equal(
          concurrent.filter((r) => r.status === "fulfilled").length,
          1,
        );
        assert.equal(
          concurrent.filter(
            (r) =>
              r.status === "rejected" &&
              r.reason.message === "INSUFFICIENT_CREDITS",
          ).length,
          1,
        );
        assert.equal((await require("../scorpio/billing").state(b)).balance, 0);
      },
    );
  } finally {
    axios.defaults.adapter = originalAdapter;
    if (server) await new Promise((r) => server.close(r));
    await database.close();
    for (const k of Object.keys(process.env))
      if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
  }
});
