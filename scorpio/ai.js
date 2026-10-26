"use strict";
const crypto = require("node:crypto");
const { db, randomUUID, fail, text, uuid, audit } = require("./common");
const providers = new Map(),
  overrides = new Set();
providers.set("text", async (prompt) => {
  const model = process.env.GEMINI_MODEL;
  if (!process.env.GEMINI_API_KEY || !/^gemini-[a-z0-9.-]+$/.test(model || ""))
    throw fail("AI_PROVIDER_NOT_CONFIGURED", 503);
  const response = (
    await require("axios").post(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        model +
        ":generateContent",
      {
        systemInstruction: {
          parts: [
            {
              text: "Write Hebrew marketing copy from the user brief. Return only the requested copy. Do not claim real campaign results, invent endorsements or perform any external action.",
            },
          ],
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2048 },
      },
      {
        headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
        timeout: 90000,
        maxRedirects: 0,
        maxContentLength: 1048576,
      },
    )
  ).data;
  return {
    text: (response.candidates?.[0]?.content?.parts || [])
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("\n"),
  };
});
function register(kind, provider) {
  if (
    !["image", "text", "video"].includes(kind) ||
    typeof provider !== "function"
  )
    throw fail("INVALID_PROVIDER");
  providers.set(kind, provider);
  overrides.add(kind);
}
async function generate(id, input) {
  if (process.env.SCORPIO_AI_ENABLED !== "true") throw fail("AI_DISABLED", 503);
  if (input.confirmCost !== true) throw fail("EXPLICIT_CONFIRMATION_REQUIRED");
  const kind = input.kind;
  if (!["image", "text", "video"].includes(kind)) throw fail("INVALID_KIND");
  const prompt = text(input.prompt, 2000, true),
    key = uuid(input.idempotencyKey),
    digest = crypto
      .createHash("sha256")
      .update(JSON.stringify({ kind, prompt }))
      .digest("hex");
  const provider =
    providers.get(kind) ||
    (kind === "image"
      ? async (p) => require("../graphicService").generate(p)
      : null);
  if (!provider) throw fail("AI_PROVIDER_NOT_CONFIGURED", 503);
  if (!overrides.has(kind)) {
    const model =
      kind === "image"
        ? process.env.GEMINI_IMAGE_MODEL
        : process.env.GEMINI_MODEL;
    if (
      !process.env.GEMINI_API_KEY ||
      !/^gemini-[a-z0-9.-]+$/.test(model || "")
    )
      throw fail("AI_PROVIDER_NOT_CONFIGURED", 503);
  }
  const previous = (
    await db.query(
      "SELECT * FROM scorpio_ai_jobs WHERE id=$1 AND client_id=$2",
      [key, id],
    )
  ).rows[0];
  if (previous) {
    if (previous.request_hash !== digest)
      throw fail("IDEMPOTENCY_CONFLICT", 409);
    return publicJob(previous);
  }
  await db.transaction(async (tx) => {
    await tx("SELECT id FROM clients WHERE id=$1 FOR UPDATE", [id]);
    const balance = (
      await tx(
        "SELECT COALESCE(sum(delta),0)::int AS n FROM scorpio_credits WHERE client_id=$1",
        [id],
      )
    ).rows[0].n;
    if (balance < 1) throw fail("INSUFFICIENT_CREDITS", 409);
    const claim = await tx(
      "INSERT INTO scorpio_ai_jobs(id,client_id,kind,status,request_hash) VALUES($1,$2,$3,'PROCESSING',$4) ON CONFLICT DO NOTHING RETURNING id",
      [key, id, kind, digest],
    );
    if (!claim.rows.length) throw fail("JOB_ALREADY_CLAIMED", 409);
    await tx(
      "INSERT INTO scorpio_credits(id,client_id,delta,reason,external_id) VALUES($1,$2,-1,'AI_RESERVATION',$3)",
      [randomUUID(), id, "ai:" + key],
    );
  });
  try {
    const result = await provider(prompt);
    let assetId = null,
      output = null;
    if (kind === "text") output = text(result.text, 16000, true);
    else {
      if (!result.buffer || !result.mimeType) throw fail("INVALID_AI_OUTPUT");
      assetId = (
        await require("./media").upload(id, result.buffer, result.mimeType, {
          name: prompt.slice(0, 100),
        })
      ).id;
    }
    await db.query(
      "UPDATE scorpio_ai_jobs SET status='COMPLETE',asset_id=$3,output=$4 WHERE id=$1 AND client_id=$2",
      [key, id, assetId, output],
    );
    await audit(db.query, id, "AI_JOB_COMPLETED", key);
  } catch {
    await db.query(
      "UPDATE scorpio_ai_jobs SET status='FAILED',error_code='PROVIDER_RESULT_UNCERTAIN' WHERE id=$1 AND client_id=$2",
      [key, id],
    ); /* Reservation retained: external provider may have billed. Never auto-repeat. */
  }
  return publicJob(
    (
      await db.query(
        "SELECT * FROM scorpio_ai_jobs WHERE id=$1 AND client_id=$2",
        [key, id],
      )
    ).rows[0],
  );
}
function publicJob(row) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    assetId: row.asset_id || null,
    output: row.output || null,
    error: row.error_code || null,
  };
}
module.exports = { register, generate };
