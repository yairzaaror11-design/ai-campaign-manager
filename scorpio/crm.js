"use strict";
const {
  db,
  randomUUID,
  fail,
  text,
  uuid,
  object,
  integer,
  fields,
  page,
  audit,
  owned,
} = require("./common");
const defaultStages = [
  ["NEW", "חדש"],
  ["CONTACTED", "לא עונה"],
  ["IN_PROGRESS", "ליד איכותי"],
  ["MEETING", "נקבעה פגישה"],
  ["WON", "נסגרה עסקה"],
  ["LOST", "לא נסגר"],
  ["IRRELEVANT", "לא רלוונטי"],
];
function details(input) {
  fields(input, [
    "assignee",
    "estimatedValue",
    "actualValue",
    "currency",
    "platform",
    "campaignId",
    "adId",
    "stage",
    "receivedAt",
  ]);
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (["estimatedValue", "actualValue"].includes(k)) {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e10)
        throw fail("INVALID_VALUE");
      out[k] = v;
    } else if (k === "receivedAt") {
      if (typeof v !== "string" || !Number.isFinite(Date.parse(v)))
        throw fail("INVALID_DATE");
      out[k] = new Date(v).toISOString();
    } else out[k] = text(v, k === "assignee" ? 120 : 200);
  }
  if (out.currency && !/^[A-Z]{3}$/.test(out.currency))
    throw fail("INVALID_CURRENCY");
  return out;
}
function lead(input) {
  fields(input, [
    "name",
    "phone",
    "email",
    "notes",
    "source",
    "status",
    "details",
    "revision",
  ]);
  const out = {};
  for (const key of ["name", "phone", "email", "notes", "source", "status"])
    if (input[key] !== undefined)
      out[key] = text(
        input[key],
        key === "notes" ? 4000 : key === "name" ? 120 : 254,
        key === "name",
      );
  if (out.phone && !/^\+[1-9]\d{6,14}$/.test(out.phone))
    throw fail("INVALID_PHONE");
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))
    throw fail("INVALID_EMAIL");
  if (out.status && !defaultStages.some((s) => s[0] === out.status))
    throw fail("INVALID_STATUS");
  if (input.details !== undefined) out.details = details(input.details);
  return out;
}
async function list(id, q) {
  const params = [id],
    where = ["client_id=$1"];
  if (q.q) {
    params.push("%" + text(q.q, 120) + "%");
    where.push(
      `(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length})`,
    );
  }
  if (q.status) {
    params.push(text(q.status, 40));
    where.push(`status=$${params.length}`);
  }
  params.push(page(q));
  const r = await db.query(
    `SELECT id,name,phone,email,notes,source,status,details,revision,created_at,updated_at FROM dashboard_leads WHERE ${where.join(" AND ")} ORDER BY created_at DESC,id LIMIT 51 OFFSET $${params.length}`,
    params,
  );
  return { items: r.rows.slice(0, 50), hasMore: r.rows.length > 50 };
}
async function create(id, input, tx = db.query) {
  const p = lead(input);
  if (!p.name) throw fail("NAME_REQUIRED");
  const key = randomUUID();
  await tx(
    "INSERT INTO dashboard_leads(id,client_id,name,phone,email,notes,source,status,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",
    [
      key,
      id,
      p.name,
      p.phone || "",
      p.email || "",
      p.notes || "",
      p.source || "manual",
      p.status || "NEW",
      JSON.stringify(p.details || {}),
    ],
  );
  await audit(tx, id, "LEAD_CREATED", key);
  return { id: key };
}
async function update(id, key, input) {
  const p = lead(input),
    revision = integer(input.revision, 1);
  return db.transaction(async (tx) => {
    const old = await owned(tx, "dashboard_leads", key, id);
    if (old.revision !== revision) throw fail("REVISION_CONFLICT", 409);
    const next = { ...old, ...p, details: { ...old.details, ...p.details } };
    const r = await tx(
      "UPDATE dashboard_leads SET name=$3,phone=$4,email=$5,notes=$6,source=$7,status=$8,details=$9::jsonb,revision=revision+1,updated_at=NOW() WHERE id=$1 AND client_id=$2 RETURNING revision",
      [
        key,
        id,
        next.name,
        next.phone,
        next.email,
        next.notes,
        next.source,
        next.status,
        JSON.stringify(next.details),
      ],
    );
    await audit(tx, id, "LEAD_UPDATED", key);
    return r.rows[0];
  });
}
async function remove(id, key, revision) {
  return db.transaction(async (tx) => {
    const old = await owned(tx, "dashboard_leads", key, id);
    if (old.revision !== integer(revision, 1))
      throw fail("REVISION_CONFLICT", 409);
    await tx("DELETE FROM dashboard_leads WHERE id=$1 AND client_id=$2", [
      key,
      id,
    ]);
    await audit(tx, id, "LEAD_DELETED", key);
  });
}
async function duplicates(id) {
  return (
    await db.query(
      "SELECT LOWER(email) AS contact,array_agg(id) AS ids FROM dashboard_leads WHERE client_id=$1 AND email<>'' GROUP BY LOWER(email) HAVING count(*)>1 UNION ALL SELECT phone,array_agg(id) FROM dashboard_leads WHERE client_id=$1 AND phone<>'' GROUP BY phone HAVING count(*)>1",
      [id],
    )
  ).rows;
}
async function merge(id, target, source, revisions) {
  uuid(target);
  uuid(source);
  if (target === source) throw fail("INVALID_MERGE");
  return db.transaction(async (tx) => {
    const rows = [];
    for (const key of [target, source].sort())
      rows.push(await owned(tx, "dashboard_leads", key, id));
    const a = rows.find((r) => r.id === target),
      b = rows.find((r) => r.id === source);
    if (
      a.revision !== integer(revisions.target, 1) ||
      b.revision !== integer(revisions.source, 1)
    )
      throw fail("REVISION_CONFLICT", 409);
    await tx(
      "UPDATE dashboard_leads SET phone=$3,email=$4,notes=$5,details=$6::jsonb,revision=revision+1,updated_at=NOW() WHERE id=$1 AND client_id=$2",
      [
        target,
        id,
        a.phone || b.phone,
        a.email || b.email,
        [a.notes, b.notes].filter(Boolean).join("\n").slice(0, 4000),
        JSON.stringify({ ...b.details, ...a.details }),
      ],
    );
    await tx(
      "UPDATE scorpio_notes SET lead_id=$3 WHERE lead_id=$1 AND client_id=$2",
      [source, id, target],
    );
    await tx("DELETE FROM dashboard_leads WHERE id=$1 AND client_id=$2", [
      source,
      id,
    ]);
    await audit(tx, id, "LEADS_MERGED", target);
  });
}
// RFC4180 parsing with bounded input and formula-safe export.
function parseCSV(input) {
  if (typeof input !== "string" || Buffer.byteLength(input) > 512000)
    throw fail("CSV_TOO_LARGE");
  input = input.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || !cell) quoted = !quoted;
      else throw fail("INVALID_CSV");
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v)) rows.push(row);
      cell = "";
      row = [];
    } else cell += c;
    if (rows.length > 500 || cell.length > 5000) throw fail("CSV_LIMIT");
  }
  if (quoted) throw fail("INVALID_CSV");
  row.push(cell);
  if (row.some((v) => v)) rows.push(row);
  return rows;
}
const csvCell = (v) =>
  '"' +
  String(v ?? "")
    .replace(/^[\s]*[=+\-@\t\r]/, (m) => "'" + m)
    .replace(/"/g, '""') +
  '"';
async function importCSV(id, input) {
  const [headers, ...rows] = parseCSV(input);
  if (
    !headers ||
    new Set(headers).size !== headers.length ||
    headers.some(
      (h) => !["name", "phone", "email", "notes", "source"].includes(h),
    ) ||
    !headers.includes("name")
  )
    throw fail("INVALID_CSV_HEADERS");
  const parsed = rows.map((row) => {
    if (row.length !== headers.length) throw fail("INVALID_CSV");
    return lead(Object.fromEntries(headers.map((h, i) => [h, row[i]])));
  });
  return db.transaction(async (tx) => {
    await tx("SELECT id FROM clients WHERE id=$1 FOR UPDATE", [id]);
    let imported = 0,
      skipped = 0;
    for (const p of parsed) {
      const exists = await tx(
        "SELECT id FROM dashboard_leads WHERE client_id=$1 AND (($2<>'' AND phone=$2) OR ($3<>'' AND LOWER(email)=LOWER($3))) LIMIT 1",
        [id, p.phone || "", p.email || ""],
      );
      if (exists.rows.length) {
        skipped++;
        continue;
      }
      await create(id, p, tx);
      imported++;
    }
    return { imported, skipped };
  });
}
async function exportCSV(id) {
  const rows = (
    await db.query(
      "SELECT name,phone,email,notes,source,status,created_at FROM dashboard_leads WHERE client_id=$1 ORDER BY id LIMIT 5001",
      [id],
    )
  ).rows;
  if (rows.length > 5000) throw fail("EXPORT_LIMIT", 409);
  const headers = [
    "name",
    "phone",
    "email",
    "notes",
    "source",
    "status",
    "created_at",
  ];
  return (
    "\uFEFF" +
    [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(",")),
    ].join("\r\n")
  );
}
async function summary(id) {
  const counts = await db.query(
    "SELECT status,count(*)::int AS count FROM dashboard_leads WHERE client_id=$1 GROUP BY status",
    [id],
  );
  const revenue = await db.query(
    "SELECT details->>'currency' AS currency,sum((details->>'actualValue')::numeric) AS total FROM dashboard_leads WHERE client_id=$1 AND status='WON' AND details ? 'actualValue' GROUP BY details->>'currency'",
    [id],
  );
  return {
    byStatus: counts.rows,
    revenueByCurrency: revenue.rows,
    attribution:
      "Only explicitly recorded platform/campaign/ad fields are attributed; no inferred conversions.",
  };
}
module.exports = {
  defaultStages,
  list,
  create,
  update,
  remove,
  duplicates,
  merge,
  parseCSV,
  importCSV,
  exportCSV,
  summary,
  details,
};
