'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const messages = [];
  let pool;
  class FakePool {
    constructor(options) { this.options = options; this.listeners = {}; pool = this; }
    on(event, handler) { this.listeners[event] = handler; }
  }
  const module = { exports: {} };
  const sandbox = {
    module, exports: module.exports,
    process: { env: { DATABASE_URL: 'postgresql://app:fake-secret@localhost/test', DB_SSL: 'false' } },
    require: (id) => {
      if (id === 'pg') return { Pool: FakePool };
      if (id === './logger') return { logger: { error: (...args) => messages.push(args), warn() {}, info() {} } };
      throw Error('UNEXPECTED_REQUIRE_' + id);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../db.js'), 'utf8'), sandbox);
  try { module.exports.query('SELECT 1'); } catch (error) { if (!String(error.message).includes('p.query is not a function')) throw error; }
  return { pool, messages };
}

test('pool errors never log connection strings or database exception messages', () => {
  const { pool, messages } = setup();
  pool.listeners.error({ code: 'ECONNRESET', message: 'password=secret host=internal.example' });
  assert.equal(messages.length, 1);
  assert.equal(messages[0][0], 'Database pool error');
  assert.equal(messages[0][1].code, 'ECONNRESET');
  assert.doesNotMatch(JSON.stringify(messages), /password|secret|internal\.example/);
});

test('malformed database error codes are redacted', () => {
  const { pool, messages } = setup();
  pool.listeners.error({ code: 'password=secret', message: 'token=hidden' });
  assert.equal(messages[0][1].code, 'POOL_ERROR');
  assert.doesNotMatch(JSON.stringify(messages), /password|secret|token=hidden/);
});
