"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../scorpio/public/modules.js"), "utf8");
const records = fs.readFileSync(path.join(__dirname, "../scorpio/records.js"), "utf8");

test("post editor exposes content format, network, topic, product and manual/AI brief modes", () => {
  const start = source.indexOf("  post: [");
  const end = source.indexOf("  appointment: [", start);
  assert.ok(start >= 0 && end > start);
  const post = source.slice(start, end);
  for (const key of ["contentType", "platform", "topic", "product", "creationMode", "scheduledAt", "assetIds", "status"])
    assert.match(post, new RegExp('key: "' + key + '"'));
  for (const format of ["reel", "story", "carousel", "both"])
    assert.ok(post.includes('"' + format + '"'));
});

test("social post form does not invoke paid AI or automatic publishing", () => {
  assert.match(source, /kind === "post" \? "פוסט חדש" : "יצירה חדשה"/);
  assert.match(source, /בחירת AI שומרת בקשה בלבד/);
  assert.match(records, /creationMode/);
  assert.match(records, /INVALID_CONTENT_TYPE/);
  assert.match(records, /INVALID_CREATION_MODE/);
});
