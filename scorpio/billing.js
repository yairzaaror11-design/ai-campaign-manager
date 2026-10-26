"use strict";
const crypto = require("node:crypto"),
  axios = require("axios");
const {
  db,
  randomUUID,
  fail,
  text,
  integer,
  fields,
  audit,
} = require("./common");
function config() {
  const key = process.env.SCORPIO_STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_test_"))
    throw fail("BILLING_SANDBOX_NOT_CONFIGURED", 503);
  return key;
}
async function stripe(method, path, data) {
  return (
    await axios({
      method,
      url: "https://api.stripe.com/v1/" + path,
      headers: {
        Authorization: "Bearer " + config(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: data ? new URLSearchParams(data) : undefined,
      timeout: 15000,
      maxRedirects: 0,
      maxContentLength: 1048576,
    })
  ).data;
}
function admin(actorHash) {
  return (process.env.SCORPIO_BILLING_ADMINS || "")
    .split(",")
    .includes(actorHash);
}
async function catalog() {
  return (
    await db.query(
      "SELECT id,name,currency,amount,interval,credits,limits,revision FROM scorpio_plans WHERE active=TRUE ORDER BY amount,id",
    )
  ).rows;
}
async function plan(input, actorHash) {
  if (!admin(actorHash)) throw fail("BILLING_ADMIN_REQUIRED", 403);
  fields(input, [
    "name",
    "currency",
    "amount",
    "interval",
    "credits",
    "limits",
  ]);
  const name = text(input.name, 120, true),
    currency = text(input.currency, 3, true);
  if (
    !/^[a-z]{3}$/.test(currency) ||
    !["month", "year"].includes(input.interval)
  )
    throw fail("INVALID_PLAN");
  integer(input.amount, 1, 100000000);
  integer(input.credits, 0, 10000000);
  fields(input.limits || {}, ["users", "brands", "aiActions"]);
  for (const v of Object.values(input.limits || {})) integer(v, 1, 10000000);
  const id = randomUUID();
  await db.query(
    "INSERT INTO scorpio_plans(id,name,currency,amount,interval,credits,limits) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
    [
      id,
      name,
      currency,
      input.amount,
      input.interval,
      input.credits,
      JSON.stringify(input.limits || {}),
    ],
  );
  return { id };
}
async function state(id) {
  const [credits, subscriptions, ledger] = await Promise.all([
    db.query(
      "SELECT COALESCE(sum(delta),0)::int AS balance FROM scorpio_credits WHERE client_id=$1",
      [id],
    ),
    db.query(
      "SELECT id,plan_snapshot,status,created_at FROM scorpio_subscriptions WHERE client_id=$1 ORDER BY created_at DESC LIMIT 50",
      [id],
    ),
    db.query(
      "SELECT delta,reason,created_at FROM scorpio_credits WHERE client_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
      [id],
    ),
  ]);
  let configured = false;
  try {
    config();
    configured = true;
  } catch {}
  return {
    sandbox: true,
    configured,
    balance: credits.rows[0].balance,
    subscriptions: subscriptions.rows,
    ledger: ledger.rows,
  };
}
async function checkout(id, planId, confirmed) {
  if (confirmed !== true) throw fail("EXPLICIT_CONFIRMATION_REQUIRED");
  config();
  let origin;
  try {
    origin = new URL(process.env.APP_PUBLIC_URL);
  } catch {
    throw fail("PUBLIC_ORIGIN_REQUIRED", 503);
  }
  if (origin.protocol !== "https:") throw fail("PUBLIC_ORIGIN_REQUIRED", 503);
  const p = (
    await db.query("SELECT * FROM scorpio_plans WHERE id=$1 AND active=TRUE", [
      planId,
    ])
  ).rows[0];
  if (!p) throw fail("PLAN_NOT_FOUND", 404);
  const key = randomUUID();
  await db.transaction(async (tx) => {
    await tx("SELECT id FROM clients WHERE id=$1 FOR UPDATE", [id]);
    const pending = await tx(
      "SELECT id FROM scorpio_subscriptions WHERE client_id=$1 AND status IN ('PENDING','ACTIVE','CANCEL_PENDING','CHECKOUT_UNCERTAIN') LIMIT 1",
      [id],
    );
    if (pending.rows.length) throw fail("SUBSCRIPTION_EXISTS", 409);
    await tx(
      "INSERT INTO scorpio_subscriptions(id,client_id,plan_id,plan_snapshot) VALUES($1,$2,$3,$4::jsonb)",
      [key, id, p.id, JSON.stringify(p)],
    );
  });
  try {
    const data = await stripe("POST", "checkout/sessions", {
      mode: "subscription",
      success_url: origin.origin + "/app/modules/#billing",
      cancel_url: origin.origin + "/app/modules/#billing",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": p.currency,
      "line_items[0][price_data][unit_amount]": String(p.amount),
      "line_items[0][price_data][recurring][interval]": p.interval,
      "line_items[0][price_data][product_data][name]": p.name,
      "subscription_data[metadata][scorpio_subscription_id]": key,
      "metadata[scorpio_subscription_id]": key,
    });
    let url;
    try {
      url = new URL(data.url);
    } catch {
      throw fail("INVALID_CHECKOUT", 502);
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "checkout.stripe.com" ||
      !data.id
    )
      throw fail("INVALID_CHECKOUT", 502);
    await db.query(
      "UPDATE scorpio_subscriptions SET checkout_id=$2 WHERE id=$1",
      [key, data.id],
    );
    await audit(db.query, id, "SANDBOX_CHECKOUT_CREATED", key);
    return { url: url.href, sandbox: true };
  } catch (e) {
    await db.query(
      "UPDATE scorpio_subscriptions SET status='CHECKOUT_UNCERTAIN' WHERE id=$1",
      [key],
    );
    throw e.status ? e : fail("CHECKOUT_UNAVAILABLE", 502);
  }
}
function verify(raw, signature) {
  const secret = process.env.SCORPIO_STRIPE_WEBHOOK_SECRET;
  if (!secret) throw fail("BILLING_WEBHOOK_NOT_CONFIGURED", 503);
  if (
    !Buffer.isBuffer(raw) ||
    raw.length > 1048576 ||
    typeof signature !== "string"
  )
    throw fail("INVALID_SIGNATURE", 400);
  const values = signature.split(",").map((p) => p.split("=")),
    stamp = values.find((p) => p[0] === "t")?.[1],
    sigs = values.filter((p) => p[0] === "v1").map((p) => p[1]);
  if (
    !/^\d+$/.test(stamp || "") ||
    Math.abs(Date.now() / 1000 - Number(stamp)) > 300
  )
    throw fail("INVALID_SIGNATURE");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(stamp + ".")
    .update(raw)
    .digest();
  if (
    !sigs.some(
      (s) =>
        /^[a-f0-9]{64}$/.test(s) &&
        crypto.timingSafeEqual(expected, Buffer.from(s, "hex")),
    )
  )
    throw fail("INVALID_SIGNATURE");
  let event;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    throw fail("INVALID_EVENT");
  }
  if (event.livemode !== false) throw fail("LIVE_PAYMENTS_DISABLED", 403);
  return event;
}
async function webhook(raw, signature) {
  const e = verify(raw, signature);
  if (typeof e.id !== "string" || !e.data?.object) throw fail("INVALID_EVENT");
  if (
    ![
      "invoice.paid",
      "customer.subscription.deleted",
      "checkout.session.completed",
    ].includes(e.type)
  )
    return { ignored: true };
  const o = e.data.object;
  let sub;
  if (e.type === "invoice.paid") {
    const providerId =
      typeof o.subscription === "string"
        ? o.subscription
        : o.parent?.subscription_details?.subscription;
    if (!providerId) throw fail("INVOICE_SUBSCRIPTION_REQUIRED");
    sub = await stripe(
      "GET",
      "subscriptions/" + encodeURIComponent(providerId),
    );
  } else if (e.type === "checkout.session.completed") {
    if (!o.subscription || o.mode !== "subscription") return { ignored: true };
    sub = await stripe(
      "GET",
      "subscriptions/" + encodeURIComponent(o.subscription),
    );
  } else sub = o;
  const key = sub.metadata?.scorpio_subscription_id;
  if (typeof key !== "string") return { ignored: true };
  return db.transaction(async (tx) => {
    const row = (
      await tx("SELECT * FROM scorpio_subscriptions WHERE id=$1 FOR UPDATE", [
        key,
      ])
    ).rows[0];
    if (!row) return { ignored: true };
    if (row.provider_id && row.provider_id !== sub.id)
      throw fail("SUBSCRIPTION_MISMATCH");
    const inserted = await tx(
      "INSERT INTO scorpio_billing_events(event_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING event_id",
      [e.id],
    );
    if (!inserted.rows.length) return { duplicate: true };
    if (e.type === "invoice.paid") {
      if (
        o.status !== "paid" ||
        o.amount_paid !== row.plan_snapshot.amount ||
        o.currency !== row.plan_snapshot.currency
      )
        throw fail("INVOICE_AMOUNT_MISMATCH");
      await tx(
        "INSERT INTO scorpio_credits(id,client_id,delta,reason,external_id) VALUES($1,$2,$3,'SANDBOX_INVOICE',$4) ON CONFLICT(external_id) DO NOTHING",
        [
          randomUUID(),
          row.client_id,
          row.plan_snapshot.credits,
          "stripe-invoice:" + o.id,
        ],
      );
      await tx(
        "UPDATE scorpio_subscriptions SET status='ACTIVE',provider_id=$2 WHERE id=$1",
        [key, sub.id],
      );
    } else if (e.type === "customer.subscription.deleted")
      await tx(
        "UPDATE scorpio_subscriptions SET status='CANCELLED' WHERE id=$1",
        [key],
      );
    else
      await tx("UPDATE scorpio_subscriptions SET provider_id=$2 WHERE id=$1", [
        key,
        sub.id,
      ]);
    await audit(tx, row.client_id, "SANDBOX_BILLING_EVENT", e.type);
    return { received: true };
  });
}
async function cancel(id, key, confirmed) {
  if (confirmed !== true) throw fail("EXPLICIT_CONFIRMATION_REQUIRED");
  const row = (
    await db.query(
      "SELECT provider_id FROM scorpio_subscriptions WHERE client_id=$1 AND id=$2",
      [id, key],
    )
  ).rows[0];
  if (!row?.provider_id) throw fail("SUBSCRIPTION_NOT_FOUND", 404);
  await stripe("POST", "subscriptions/" + encodeURIComponent(row.provider_id), {
    cancel_at_period_end: "true",
  });
  await db.query(
    "UPDATE scorpio_subscriptions SET status='CANCEL_PENDING' WHERE client_id=$1 AND id=$2",
    [id, key],
  );
  await audit(db.query, id, "SANDBOX_SUBSCRIPTION_CANCEL_REQUESTED", key);
  return { status: "CANCEL_PENDING" };
}
module.exports = {
  catalog,
  plan,
  state,
  checkout,
  verify,
  webhook,
  cancel,
  admin,
};
