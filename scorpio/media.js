"use strict";
const {
  db,
  randomUUID,
  fail,
  text,
  uuid,
  object,
  audit,
  owned,
  page,
} = require("./common");
const maxBytes = 20 * 1024 * 1024,
  quota = 200 * 1024 * 1024;
async function upload(id, buffer, mime, input = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > maxBytes)
    throw fail("INVALID_FILE");
  let bytes = buffer,
    actual = mime;
  if (["image/png", "image/jpeg", "image/webp"].includes(mime)) {
    try {
      bytes = await require("sharp")(buffer, {
        limitInputPixels: 16777216,
        failOn: "warning",
      })
        .rotate()
        .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
      actual = "image/png";
    } catch {
      throw fail("INVALID_IMAGE");
    }
  } else if (mime === "video/mp4") {
    if (buffer.length < 12 || buffer.toString("ascii", 4, 8) !== "ftyp")
      throw fail("INVALID_VIDEO");
  } else if (mime === "video/webm") {
    if (buffer.subarray(0, 4).toString("hex") !== "1a45dfa3")
      throw fail("INVALID_VIDEO");
  } else throw fail("UNSUPPORTED_MEDIA");
  const name = text(input.name || "מדיה", 200, true),
    payload = { brand: text(input.brand || "", 120) },
    key = randomUUID();
  return db.transaction(async (tx) => {
    await tx("SELECT id FROM clients WHERE id=$1 FOR UPDATE", [id]);
    if (input.folderId) {
      const folder = await owned(tx, "scorpio_records", input.folderId, id);
      if (folder.kind !== "folder") throw fail("INVALID_FOLDER");
    }
    const size = await tx(
      "SELECT COALESCE(sum(octet_length(bytes)),0) AS size FROM scorpio_assets WHERE client_id=$1",
      [id],
    );
    if (Number(size.rows[0].size) + bytes.length > quota)
      throw fail("STORAGE_LIMIT", 409);
    await tx(
      "INSERT INTO scorpio_assets(id,client_id,name,mime,bytes,folder_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
      [
        key,
        id,
        name,
        actual,
        bytes,
        input.folderId || null,
        JSON.stringify(payload),
      ],
    );
    await audit(tx, id, "ASSET_UPLOADED", key);
    return { id: key, mime: actual };
  });
}
async function list(id, q) {
  const params = [id],
    where = ["client_id=$1"];
  if (q.q) {
    params.push("%" + text(q.q, 120) + "%");
    where.push(`name ILIKE $${params.length}`);
  }
  if (q.folder) {
    params.push(uuid(q.folder));
    where.push(`folder_id=$${params.length}`);
  }
  params.push(page(q));
  const r = await db.query(
    `SELECT id,name,mime,folder_id,payload,octet_length(bytes) AS size,created_at FROM scorpio_assets WHERE ${where.join(" AND ")} ORDER BY created_at DESC,id LIMIT 51 OFFSET $${params.length}`,
    params,
  );
  return { items: r.rows.slice(0, 50), hasMore: r.rows.length > 50 };
}
async function load(id, key) {
  const r = await db.query(
    "SELECT name,mime,bytes FROM scorpio_assets WHERE client_id=$1 AND id=$2",
    [id, uuid(key)],
  );
  if (!r.rows.length) throw fail("NOT_FOUND", 404);
  return r.rows[0];
}
async function remove(id, key) {
  return db.transaction(async (tx) => {
    await owned(tx, "scorpio_assets", key, id);
    const references = await tx(
      "SELECT id FROM scorpio_records WHERE client_id=$1 AND payload->'assetIds' @> $2::jsonb LIMIT 1",
      [id, JSON.stringify([key])],
    );
    if (references.rows.length) throw fail("ASSET_IN_USE", 409);
    await tx("DELETE FROM scorpio_assets WHERE client_id=$1 AND id=$2", [
      id,
      key,
    ]);
    await audit(tx, id, "ASSET_DELETED", key);
  });
}
async function rename(id, key, name) {
  return db.transaction(async (tx) => {
    await owned(tx, "scorpio_assets", key, id);
    await tx("UPDATE scorpio_assets SET name=$3 WHERE client_id=$1 AND id=$2", [
      id,
      key,
      text(name, 200, true),
    ]);
    await audit(tx, id, "ASSET_RENAMED", key);
  });
}
module.exports = { upload, list, load, remove, rename };
