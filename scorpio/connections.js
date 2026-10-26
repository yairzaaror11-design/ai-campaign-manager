"use strict";
const axios = require("axios"),
  crypto = require("node:crypto");
const { db, fail, text, uuid, audit } = require("./common"),
  meta = require("../metaConnection"),
  social = require("../socialConnections");
const google = ["google_ads", "analytics", "business_profile"];
const extra = {
  google_ads: {
    name: "Google Ads",
    scope: "https://www.googleapis.com/auth/adwords",
  },
  analytics: {
    name: "Google Analytics 4",
    scope: "https://www.googleapis.com/auth/analytics.readonly",
  },
  business_profile: {
    name: "Google Business Profile",
    scope: "https://www.googleapis.com/auth/business.manage",
  },
  pinterest: {
    name: "Pinterest",
    scope: "user_accounts:read,pins:read,boards:read",
  },
  shopify: { name: "Shopify", scope: "read_products,read_orders" },
  wordpress: { name: "WordPress" },
  woocommerce: { name: "WooCommerce" },
};
const request = async (method, url, options = {}) =>
  (
    await axios({
      method,
      url,
      timeout: 15000,
      maxRedirects: 0,
      maxContentLength: 2 * 1024 * 1024,
      ...options,
    })
  ).data;
function config(provider) {
  if (
    !Object.hasOwn(extra, provider) ||
    ["wordpress", "woocommerce"].includes(provider)
  )
    throw fail("INVALID_PROVIDER");
  const prefix = google.includes(provider) ? "GOOGLE" : provider.toUpperCase();
  const id = process.env["SCORPIO_" + prefix + "_CLIENT_ID"],
    secret = process.env["SCORPIO_" + prefix + "_CLIENT_SECRET"];
  let origin;
  try {
    origin = new URL(process.env.APP_PUBLIC_URL);
  } catch {
    throw fail("PROVIDER_NOT_CONFIGURED", 503);
  }
  if (
    !id ||
    !secret ||
    origin.protocol !== "https:" ||
    origin.pathname !== "/" ||
    origin.username ||
    origin.password ||
    origin.hash ||
    origin.search ||
    origin.origin !==
      new URL(process.env.DASHBOARD_ORIGIN || origin.origin).origin ||
    Buffer.from(process.env.META_TOKEN_ENCRYPTION_KEY || "", "base64")
      .length !== 32
  )
    throw fail("PROVIDER_NOT_CONFIGURED", 503);
  return {
    id,
    secret,
    redirect: origin.origin + "/app/modules/oauth/callback/" + provider,
  };
}
function available(p) {
  try {
    config(p);
    return true;
  } catch {
    return false;
  }
}
function shop(value) {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9][a-z0-9-]{1,60}\.myshopify\.com$/.test(value)
  )
    throw fail("INVALID_SHOP");
  return value;
}
async function throttle(id, name) {
  const r = await db.query(
    `INSERT INTO api_rate_limits(bucket,attempts,expires_at) VALUES($1,1,NOW()+INTERVAL '1 minute') ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN api_rate_limits.expires_at<NOW() THEN 1 ELSE api_rate_limits.attempts+1 END,expires_at=CASE WHEN api_rate_limits.expires_at<NOW() THEN NOW()+INTERVAL '1 minute' ELSE api_rate_limits.expires_at END RETURNING attempts`,
    ["scorpio:" + name + ":" + id],
  );
  if (r.rows[0].attempts > 5) throw fail("RATE_LIMITED", 429);
}
async function list(id) {
  const [existing, own] = await Promise.all([
    social.list(id),
    db.query(
      "SELECT provider,app_id,account_id,accounts,expires_at,last_sync_at,error_code,credentials IS NOT NULL AS authorized FROM scorpio_connections WHERE client_id=$1",
      [id],
    ),
  ]);
  const m = await db.query(
    "SELECT c.meta_ad_account_id,m.expires_at,m.app_id FROM clients c LEFT JOIN meta_connections m ON m.client_id=c.id WHERE c.id=$1",
    [id],
  );
  return {
    items: [
      {
        id: "meta",
        name: "Meta Ads",
        status:
          m.rows[0]?.app_id === process.env.META_APP_ID &&
          new Date(m.rows[0]?.expires_at) > new Date()
            ? "connected"
            : "not_connected",
        accountId: m.rows[0]?.meta_ad_account_id || null,
      },
      ...existing.map((p) => ({
        ...p,
        status: !p.configured
          ? "requires_configuration"
          : p.selectionRequired
            ? "selection_required"
            : p.connected
              ? "connected"
              : p.expired
                ? "expired"
                : "not_connected",
      })),
      ...Object.entries(extra).map(([provider, p]) => {
        const r = own.rows.find((a) => a.provider === provider),
          configured = ["wordpress", "woocommerce"].includes(provider)
            ? !!process.env.SCORPIO_SITE_HOSTS
            : available(provider),
          valid = !!(
            configured &&
            r?.authorized &&
            (["wordpress", "woocommerce"].includes(provider) ||
              r.app_id === config(provider).id) &&
            (!r.expires_at || new Date(r.expires_at) > new Date())
          );
        return {
          id: provider,
          name: p.name,
          configured,
          status: !configured
            ? "requires_configuration"
            : r?.error_code
              ? "sync_error"
              : valid
                ? r.account_id
                  ? "connected"
                  : "selection_required"
                : r?.authorized
                  ? "expired"
                  : "not_connected",
          accountId: r?.account_id || null,
          accounts: r?.accounts || [],
          expiresAt: r?.expires_at || null,
          lastSyncedAt: r?.last_sync_at || null,
          error: r?.error_code || null,
        };
      }),
    ],
  };
}
async function begin(id, provider, actorHash, options = {}) {
  const p = config(provider);
  await throttle(id, "oauth");
  const state = crypto.randomBytes(32).toString("base64url"),
    binding = crypto.randomBytes(32).toString("base64url"),
    verifier = crypto.randomBytes(32).toString("base64url");
  const host = provider === "shopify" ? shop(options.shop) : null;
  const params = new URLSearchParams({
    client_id: p.id,
    redirect_uri: p.redirect,
    response_type: "code",
    scope: extra[provider].scope,
    state,
  });
  let url;
  if (google.includes(provider)) {
    url = "https://accounts.google.com/o/oauth2/v2/auth";
    params.set("access_type", "offline");
    params.set("prompt", "consent");
    params.set("code_challenge_method", "S256");
    params.set(
      "code_challenge",
      crypto.createHash("sha256").update(verifier).digest("base64url"),
    );
  } else if (provider === "pinterest") url = "https://www.pinterest.com/oauth/";
  else url = "https://" + host + "/admin/oauth/authorize";
  await db.transaction(async (tx) => {
    await tx("SELECT id FROM clients WHERE id=$1 FOR UPDATE", [id]);
    await tx("DELETE FROM scorpio_oauth WHERE expires_at<NOW()");
    const row = await tx(
      "INSERT INTO scorpio_connections(client_id,provider,app_id) VALUES($1,$2,$3) ON CONFLICT(client_id,provider) DO UPDATE SET generation=scorpio_connections.generation RETURNING generation",
      [id, provider, p.id],
    );
    await tx(
      "INSERT INTO scorpio_oauth(state_hash,client_id,provider,binding_hash,actor_hash,app_id,generation,verifier,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()+INTERVAL '10 minutes')",
      [
        meta.hash(state),
        id,
        provider,
        meta.hash(binding),
        actorHash,
        p.id,
        row.rows[0].generation,
        meta.encrypt(
          JSON.stringify({ verifier, shop: host }),
          id + ":scorpio:" + provider,
        ),
      ],
    );
  });
  return { url: url + "?" + params, binding };
}
function adsVersion() {
  const v = process.env.SCORPIO_GOOGLE_ADS_VERSION;
  if (!/^v\d{2}$/.test(v || "")) throw fail("ADS_API_VERSION_REQUIRED", 503);
  return v;
}
function shopVersion() {
  const v = process.env.SCORPIO_SHOPIFY_VERSION;
  if (!/^20\d\d-(01|04|07|10)$/.test(v || ""))
    throw fail("SHOPIFY_API_VERSION_REQUIRED", 503);
  return v;
}
async function accounts(provider, token, context = {}) {
  const headers = { Authorization: "Bearer " + token };
  if (provider === "google_ads") {
    const developer = process.env.SCORPIO_GOOGLE_ADS_DEVELOPER_TOKEN;
    if (!developer) throw fail("ADS_DEVELOPER_TOKEN_REQUIRED", 503);
    const d = await request(
      "GET",
      "https://googleads.googleapis.com/" +
        adsVersion() +
        "/customers:listAccessibleCustomers",
      { headers: { ...headers, "developer-token": developer } },
    );
    return (d.resourceNames || []).map((r) => ({
      id: r.split("/")[1],
      name: r,
    }));
  }
  if (provider === "analytics") {
    const d = await request(
      "GET",
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
      { headers, params: { pageSize: 200 } },
    );
    if (d.nextPageToken) throw fail("ACCOUNT_PAGINATION_REQUIRED", 409);
    return (d.accountSummaries || []).flatMap((a) =>
      (a.propertySummaries || []).map((p) => ({
        id: p.property,
        name: p.displayName || p.property,
      })),
    );
  }
  if (provider === "business_profile") {
    const d = await request(
      "GET",
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
      { headers },
    );
    if (d.nextPageToken) throw fail("ACCOUNT_PAGINATION_REQUIRED", 409);
    return (d.accounts || []).map((a) => ({
      id: a.name,
      name: a.accountName || a.name,
    }));
  }
  if (provider === "pinterest") {
    const d = await request(
      "GET",
      "https://api.pinterest.com/v5/user_account",
      { headers },
    );
    if (!d.username) throw fail("IDENTITY_REQUIRED");
    return [{ id: d.username, name: d.username }];
  }
  return [{ id: shop(context.shop), name: context.shop }];
}
function verifyShopHmac(query, secret) {
  const signature = query.hmac;
  if (
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    Object.values(query).some((v) => typeof v !== "string")
  )
    throw fail("INVALID_SHOPIFY_SIGNATURE");
  const message = Object.keys(query)
    .filter((k) => k !== "hmac" && k !== "signature")
    .sort()
    .map((k) => k + "=" + query[k])
    .join("&");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)))
    throw fail("INVALID_SHOPIFY_SIGNATURE");
}
async function callback(provider, query, binding) {
  const p = config(provider);
  if (
    !/^[\w-]{43}$/.test(query.state || "") ||
    !/^[\w-]{43}$/.test(binding || "")
  )
    throw fail("INVALID_OAUTH_STATE");
  const result = await db.query(
    "DELETE FROM scorpio_oauth WHERE state_hash=$1 AND provider=$2 AND binding_hash=$3 AND app_id=$4 AND expires_at>NOW() RETURNING *",
    [meta.hash(query.state), provider, meta.hash(binding), p.id],
  );
  const s = result.rows[0];
  if (!s) throw fail("INVALID_OAUTH_STATE");
  if (
    !require("../dashboardAuth")
      .accounts()
      .some(
        (a) =>
          String(a.clientId) === String(s.client_id) &&
          a.role === "owner" &&
          a.tokenHash === s.actor_hash,
      )
  )
    throw fail("OWNERSHIP_CHANGED", 403);
  if (query.error) throw fail("CONSENT_DENIED");
  const code = text(query.code, 4096, true),
    context = JSON.parse(
      meta.decrypt(s.verifier, s.client_id + ":scorpio:" + provider),
    );
  let data;
  if (provider === "shopify") {
    verifyShopHmac(query, p.secret);
    if (shop(query.shop) !== context.shop) throw fail("SHOP_MISMATCH");
    data = await request(
      "POST",
      "https://" + context.shop + "/admin/oauth/access_token",
      { data: { client_id: p.id, client_secret: p.secret, code } },
    );
  } else {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: p.redirect,
    });
    let headers = { "Content-Type": "application/x-www-form-urlencoded" },
      url;
    if (google.includes(provider)) {
      url = "https://oauth2.googleapis.com/token";
      body.set("client_id", p.id);
      body.set("client_secret", p.secret);
      body.set("code_verifier", context.verifier);
    } else {
      url = "https://api.pinterest.com/v5/oauth/token";
      headers.Authorization =
        "Basic " + Buffer.from(p.id + ":" + p.secret).toString("base64");
    }
    data = await request("POST", url, { headers, data: body });
  }
  if (
    typeof data.access_token !== "string" ||
    !data.access_token ||
    data.access_token.length > 16384 ||
    (!data.expires_in && provider !== "shopify")
  )
    throw fail("INVALID_PROVIDER_TOKEN");
  const candidates = await accounts(provider, data.access_token, context);
  if (
    !candidates.length ||
    candidates.length > 200 ||
    candidates.some((a) => typeof a.id !== "string" || a.id.length > 300)
  )
    throw fail("ACCOUNT_REQUIRED");
  const cipher = meta.encrypt(
    JSON.stringify({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      shop: context.shop,
    }),
    s.client_id + ":scorpio:" + provider,
  );
  if (
    data.expires_in !== undefined &&
    (!Number.isFinite(Number(data.expires_in)) ||
      Number(data.expires_in) <= 0 ||
      Number(data.expires_in) > 315360000)
  )
    throw fail("INVALID_PROVIDER_TOKEN");
  const expires = data.expires_in
    ? new Date(Date.now() + Number(data.expires_in) * 1000)
    : null;
  if (expires && !Number.isFinite(expires.getTime()))
    throw fail("INVALID_PROVIDER_TOKEN");
  await db.transaction(async (tx) => {
    const r = await tx(
      "UPDATE scorpio_connections SET app_id=$3,credentials=$4,accounts=$5::jsonb,account_id=$6,expires_at=$7,generation=generation+1,error_code=NULL WHERE client_id=$1 AND provider=$2 AND generation=$8 RETURNING client_id",
      [
        s.client_id,
        provider,
        p.id,
        cipher,
        JSON.stringify(candidates),
        candidates.length === 1 ? candidates[0].id : null,
        expires,
        s.generation,
      ],
    );
    if (!r.rows.length) throw fail("CONNECTION_CHANGED", 409);
    await audit(tx, s.client_id, "CONNECTION_AUTHORIZED", provider);
  });
}
async function select(id, provider, accountId) {
  if (!Object.hasOwn(extra, provider)) throw fail("INVALID_PROVIDER");
  text(accountId, 300, true);
  return db.transaction(async (tx) => {
    const r = await tx(
      "SELECT accounts FROM scorpio_connections WHERE client_id=$1 AND provider=$2 AND credentials IS NOT NULL FOR UPDATE",
      [id, provider],
    );
    if (!r.rows[0]?.accounts.some((a) => a.id === accountId))
      throw fail("INVALID_ACCOUNT");
    await tx(
      "UPDATE scorpio_connections SET account_id=$3,snapshot=NULL,last_sync_at=NULL WHERE client_id=$1 AND provider=$2",
      [id, provider, accountId],
    );
    await audit(tx, id, "CONNECTION_ACCOUNT_SELECTED", provider);
  });
}
async function disconnect(id, provider) {
  if (Object.hasOwn(social.providers, provider))
    return social.disconnect(id, provider);
  if (provider === "meta") return meta.disconnect(id);
  if (!Object.hasOwn(extra, provider)) throw fail("INVALID_PROVIDER");
  return db.transaction(async (tx) => {
    await tx(
      "UPDATE scorpio_connections SET credentials=NULL,accounts='[]'::jsonb,account_id=NULL,snapshot=NULL,last_sync_at=NULL,error_code=NULL,expires_at=NULL,generation=generation+1 WHERE client_id=$1 AND provider=$2",
      [id, provider],
    );
    await tx("DELETE FROM scorpio_oauth WHERE client_id=$1 AND provider=$2", [
      id,
      provider,
    ]);
    await audit(tx, id, "CONNECTION_DISCONNECTED", provider);
  });
}
async function credentials(id, provider) {
  const r = await db.query(
    "SELECT * FROM scorpio_connections WHERE client_id=$1 AND provider=$2",
    [id, provider],
  );
  const c = r.rows[0];
  if (!c?.credentials) throw fail("CONNECTION_REQUIRED", 409);
  if (
    !["wordpress", "woocommerce"].includes(provider) &&
    c.app_id !== config(provider).id
  )
    throw fail("RECONNECT_REQUIRED", 409);
  if (c.expires_at && new Date(c.expires_at) <= new Date())
    throw fail("CONNECTION_EXPIRED", 409);
  if (!c.account_id) throw fail("ACCOUNT_SELECTION_REQUIRED", 409);
  return {
    ...c,
    ...JSON.parse(meta.decrypt(c.credentials, id + ":scorpio:" + provider)),
  };
}
function siteURL(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw fail("INVALID_SITE");
  }
  const hosts = (process.env.SCORPIO_SITE_HOSTS || "")
    .split(",")
    .map((v) => v.trim());
  if (
    u.protocol !== "https:" ||
    u.port ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    !hosts.includes(u.hostname) ||
    u.hostname === "localhost" ||
    /^\d+(\.\d+){3}$/.test(u.hostname)
  )
    throw fail("SITE_NOT_ALLOWLISTED", 403);
  return u.origin;
}
async function connectSite(id, provider, input) {
  if (!["wordpress", "woocommerce"].includes(provider))
    throw fail("INVALID_PROVIDER");
  await throttle(id, "site");
  const origin = siteURL(input.site);
  const username = text(input.username, 200, true),
    password = text(input.password, 300, true);
  const authorization =
    "Basic " + Buffer.from(username + ":" + password).toString("base64");
  const d = await request(
    "GET",
    origin +
      (provider === "wordpress"
        ? "/wp-json/wp/v2/users/me"
        : "/wp-json/wc/v3/products?per_page=1"),
    { headers: { Authorization: authorization } },
  );
  if (provider === "wordpress" && !d.id) throw fail("SITE_AUTH_FAILED");
  if (provider === "woocommerce" && !Array.isArray(d))
    throw fail("SITE_AUTH_FAILED");
  const cipher = meta.encrypt(
    JSON.stringify({ origin, username, password }),
    id + ":scorpio:" + provider,
  );
  await db.transaction(async (tx) => {
    await tx(
      "INSERT INTO scorpio_connections(client_id,provider,app_id,credentials,accounts,account_id) VALUES($1,$2,$3,$4,$5::jsonb,$3) ON CONFLICT(client_id,provider) DO UPDATE SET app_id=$3,credentials=$4,accounts=$5::jsonb,account_id=$3,generation=scorpio_connections.generation+1,error_code=NULL",
      [
        id,
        provider,
        origin,
        cipher,
        JSON.stringify([{ id: origin, name: origin }]),
      ],
    );
    await audit(tx, id, "SITE_CONNECTED", provider);
  });
}
async function readSocial(id, provider) {
  const p = social.config(provider);
  const r = await db.query(
      "SELECT * FROM social_connections WHERE client_id=$1 AND provider=$2",
      [id, provider],
    ),
    c = r.rows[0];
  if (
    !c?.external_id ||
    c.app_id !== p.id ||
    !c.token_ciphertext ||
    new Date(c.expires_at) <= new Date()
  )
    throw fail("RECONNECT_REQUIRED", 409);
  const { accessToken } = JSON.parse(
      meta.decrypt(c.token_ciphertext, id + ":" + provider),
    ),
    headers = { Authorization: "Bearer " + accessToken };
  if (provider === "facebook")
    return request(
      "GET",
      "https://graph.facebook.com/v26.0/" +
        encodeURIComponent(c.external_id) +
        "/posts",
      { headers, params: { fields: "id,message,created_time", limit: 25 } },
    );
  if (provider === "instagram")
    return request(
      "GET",
      "https://graph.facebook.com/v26.0/" +
        encodeURIComponent(c.external_id) +
        "/media",
      {
        headers,
        params: {
          fields: "id,caption,media_type,permalink,timestamp",
          limit: 25,
        },
      },
    );
  if (provider === "youtube")
    return request("GET", "https://www.googleapis.com/youtube/v3/channels", {
      headers,
      params: { part: "snippet,statistics", id: c.external_id },
    });
  if (provider === "tiktok")
    return request("GET", "https://open.tiktokapis.com/v2/user/info/", {
      headers,
      params: { fields: "open_id,display_name" },
    });
  if (provider === "linkedin")
    return request("GET", "https://api.linkedin.com/v2/userinfo", { headers });
  return request("GET", "https://api.x.com/2/users/me", { headers });
}
// Provider pagination URLs can contain bearer credentials. Never return/store them.
function publicData(value, depth = 0) {
  if (depth > 20) throw fail("PROVIDER_RESPONSE_TOO_DEEP", 502);
  if (Array.isArray(value)) return value.map((v) => publicData(v, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/token|secret|password|authorization|credential|paging|bookmark/i.test(
              key,
            ),
        )
        .map(([k, v]) => [k, publicData(v, depth + 1)]),
    );
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      url.username = "";
      url.password = "";
      for (const key of [...url.searchParams.keys()])
        if (/token|secret|signature|password|key|auth/i.test(key))
          url.searchParams.delete(key);
      return url.href;
    } catch {
      return "[invalid URL]";
    }
  }
  return value;
}
async function sync(id, provider) {
  await throttle(id, "sync:" + provider);
  if (provider === "meta") {
    await meta.context.run(String(id), () =>
      require("../reportService").campaignReport(id, "last_30d"),
    );
    return { source: "meta", saved: true };
  }
  if (Object.hasOwn(social.providers, provider)) {
    const data = publicData(await readSocial(id, provider));
    await audit(db.query, id, "SOCIAL_READ", provider);
    return { source: provider, data };
  }
  if (!Object.hasOwn(extra, provider)) throw fail("INVALID_PROVIDER");
  const c = await credentials(id, provider),
    headers = { Authorization: "Bearer " + c.accessToken };
  let data;
  try {
    if (provider === "analytics") {
      if (!/^properties\/\d+$/.test(c.account_id))
        throw fail("INVALID_ACCOUNT");
      data = await request(
        "POST",
        "https://analyticsdata.googleapis.com/v1beta/" +
          c.account_id +
          ":runReport",
        {
          headers,
          data: {
            dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
            dimensions: [{ name: "sessionSourceMedium" }],
            metrics: [
              { name: "activeUsers" },
              { name: "sessions" },
              { name: "keyEvents" },
            ],
            limit: 100,
          },
        },
      );
    } else if (provider === "google_ads") {
      if (!/^\d+$/.test(c.account_id)) throw fail("INVALID_ACCOUNT");
      const manager = process.env.SCORPIO_GOOGLE_ADS_MANAGER_ID;
      if (manager && !/^\d+$/.test(manager)) throw fail("INVALID_MANAGER");
      data = await request(
        "POST",
        "https://googleads.googleapis.com/" +
          adsVersion() +
          "/customers/" +
          c.account_id +
          "/googleAds:search",
        {
          headers: {
            ...headers,
            "developer-token": process.env.SCORPIO_GOOGLE_ADS_DEVELOPER_TOKEN,
            ...(manager ? { "login-customer-id": manager } : {}),
          },
          data: {
            query:
              "SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_30_DAYS LIMIT 100",
          },
        },
      );
    } else if (provider === "business_profile") {
      if (!/^accounts\/\d+$/.test(c.account_id)) throw fail("INVALID_ACCOUNT");
      data = await request(
        "GET",
        "https://mybusinessbusinessinformation.googleapis.com/v1/" +
          c.account_id +
          "/locations",
        {
          headers,
          params: { readMask: "name,title,storefrontAddress", pageSize: 100 },
        },
      );
    } else if (provider === "pinterest")
      data = await request("GET", "https://api.pinterest.com/v5/pins", {
        headers,
        params: { page_size: 100 },
      });
    else if (provider === "shopify") {
      const host = shop(c.account_id);
      data = await request(
        "POST",
        "https://" + host + "/admin/api/" + shopVersion() + "/graphql.json",
        {
          headers: { "X-Shopify-Access-Token": c.accessToken },
          data: {
            query:
              "{ shop { name currencyCode } products(first: 25) { nodes { id title } pageInfo { hasNextPage endCursor } } orders(first: 25, sortKey: CREATED_AT, reverse: true) { nodes { id name createdAt totalPriceSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage endCursor } } }",
          },
        },
      );
      if (data.errors) throw fail("PROVIDER_PERMISSION_REQUIRED", 409);
    } else {
      const origin = siteURL(c.origin);
      data = await request(
        "GET",
        origin +
          (provider === "wordpress"
            ? "/wp-json/wp/v2/posts?per_page=25"
            : "/wp-json/wc/v3/orders?per_page=25"),
        {
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(c.username + ":" + c.password).toString("base64"),
          },
        },
      );
    }
    const snapshot = {
      data: publicData(data),
      partial: true,
      period:
        provider === "google_ads" || provider === "analytics"
          ? "last_30d"
          : null,
      fetchedAt: new Date().toISOString(),
    };
    await db.query(
      "UPDATE scorpio_connections SET snapshot=$3::jsonb,last_sync_at=NOW(),error_code=NULL WHERE client_id=$1 AND provider=$2 AND generation=$4",
      [id, provider, JSON.stringify(snapshot), c.generation],
    );
    await audit(db.query, id, "CONNECTION_SYNCED", provider);
    return snapshot;
  } catch (e) {
    await db.query(
      "UPDATE scorpio_connections SET error_code='PROVIDER_SYNC_FAILED' WHERE client_id=$1 AND provider=$2 AND generation=$3",
      [id, provider, c.generation],
    );
    throw e.status ? e : fail("PROVIDER_SYNC_FAILED", 502);
  }
}
module.exports = {
  publicData,
  extra,
  list,
  begin,
  callback,
  config,
  available,
  select,
  disconnect,
  sync,
  connectSite,
  siteURL,
  verifyShopHmac,
  request,
};
