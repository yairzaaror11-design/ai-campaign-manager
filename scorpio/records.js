"use strict";
const {
  db,
  randomUUID,
  fail,
  text,
  uuid,
  integer,
  fields,
  page,
  audit,
  owned,
} = require("./common");
const kinds = [
  "campaign",
  "post",
  "appointment",
  "ticket",
  "notification",
  "folder",
];
function validate(kind, input) {
  if (!kinds.includes(kind)) throw fail("INVALID_KIND");
  const allowed = {
    campaign: [
      "name",
      "objective",
      "product",
      "audience",
      "platform",
      "budget",
      "currency",
      "startDate",
      "endDate",
      "assetIds",
      "headline",
      "copy",
      "status",
    ],
    post: ["name", "text", "platform", "assetIds", "scheduledAt", "status", "contentType", "topic", "product", "creationMode"],
    appointment: ["name", "leadId", "scheduledAt", "notes", "status"],
    ticket: ["name", "text", "status"],
    notification: ["name", "text", "status"],
    folder: ["name"],
  };
  fields(input, allowed[kind]);
  const p = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === "assetIds") {
      if (!Array.isArray(v) || v.length > 10) throw fail("INVALID_ASSETS");
      p[k] = v.map(uuid);
    } else if (k === "budget") {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e8)
        throw fail("INVALID_BUDGET");
      p[k] = v;
    } else if (k === "leadId") p[k] = uuid(v);
    else if (["scheduledAt", "startDate", "endDate"].includes(k)) {
      if (
        v !== "" &&
        (typeof v !== "string" || !Number.isFinite(Date.parse(v)))
      )
        throw fail("INVALID_DATE");
      p[k] = v ? new Date(v).toISOString() : null;
    } else
      p[k] = text(
        v,
        ["copy", "text", "notes", "audience", "product"].includes(k)
          ? 4000
          : 200,
        k === "name",
      );
  }
  if (kind === "post") {
    if (p.contentType && !["post", "reel", "story", "carousel"].includes(p.contentType))
      throw fail("INVALID_CONTENT_TYPE");
    if (p.creationMode && !["manual", "ai"].includes(p.creationMode))
      throw fail("INVALID_CREATION_MODE");
  }
  if (!p.name) throw fail("NAME_REQUIRED");
  const statuses = {
    campaign: ["DRAFT", "REVIEW_REQUESTED"],
    post: ["DRAFT", "SCHEDULED"],
    appointment: ["OPEN", "DONE", "CANCELLED"],
    ticket: ["OPEN", "CLOSED"],
    notification: ["NEW", "READ"],
  };
  if (statuses[kind]) {
    p.status = p.status || statuses[kind][0];
    if (!statuses[kind].includes(p.status)) throw fail("INVALID_STATUS");
  }
  // Scheduling is a saved intention, never a claim of provider publication.
  if (kind === "post" && p.status === "SCHEDULED" && !p.scheduledAt)
    throw fail("SCHEDULE_REQUIRED");
  if (p.currency && !/^[A-Z]{3}$/.test(p.currency))
    throw fail("INVALID_CURRENCY");
  if (p.startDate && p.endDate && p.startDate > p.endDate)
    throw fail("INVALID_DATE_RANGE");
  return p;
}
async function references(tx, id, p) {
  for (const asset of p.assetIds || [])
    await owned(tx, "scorpio_assets", asset, id);
  if (p.leadId) await owned(tx, "dashboard_leads", p.leadId, id);
}
async function list(id, kind, q = {}) {
  if (!kinds.includes(kind)) throw fail("INVALID_KIND");
  const r = await db.query(
    "SELECT id,payload,revision,created_at,updated_at FROM scorpio_records WHERE client_id=$1 AND kind=$2 ORDER BY updated_at DESC,id LIMIT 51 OFFSET $3",
    [id, kind, page(q)],
  );
  return { items: r.rows.slice(0, 50), hasMore: r.rows.length > 50 };
}
async function save(id, kind, input, key = null, revision = null) {
  const p = validate(kind, input);
  return db.transaction(async (tx) => {
    await references(tx, id, p);
    if (key) {
      const old = await owned(tx, "scorpio_records", key, id);
      if (old.kind !== kind) throw fail("NOT_FOUND", 404);
      if (old.revision !== integer(revision, 1))
        throw fail("REVISION_CONFLICT", 409);
      await tx(
        "UPDATE scorpio_records SET payload=$3::jsonb,revision=revision+1,updated_at=NOW() WHERE client_id=$1 AND id=$2",
        [id, key, JSON.stringify(p)],
      );
    } else {
      key = randomUUID();
      await tx(
        "INSERT INTO scorpio_records(id,client_id,kind,payload) VALUES($1,$2,$3,$4::jsonb)",
        [key, id, kind, JSON.stringify(p)],
      );
    }
    await audit(tx, id, kind.toUpperCase() + "_SAVED", key);
    return { id: key };
  });
}
async function remove(id, kind, key, revision) {
  return db.transaction(async (tx) => {
    const row = await owned(tx, "scorpio_records", key, id);
    if (row.kind !== kind) throw fail("NOT_FOUND", 404);
    if (row.revision !== integer(revision, 1))
      throw fail("REVISION_CONFLICT", 409);
    if (kind === "folder")
      await tx(
        "UPDATE scorpio_assets SET folder_id=NULL WHERE client_id=$1 AND folder_id=$2",
        [id, key],
      );
    await tx("DELETE FROM scorpio_records WHERE client_id=$1 AND id=$2", [
      id,
      key,
    ]);
    await audit(tx, id, kind.toUpperCase() + "_DELETED", key);
  });
}
async function requestLifecycle(id, key, revision) {
  return db.transaction(async (tx) => {
    const row = await owned(tx, "scorpio_records", key, id);
    if (
      row.kind !== "campaign" ||
      row.revision !== integer(revision, 1) ||
      row.payload.status !== "DRAFT"
    )
      throw fail("REVISION_CONFLICT", 409);
    const p = row.payload;
    if (p.platform !== "meta")
      throw fail("LIFECYCLE_PLATFORM_UNSUPPORTED", 409);
    if (
      !p.objective ||
      !p.audience ||
      !p.product ||
      !p.headline ||
      !p.copy ||
      !p.assetIds?.length ||
      !(p.budget > 0) ||
      !p.currency
    )
      throw fail("CAMPAIGN_INCOMPLETE");
    await references(tx, id, p);
    const tenantId = String(id),
      brief = {
        id: key,
        tenantId,
        status: "APPROVED",
        objective: p.objective,
        product: p.product,
        audience: p.audience,
        budget: p.budget,
        currency: p.currency,
      };
    const flow = require("../campaignLifecycle").createLifecycle({
      tenantId,
      brief,
      strategy: { tenantId, briefId: key, platform: "meta" },
      creatives: p.assetIds.map((assetId) => ({
        assetId,
        headline: p.headline,
        copy: p.copy,
      })),
    });
    // Only a pending review is stored. No workflow_job or approval is created.
    await tx(
      "INSERT INTO campaign_lifecycles(id,client_id,payload,status) VALUES($1,$2,$3::jsonb,$4)",
      [flow.id, id, JSON.stringify(flow), flow.status],
    );
    await tx(
      "UPDATE scorpio_records SET payload=$3::jsonb,revision=revision+1,updated_at=NOW() WHERE client_id=$1 AND id=$2",
      [id, key, JSON.stringify({ ...p, status: "REVIEW_REQUESTED" })],
    );
    await audit(tx, id, "CAMPAIGN_REVIEW_REQUESTED", flow.id);
    return { lifecycleId: flow.id, status: flow.status };
  });
}
async function business(id) {
  const r = await db.query(
    "SELECT payload,revision FROM scorpio_business WHERE client_id=$1",
    [id],
  );
  return r.rows[0] || { payload: {}, revision: 0 };
}
async function saveBusiness(id, input, revision) {
  fields(input, [
    "name",
    "industry",
    "description",
    "website",
    "phone",
    "email",
    "address",
    "hours",
    "audience",
    "products",
    "services",
    "brand",
    "stages",
  ]);
  const p = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === "brand") {
      fields(v, ["primary", "secondary", "font", "voice", "guidelines"]);
      p.brand = {};
      for (const [a, b] of Object.entries(v)) {
        p.brand[a] = text(b, 1000);
        if (["primary", "secondary"].includes(a) && !/^#[a-f0-9]{6}$/i.test(b))
          throw fail("INVALID_COLOR");
      }
    } else if (k === "stages") {
      if (!Array.isArray(v) || v.length < 1 || v.length > 20)
        throw fail("INVALID_STAGES");
      p.stages = v.map((s) => {
        fields(s, ["id", "label"]);
        return { id: text(s.id, 40, true), label: text(s.label, 80, true) };
      });
      if (new Set(p.stages.map((s) => s.id)).size !== p.stages.length)
        throw fail("DUPLICATE_STAGE");
    } else
      p[k] = text(
        v,
        ["description", "audience", "products", "services"].includes(k)
          ? 4000
          : 300,
      );
  }
  if (p.website) {
    let u;
    try {
      u = new URL(p.website);
    } catch {
      throw fail("INVALID_URL");
    }
    if (u.protocol !== "https:" || u.username || u.password)
      throw fail("INVALID_URL");
  }
  return db.transaction(async (tx) => {
    await tx("SELECT id FROM clients WHERE id=$1 FOR UPDATE", [id]);
    const old = await tx(
      "SELECT revision FROM scorpio_business WHERE client_id=$1",
      [id],
    );
    if ((old.rows[0]?.revision || 0) !== integer(revision))
      throw fail("REVISION_CONFLICT", 409);
    const r = await tx(
      "INSERT INTO scorpio_business(client_id,payload) VALUES($1,$2::jsonb) ON CONFLICT(client_id) DO UPDATE SET payload=EXCLUDED.payload,revision=scorpio_business.revision+1 RETURNING revision",
      [id, JSON.stringify(p)],
    );
    await audit(tx, id, "BUSINESS_UPDATED");
    return r.rows[0];
  });
}
module.exports = {
  list,
  save,
  remove,
  requestLifecycle,
  business,
  saveBusiness,
  validate,
};
