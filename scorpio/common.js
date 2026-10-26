"use strict";
const db = require("../db");
const { randomUUID } = require("node:crypto");
const fail = (code, status = 400) => Object.assign(Error(code), { status });
function text(v, max = 200, required = false) {
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    throw fail("INVALID_INPUT");
  return v.trim();
}
function uuid(v) {
  if (
    typeof v !== "string" ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v)
  )
    throw fail("INVALID_ID");
  return v;
}
function object(v) {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw fail("INVALID_INPUT");
  return v;
}
function integer(v, min = 0, max = 100000000) {
  if (!Number.isSafeInteger(v) || v < min || v > max)
    throw fail("INVALID_NUMBER");
  return v;
}
function fields(v, names) {
  object(v);
  if (Object.keys(v).some((k) => !names.includes(k)))
    throw fail("UNKNOWN_FIELD");
  return v;
}
function page(q) {
  return integer(Number(q.offset || 0), 0, 100000);
}
async function audit(tx, id, event, result = "SAVED") {
  await tx(
    "INSERT INTO tenant_audit(client_id,event,result) VALUES($1,$2,$3)",
    [id, "SCORPIO_" + event, result],
  );
}
async function owned(tx, table, id, tenant) {
  const r = await tx(
    `SELECT * FROM ${table} WHERE id=$1 AND client_id=$2 FOR UPDATE`,
    [uuid(id), tenant],
  );
  if (!r.rows.length) throw fail("NOT_FOUND", 404);
  return r.rows[0];
}
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const owner = (req, res, next) =>
  req.dashboard.role === "owner"
    ? next()
    : res.status(403).json({ code: "PERMISSION_DENIED" });
async function initialize() {
  const sql = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "schema.sql"),
    "utf8",
  );
  const checksum = require("node:crypto")
    .createHash("sha256")
    .update(sql)
    .digest("hex");
  await db.transaction(async (tx) => {
    await tx("SELECT pg_advisory_xact_lock(724919)");
    await tx(
      "CREATE TABLE IF NOT EXISTS scorpio_versions(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
    );
    const applied = await tx(
      "SELECT checksum FROM scorpio_versions WHERE version=1",
    );
    if (applied.rows.length) {
      if (applied.rows[0].checksum !== checksum)
        throw Error("MODULE_SCHEMA_CHECKSUM_MISMATCH");
      return;
    }
    await tx(sql);
    await tx("INSERT INTO scorpio_versions(version,checksum) VALUES(1,$1)", [
      checksum,
    ]);
  });
}
module.exports = {
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
  wrap,
  owner,
  initialize,
};
