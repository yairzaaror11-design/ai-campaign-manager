"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../scorpio/public/modules.js"), "utf8");
const nextHandler = source.match(/next = button\("הבא", \(\) => \{([\s\S]*?)\n    \}\),\n    save =/);
assert.ok(nextHandler, "wizard next handler exists");
const handler = new Function("groupNodes", "stepRef", "update", `
  let step = stepRef.value;
  ${nextHandler[1]}
  stepRef.value = step;
`);

test("wizard cannot advance when required textarea is invalid", () => {
  const ref = { value: 0 };
  let updates = 0;
  handler([{ querySelectorAll: () => [{ reportValidity: () => false }] }], ref, () => updates++);
  assert.equal(ref.value, 0);
  assert.equal(updates, 0);
});

test("wizard advances when all current-step fields are valid", () => {
  const ref = { value: 0 };
  let updates = 0;
  handler([{ querySelectorAll: (selector) => {
    assert.equal(selector, "input, select, textarea");
    return [{ reportValidity: () => true }, { reportValidity: () => true }];
  } }], ref, () => updates++);
  assert.equal(ref.value, 1);
  assert.equal(updates, 1);
});

test("required select fields receive native browser validation", () => {
  const source = fs.readFileSync(path.join(__dirname, "../scorpio/public/modules.js"), "utf8");
  const selectFactory = source.match(/input = el\(\s*"select",\s*\{([^}]+)\}/);
  assert.ok(selectFactory, "select control factory exists");
  assert.match(selectFactory[1], /required:\s*!!field\.required/);
});
