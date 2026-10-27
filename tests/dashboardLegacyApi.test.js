"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../scorpio/public/modules.js"), "utf8");
const start = source.indexOf("async function legacy(");
const end = source.indexOf("\nfunction button(", start);
assert.ok(start >= 0 && end > start, "legacy API adapter must exist");
const adapter = source.slice(start, end);

async function run(response) {
  let loginCalls = 0;
  const context = {
    fetch: async () => response,
    loginUI: () => { loginCalls++; },
    Error,
    Object,
    JSON,
  };
  vm.runInNewContext(adapter, context);
  try {
    return { data: await context.legacy("/dashboard"), loginCalls };
  } catch (e) {
    return { error: e, loginCalls };
  }
}

test("legacy dashboard API reports a safe error for non-JSON upstream failures", async () => {
  const result = await run({ ok: false, status: 502, json: async () => { throw new SyntaxError("HTML"); } });
  assert.equal(result.error.code, "MODULE_UNAVAILABLE");
  assert.equal(result.loginCalls, 0);
});

test("legacy dashboard API opens login for expired sessions", async () => {
  const result = await run({ ok: false, status: 401, json: async () => ({ code: "LOGIN_REQUIRED" }) });
  assert.equal(result.error.code, "LOGIN_REQUIRED");
  assert.equal(result.loginCalls, 1);
});

test("legacy dashboard API preserves successful JSON responses", async () => {
  const result = await run({ ok: true, status: 200, json: async () => ({ leads: 4 }) });
  assert.equal(result.data.leads, 4);
  assert.equal(result.loginCalls, 0);
});
