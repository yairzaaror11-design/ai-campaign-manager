"use strict";
const express = require("express"),
  path = require("node:path");
const {
  db,
  randomUUID,
  fail,
  text,
  uuid,
  integer,
  fields,
  audit,
  owned,
  wrap,
  owner,
} = require("./common");
const auth = require("../dashboardAuth"),
  crm = require("./crm"),
  records = require("./records"),
  media = require("./media"),
  connections = require("./connections"),
  billing = require("./billing");
const router = express.Router();
router.use((req, res, next) => {
  res.set({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  next();
});
router.use(
  "/assets",
  express.static(path.join(__dirname, "public"), { index: false }),
);
router.get(["", "/"], (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);
router.post(
  "/billing/webhook",
  wrap(async (req, res) => {
    const raw = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null);
    res.json(await billing.webhook(raw, req.headers["stripe-signature"]));
  }),
);
router.get("/oauth/callback/:provider", async (req, res) => {
  const provider = req.params.provider;
  try {
    if (!Object.hasOwn(connections.extra, provider))
      throw fail("INVALID_PROVIDER");
    const name = "scorpio_oauth_" + provider,
      binding =
        String(req.headers.cookie || "")
          .split(";")
          .map((v) => v.trim())
          .find((v) => v.startsWith(name + "="))
          ?.slice(name.length + 1) || "";
    res.cookie(name, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/app/modules/oauth",
      maxAge: 0,
    });
    await connections.callback(provider, req.query, binding);
    res.redirect("/app/modules/#connections?result=connected");
  } catch {
    res.redirect("/app/modules/#connections?result=failed");
  }
});
router.use("/api", auth.guardOrigin, auth.authenticate);
// Bounded persistent rate limits apply across all module processes and accounts.
router.use(
  "/api",
  wrap(async (req, res, next) => {
    const bucket = "scorpio-http:" + req.dashboard.clientId;
    const r = await db.query(
      `INSERT INTO api_rate_limits(bucket,attempts,expires_at) VALUES($1,1,NOW()+INTERVAL '1 minute') ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN api_rate_limits.expires_at<NOW() THEN 1 ELSE api_rate_limits.attempts+1 END,expires_at=CASE WHEN api_rate_limits.expires_at<NOW() THEN NOW()+INTERVAL '1 minute' ELSE api_rate_limits.expires_at END RETURNING attempts`,
      [bucket],
    );
    if (r.rows[0].attempts > 120) throw fail("RATE_LIMITED", 429);
    next();
  }),
);
router.get("/api/me", (req, res) =>
  res.json({
    ...req.dashboard,
    actorHash: undefined,
    billingAdmin: billing.admin(req.dashboard.actorHash),
  }),
);
router.get(
  "/api/crm/summary",
  wrap(async (req, res) => res.json(await crm.summary(req.dashboard.clientId))),
);
router.get(
  "/api/crm/duplicates",
  wrap(async (req, res) =>
    res.json({ items: await crm.duplicates(req.dashboard.clientId) }),
  ),
);
router.get(
  "/api/crm/export",
  owner,
  wrap(async (req, res) => {
    res
      .set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="leads.csv"',
      })
      .send(await crm.exportCSV(req.dashboard.clientId));
  }),
);
router.post(
  "/api/crm/import",
  owner,
  wrap(async (req, res) =>
    res.json(await crm.importCSV(req.dashboard.clientId, req.body.csv)),
  ),
);
router.post(
  "/api/crm/merge",
  owner,
  wrap(async (req, res) => {
    fields(req.body, ["target", "source", "revisions"]);
    await crm.merge(
      req.dashboard.clientId,
      req.body.target,
      req.body.source,
      req.body.revisions || {},
    );
    res.json({ ok: true });
  }),
);
router.get(
  "/api/leads",
  wrap(async (req, res) =>
    res.json(await crm.list(req.dashboard.clientId, req.query)),
  ),
);
router.post(
  "/api/leads",
  owner,
  wrap(async (req, res) =>
    res
      .status(201)
      .json(
        await db.transaction((tx) =>
          crm.create(req.dashboard.clientId, req.body, tx),
        ),
      ),
  ),
);
router.patch(
  "/api/leads/:id",
  owner,
  wrap(async (req, res) =>
    res.json(
      await crm.update(req.dashboard.clientId, uuid(req.params.id), req.body),
    ),
  ),
);
router.delete(
  "/api/leads/:id",
  owner,
  wrap(async (req, res) => {
    await crm.remove(req.dashboard.clientId, req.params.id, req.body.revision);
    res.json({ ok: true });
  }),
);
router.get(
  "/api/leads/:id/notes",
  wrap(async (req, res) => {
    const id = req.dashboard.clientId,
      key = uuid(req.params.id);
    const lead = await db.query(
      "SELECT id FROM dashboard_leads WHERE client_id=$1 AND id=$2",
      [id, key],
    );
    if (!lead.rows.length) throw fail("NOT_FOUND", 404);
    res.json({
      items: (
        await db.query(
          "SELECT id,body,created_at FROM scorpio_notes WHERE client_id=$1 AND lead_id=$2 ORDER BY created_at DESC LIMIT 100",
          [id, key],
        )
      ).rows,
    });
  }),
);
router.post(
  "/api/leads/:id/notes",
  owner,
  wrap(async (req, res) => {
    const id = req.dashboard.clientId,
      key = uuid(req.params.id),
      body = text(req.body.body, 4000, true);
    await db.transaction(async (tx) => {
      await owned(tx, "dashboard_leads", key, id);
      await tx(
        "INSERT INTO scorpio_notes(id,client_id,lead_id,body) VALUES($1,$2,$3,$4)",
        [randomUUID(), id, key, body],
      );
      await audit(tx, id, "LEAD_NOTE_ADDED", key);
    });
    res.status(201).json({ ok: true });
  }),
);
router.get(
  "/api/records/:kind",
  wrap(async (req, res) =>
    res.json(
      await records.list(req.dashboard.clientId, req.params.kind, req.query),
    ),
  ),
);
router.post(
  "/api/records/:kind",
  owner,
  wrap(async (req, res) =>
    res
      .status(201)
      .json(
        await records.save(req.dashboard.clientId, req.params.kind, req.body),
      ),
  ),
);
router.put(
  "/api/records/:kind/:id",
  owner,
  wrap(async (req, res) =>
    res.json(
      await records.save(
        req.dashboard.clientId,
        req.params.kind,
        req.body.payload,
        uuid(req.params.id),
        req.body.revision,
      ),
    ),
  ),
);
router.delete(
  "/api/records/:kind/:id",
  owner,
  wrap(async (req, res) => {
    await records.remove(
      req.dashboard.clientId,
      req.params.kind,
      uuid(req.params.id),
      req.body.revision,
    );
    res.json({ ok: true });
  }),
);
router.post(
  "/api/campaigns/:id/review",
  owner,
  wrap(async (req, res) =>
    res.json(
      await records.requestLifecycle(
        req.dashboard.clientId,
        uuid(req.params.id),
        req.body.revision,
      ),
    ),
  ),
);
router.get(
  "/api/business",
  wrap(async (req, res) =>
    res.json(await records.business(req.dashboard.clientId)),
  ),
);
router.put(
  "/api/business",
  owner,
  wrap(async (req, res) =>
    res.json(
      await records.saveBusiness(
        req.dashboard.clientId,
        req.body.payload,
        req.body.revision,
      ),
    ),
  ),
);
router.get(
  "/api/media",
  wrap(async (req, res) =>
    res.json(await media.list(req.dashboard.clientId, req.query)),
  ),
);
router.post(
  "/api/media",
  owner,
  express.raw({
    type: ["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm"],
    limit: "20mb",
  }),
  wrap(async (req, res) =>
    res
      .status(201)
      .json(
        await media.upload(
          req.dashboard.clientId,
          req.body,
          req.headers["content-type"],
          {
            name: req.query.name,
            brand: req.query.brand,
            folderId: req.query.folder,
          },
        ),
      ),
  ),
);
router.get(
  "/api/media/:id/file",
  wrap(async (req, res) => {
    const asset = await media.load(req.dashboard.clientId, req.params.id);
    res
      .set({
        "Content-Type": asset.mime,
        "Content-Disposition": 'inline; filename="asset"',
        "Content-Length": String(asset.bytes.length),
      })
      .send(Buffer.from(asset.bytes));
  }),
);
router.patch(
  "/api/media/:id",
  owner,
  wrap(async (req, res) => {
    await media.rename(req.dashboard.clientId, req.params.id, req.body.name);
    res.json({ ok: true });
  }),
);
router.delete(
  "/api/media/:id",
  owner,
  wrap(async (req, res) => {
    await media.remove(req.dashboard.clientId, req.params.id);
    res.json({ ok: true });
  }),
);
router.get(
  "/api/ai/jobs",
  wrap(async (req, res) =>
    res.json({
      items: (
        await db.query(
          "SELECT id,kind,status,asset_id,output,error_code,created_at FROM scorpio_ai_jobs WHERE client_id=$1 ORDER BY created_at DESC LIMIT 50",
          [req.dashboard.clientId],
        )
      ).rows,
    }),
  ),
);
router.post(
  "/api/ai/generate",
  owner,
  wrap(async (req, res) =>
    res.json(await require("./ai").generate(req.dashboard.clientId, req.body)),
  ),
);
router.get(
  "/api/connections",
  wrap(async (req, res) =>
    res.json(await connections.list(req.dashboard.clientId)),
  ),
);
router.post(
  "/api/connections/:provider/connect",
  owner,
  wrap(async (req, res) => {
    const p = req.params.provider,
      id = req.dashboard.clientId;
    if (Object.hasOwn(require("../socialConnections").providers, p)) {
      const start = await require("../socialConnections").begin(
        id,
        p,
        req.dashboard.actorHash,
      );
      require("../socialConnections").setBinding(res, p, start.binding);
      return res.json({ url: start.url });
    }
    if (p === "meta")
      return res.json({
        url: await require("../metaConnection").createInvite(id),
      });
    if (["wordpress", "woocommerce"].includes(p)) {
      await connections.connectSite(id, p, req.body);
      return res.json({ ok: true });
    }
    const start = await connections.begin(
      id,
      p,
      req.dashboard.actorHash,
      req.body,
    );
    res.cookie("scorpio_oauth_" + p, start.binding, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/app/modules/oauth",
      maxAge: 600000,
    });
    res.json({ url: start.url });
  }),
);
router.post(
  "/api/connections/:provider/select",
  owner,
  wrap(async (req, res) => {
    const p = req.params.provider;
    if (Object.hasOwn(require("../socialConnections").providers, p))
      await require("../socialConnections").selectAccount(
        req.dashboard.clientId,
        p,
        req.body.accountId,
      );
    else if (p === "meta")
      await require("../metaConnection").selectAccount(
        req.dashboard.clientId,
        req.body.accountId,
      );
    else
      await connections.select(req.dashboard.clientId, p, req.body.accountId);
    res.json({ ok: true });
  }),
);
router.post(
  "/api/connections/:provider/disconnect",
  owner,
  wrap(async (req, res) => {
    await connections.disconnect(req.dashboard.clientId, req.params.provider);
    res.json({ ok: true });
  }),
);
router.post(
  "/api/connections/:provider/sync",
  owner,
  wrap(async (req, res) =>
    res.json(
      await connections.sync(req.dashboard.clientId, req.params.provider),
    ),
  ),
);
router.get(
  "/api/billing",
  wrap(async (req, res) =>
    res.json({
      ...(await billing.state(req.dashboard.clientId)),
      plans: await billing.catalog(),
    }),
  ),
);
router.post(
  "/api/billing/plans",
  owner,
  wrap(async (req, res) =>
    res.status(201).json(await billing.plan(req.body, req.dashboard.actorHash)),
  ),
);
router.post(
  "/api/billing/checkout",
  owner,
  wrap(async (req, res) =>
    res.json(
      await billing.checkout(
        req.dashboard.clientId,
        uuid(req.body.planId),
        req.body.confirm,
      ),
    ),
  ),
);
router.post(
  "/api/billing/:id/cancel",
  owner,
  wrap(async (req, res) =>
    res.json(
      await billing.cancel(
        req.dashboard.clientId,
        uuid(req.params.id),
        req.body.confirm,
      ),
    ),
  ),
);
router.use("/api", (req, res) => res.status(404).json({ code: "NOT_FOUND" }));
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.type === "entity.too.large" ? 413 : err.status || 503;
  res
    .status(status)
    .json({
      code:
        err.type === "entity.too.large"
          ? "FILE_TOO_LARGE"
          : err.status
            ? err.message
            : "MODULE_UNAVAILABLE",
    });
});
module.exports = { router };
